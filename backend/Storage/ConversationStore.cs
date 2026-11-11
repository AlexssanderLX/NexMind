using System.Text.Json;
using System.Text.RegularExpressions;

namespace LocalAi.Api.Storage;

/// <summary>
/// Persistência simples: um arquivo JSON por conversa.
/// Um índice em memória (id, título, data) responde à listagem sem ler os arquivos; ele é montado na partida
/// lendo só o começo de cada arquivo, e mantido em dia por Save/Delete.
/// </summary>
public partial class ConversationStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly string _dir;
    private readonly object _lock = new();
    private readonly Dictionary<string, ConversationSummary> _index = new();

    public ConversationStore(string dir)
    {
        _dir = dir;
        Directory.CreateDirectory(dir);
        foreach (var file in Directory.EnumerateFiles(dir, "*.json"))
            if (ReadSummary(file) is { } s) _index[s.Id] = s;
    }

    [GeneratedRegex("^[a-f0-9]{32}$")]
    private static partial Regex IdPattern();

    private string PathFor(string id) => Path.Combine(_dir, id + ".json");

    public List<ConversationSummary> List()
    {
        lock (_lock) return _index.Values.OrderByDescending(c => c.UpdatedAt).ToList();
    }

    public Conversation Create()
    {
        var now = DateTime.UtcNow;
        var c = new Conversation { Id = Guid.NewGuid().ToString("N"), CreatedAt = now, UpdatedAt = now };
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

    public void Save(Conversation c)
    {
        c.UpdatedAt = DateTime.UtcNow;
        var json = JsonSerializer.Serialize(c, Json); // compacto: arquivos menores e escrita mais rápida
        lock (_lock)
        {
            // escreve num temporário e troca: fechar o app no meio de um salvamento não corrompe a conversa
            var path = PathFor(c.Id);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, path, overwrite: true);
            _index[c.Id] = new ConversationSummary(c.Id, c.Title, c.UpdatedAt);
        }
    }

    public bool Delete(string id)
    {
        if (!IdPattern().IsMatch(id)) return false;
        lock (_lock)
        {
            var path = PathFor(id);
            if (!File.Exists(path)) return false;
            File.Delete(path);
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
            return c is null ? null : new ConversationSummary(c.Id, c.Title, c.UpdatedAt);
        }
        catch (JsonException) { return null; } // arquivo corrompido: ignora
    }

    private static ConversationSummary? ParseHeader(ReadOnlySpan<byte> data)
    {
        var r = new Utf8JsonReader(data, isFinalBlock: false, default);
        string? id = null, title = null;
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
                    case "updatedAt": updated = r.GetDateTime(); break;
                }
                if (id is not null && title is not null && updated is not null) break;
            }
        }
        catch (JsonException) { return null; }
        return id is not null && title is not null && updated is not null
            ? new ConversationSummary(id, title, updated.Value)
            : null;
    }
}
