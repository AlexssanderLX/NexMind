using System.Text.Json;
using System.Text.RegularExpressions;
using LocalAi.Api.Memory;

namespace LocalAi.Api.Storage;

/// <summary>
/// Persistência: uma micropasta por conversa, backend/data/conversations/{id}/
///   conversation.json   histórico de mensagens (gravação atômica)
///   system_index.md, intent.md, facts.md   o que o sistema sabe e comprovou
///   agent_index.md, scratchpad.md          o caderno do agente
/// Um índice em memória (id, título, data) responde à listagem sem ler os arquivos; ele é montado na partida
/// lendo só o começo de cada conversation.json, e mantido em dia por Save/Delete.
/// </summary>
public partial class ConversationStore
{
    public const string ConversationFile = "conversation.json";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly string _dir;
    private readonly object _lock = new();
    private readonly Dictionary<string, ConversationSummary> _index = new();

    public ConversationStore(string dir)
    {
        _dir = dir;
        Directory.CreateDirectory(dir);
        ArchiveLegacyFiles(dir);
        // só micropastas válidas entram
        foreach (var folder in Directory.EnumerateDirectories(dir))
        {
            if (!IdPattern().IsMatch(Path.GetFileName(folder))) continue;
            var file = Path.Combine(folder, ConversationFile);
            if (File.Exists(file) && ReadSummary(file) is { } s) _index[s.Id] = s;
        }
    }

    /// <summary>
    /// Os .json soltos do formato antigo (um arquivo por conversa) vão para conversations/_legado/. Nada é apagado:
    /// o novo formato assume sozinho e quem quiser olhar o histórico antigo encontra os arquivos lá.
    /// </summary>
    private static void ArchiveLegacyFiles(string dir)
    {
        var legacy = Directory.EnumerateFiles(dir, "*.json").ToList();
        if (legacy.Count == 0) return;
        var target = Path.Combine(dir, "_legado");
        Directory.CreateDirectory(target);
        foreach (var file in legacy)
        {
            try { File.Move(file, Path.Combine(target, Path.GetFileName(file)), overwrite: true); }
            catch (IOException) { /* arquivo em uso por outro processo: tenta na próxima partida */ }
        }
    }

    [GeneratedRegex("^[a-f0-9]{32}$")]
    private static partial Regex IdPattern();

    private string FolderOf(string id) => Path.Combine(_dir, id);
    private string PathFor(string id) => Path.Combine(FolderOf(id), ConversationFile);

    /// <summary>Pasta da conversa, ou null se o id é inválido (barra qualquer caminho fora de data/conversations) ou ela não existe.</summary>
    public string? FolderFor(string id)
    {
        if (!IdPattern().IsMatch(id)) return null;
        var folder = FolderOf(id);
        return Directory.Exists(folder) ? folder : null;
    }

    public static readonly string[] Modes = ["general", "security", "dev"];

    /// <summary>Modo válido em minúsculas; qualquer outra coisa (ou vazio) vira "general".</summary>
    public static string NormalizeMode(string? mode)
    {
        var m = (mode ?? "").Trim().ToLowerInvariant();
        return Modes.Contains(m) ? m : "general";
    }

    /// <param name="mode">Se informado, só as conversas deste modo (a lista de cada workspace); sem ele, todas.</param>
    public List<ConversationSummary> List(string? mode = null)
    {
        var filter = string.IsNullOrWhiteSpace(mode) ? null : NormalizeMode(mode);
        lock (_lock) return _index.Values.Where(c => filter is null || c.Mode == filter).OrderByDescending(c => c.UpdatedAt).ToList();
    }

    public Conversation Create(string? mode = null)
    {
        var now = DateTime.UtcNow;
        var c = new Conversation { Id = Guid.NewGuid().ToString("N"), Mode = NormalizeMode(mode), CreatedAt = now, UpdatedAt = now };
        ConversationMemory.Seed(FolderOf(c.Id)); // cria a pasta com os índices e tópicos
        Save(c);
        return c;
    }

    public Conversation? Get(string id)
    {
        if (!IdPattern().IsMatch(id)) return null;
        lock (_lock)
        {
            var path = PathFor(id);
            return File.Exists(path) ? JsonSerializer.Deserialize<Conversation>(File.ReadAllText(path), Json) : null;
        }
    }

    /// <param name="touch">false = não mexe na data de atualização (renomear não deve subir a conversa na lista).</param>
    public void Save(Conversation c, bool touch = true)
    {
        if (touch) c.UpdatedAt = DateTime.UtcNow;
        var json = JsonSerializer.Serialize(c, Json); // compacto: arquivos menores e escrita mais rápida
        lock (_lock)
        {
            // escreve num temporário e troca: fechar o app no meio de um salvamento não corrompe a conversa
            Directory.CreateDirectory(FolderOf(c.Id));
            var path = PathFor(c.Id);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, path, overwrite: true);
            _index[c.Id] = new ConversationSummary(c.Id, c.Title, c.UpdatedAt, NormalizeMode(c.Mode));
        }
    }

    public const int MaxTitleChars = 80;

    /// <summary>Renomeia. Devolve null se a conversa não existe, ou o título já limpo (espaços colapsados, até 80 caracteres).</summary>
    public string? Rename(string id, string? title)
    {
        var clean = Regex.Replace(title ?? "", @"\s+", " ").Trim();
        if (clean.Length == 0) return null;
        if (clean.Length > MaxTitleChars) clean = clean[..MaxTitleChars].TrimEnd();
        lock (_lock)
        {
            var c = Get(id);
            if (c is null) return null;
            c.Title = clean;
            c.TitleEdited = true;
            Save(c, touch: false);
            return clean;
        }
    }

    public bool Delete(string id)
    {
        if (!IdPattern().IsMatch(id)) return false;
        lock (_lock)
        {
            var folder = FolderOf(id);
            if (!Directory.Exists(folder)) return false;
            Directory.Delete(folder, recursive: true); // a micropasta inteira: histórico, fatos e caderno
            _index.Remove(id);
            return true;
        }
    }

    /// <summary>Lê só o início do arquivo (id, título, data vêm antes de "messages"); se falhar, lê tudo.</summary>
    private static ConversationSummary? ReadSummary(string path)
    {
        try
        {
            using var fs = File.OpenRead(path);
            var buf = new byte[4096];
            var n = fs.Read(buf, 0, buf.Length);
            if (ParseHeader(buf.AsSpan(0, n)) is { } quick) return quick;
        }
        catch (IOException) { }

        try
        {
            var c = JsonSerializer.Deserialize<Conversation>(File.ReadAllText(path), Json);
            return c is null ? null : new ConversationSummary(c.Id, c.Title, c.UpdatedAt, NormalizeMode(c.Mode));
        }
        catch (JsonException) { return null; } // arquivo corrompido: ignora
    }

    private static ConversationSummary? ParseHeader(ReadOnlySpan<byte> data)
    {
        var r = new Utf8JsonReader(data, isFinalBlock: false, default);
        string? id = null, title = null, mode = null;
        DateTime? updated = null;
        try
        {
            while (r.Read())
            {
                if (r.TokenType != JsonTokenType.PropertyName) continue;
                if (r.ValueTextEquals("messages")) break;
                var name = r.GetString();
                if (!r.Read()) break;
                switch (name)
                {
                    case "id": id = r.GetString(); break;
                    case "title": title = r.GetString(); break;
                    case "mode": mode = r.GetString(); break; // vem antes de updatedAt; arquivo antigo não tem e vira "general"
                    case "updatedAt": updated = r.GetDateTime(); break;
                }
                if (id is not null && title is not null && updated is not null) break;
            }
        }
        catch (JsonException) { return null; }
        return id is not null && title is not null && updated is not null
            ? new ConversationSummary(id, title, updated.Value, NormalizeMode(mode))
            : null;
    }
}
