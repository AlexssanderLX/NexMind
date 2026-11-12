using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LocalAi.Api.Storage;

namespace LocalAi.Api.Security;

public sealed record ChatEntry(string Role, string Content, DateTime At);

/// <summary>
/// Micro-RAG de segurança, sob demanda. Cada subagente anota em Markdown separado dentro da pasta da conversa:
///   security/recon.md, auth.md, input.md, logic.md, verify.md   as notas de cada especialista
///   security/INDEX.md                                           uma linha por especialista (quantas notas, a última)
///   security/{agente}.chat.json                                 o histórico do micro-chat daquele especialista
/// REGRA DE OURO: o Nex principal NÃO lê nada disso a cada conversa. O backend só lê, e só injeta no prompt daquele turno,
/// quando o Alexssander pergunta expressamente ("O que o Recon achou?"). Apagar a conversa apaga tudo junto.
/// </summary>
public sealed partial class SecurityNotes
{
    private const int MaxNoteChars = 2_000;
    private const int MaxFileChars = 20_000;
    private const int MaxChatMessages = 60;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly ConversationStore _store;
    private readonly object _lock = new();

    public SecurityNotes(ConversationStore store) => _store = store;

    [GeneratedRegex(@"\[\[ARQUIVO ([^\]]*)\]\][\s\S]*?\[\[/ARQUIVO\]\]")]
    private static partial Regex AttachmentBlock();

    /// <summary>Pasta security/ da conversa, ou null se o id é inválido ou a conversa não existe. Só cria a pasta quando vai gravar.</summary>
    private string? Folder(string conversationId, bool create)
    {
        var root = _store.FolderFor(conversationId);
        if (root is null) return null;
        var dir = Path.Combine(root, "security");
        if (create) Directory.CreateDirectory(dir);
        return dir;
    }

    private static string FileOf(string dir, string agentId) => Path.Combine(dir, agentId + ".md");

    // ---------- notas

    /// <summary>Acrescenta uma nota ao arquivo do especialista e refaz o INDEX.md. Devolve null se deu certo, ou o erro.</summary>
    public string? Append(string conversationId, string agentId, string? text, out int count)
    {
        count = 0;
        var agent = SubagentCatalog.Find(agentId);
        if (agent is null) return $"Especialista '{agentId}' não existe.";
        var note = Clean(text, MaxNoteChars);
        if (note.Length == 0) return "A nota está vazia. Informe o texto em content.";
        var dir = Folder(conversationId, create: true);
        if (dir is null) return "Conversa não encontrada.";
        lock (_lock)
        {
            var path = FileOf(dir, agent.Id);
            var lines = File.Exists(path) ? File.ReadAllLines(path).ToList() : [$"# Notas do {agent.Name}"];
            lines.Add($"- [{DateTime.Now:dd/MM HH:mm}] {note}");
            var joined = string.Join("\n", lines) + "\n";
            while (joined.Length > MaxFileChars && lines.Count > 2)
            {
                lines.RemoveAt(1); // descarta a nota mais antiga e mantém o título
                joined = string.Join("\n", lines) + "\n";
            }
            WriteAtomic(path, joined);
            count = lines.Count(l => l.StartsWith("- ["));
            RebuildIndex(dir);
        }
        return null;
    }

    /// <summary>O texto das notas de um especialista (as mais recentes, se passar de maxChars). Vazio se não há.</summary>
    public string Read(string conversationId, string agentId, int maxChars)
    {
        var agent = SubagentCatalog.Find(agentId);
        var dir = agent is null ? null : Folder(conversationId, create: false);
        if (dir is null) return "";
        lock (_lock)
        {
            var path = FileOf(dir, agent!.Id);
            if (!File.Exists(path)) return "";
            var text = File.ReadAllText(path).Trim();
            return text.Length > maxChars ? "[início cortado]\n" + text[^maxChars..] : text;
        }
    }

    public string ReadIndex(string conversationId)
    {
        var dir = Folder(conversationId, create: false);
        if (dir is null) return "";
        lock (_lock)
        {
            var path = Path.Combine(dir, "INDEX.md");
            return File.Exists(path) ? File.ReadAllText(path).Trim() : "";
        }
    }

    /// <summary>
    /// O bloco que o Nex principal recebe no prompt de UM turno em que o Alexssander pediu as anotações.
    /// agentId null = todos (INDEX + notas de cada um). Sem notas, diz isso claramente para o modelo não inventar.
    /// </summary>
    public string BuildPromptBlock(string conversationId, string? agentId, int maxChars)
    {
        if (agentId is not null)
        {
            var agent = SubagentCatalog.Find(agentId);
            if (agent is null) return "";
            var notes = Read(conversationId, agent.Id, maxChars);
            return notes.Length == 0 ? $"Ainda não há anotações do {agent.Name} nesta conversa." : notes;
        }
        var sb = new StringBuilder();
        var index = ReadIndex(conversationId);
        if (index.Length == 0) return "Ainda não há anotações de nenhum subagente de Security nesta conversa.";
        sb.AppendLine("ÍNDICE:").AppendLine(index);
        var room = Math.Max(500, maxChars - sb.Length) / SubagentCatalog.All.Count;
        foreach (var agent in SubagentCatalog.All)
        {
            var notes = Read(conversationId, agent.Id, room);
            if (notes.Length > 0) sb.AppendLine().AppendLine(notes);
        }
        return sb.ToString().Trim();
    }

    private static void RebuildIndex(string dir)
    {
        var sb = new StringBuilder("# Índice das anotações de Security\n");
        foreach (var agent in SubagentCatalog.All)
        {
            var path = FileOf(dir, agent.Id);
            if (!File.Exists(path)) continue;
            var notes = File.ReadAllLines(path).Where(l => l.StartsWith("- [")).ToList();
            if (notes.Count == 0) continue;
            var last = Regex.Replace(notes[^1], @"^- \[[^\]]*\]\s*", "");
            sb.AppendLine($"- {agent.Id}: {notes.Count} nota(s); última: {(last.Length > 80 ? last[..80] + "…" : last)}");
        }
        WriteAtomic(Path.Combine(dir, "INDEX.md"), sb.ToString());
    }

    // ---------- as 6 gavetas da investigação (editadas pelo Alexssander; os agentes leem a versão dele)

    public static readonly string[] VaultKeys = ["scope", "surface", "hypotheses", "tests", "effects", "evidence"];
    private const int MaxVaultChars = 40_000;

    private static readonly Dictionary<string, string> VaultNames = new()
    {
        ["scope"] = "Escopo & Alvos", ["surface"] = "Superfície Mapeada", ["hypotheses"] = "Hipóteses OWASP",
        ["tests"] = "Testes Executados", ["effects"] = "Efeitos & Respostas", ["evidence"] = "Evidências & PoCs",
    };

    private static string VaultFile(string dir, string key) => Path.Combine(dir, "vault", key + ".md");

    /// <summary>Texto da gaveta e quando foi salvo pela última vez (null se ainda não existe).</summary>
    public (string Text, DateTime? UpdatedAt) ReadVault(string conversationId, string key)
    {
        var dir = VaultKeys.Contains(key) ? Folder(conversationId, create: false) : null;
        if (dir is null) return ("", null);
        lock (_lock)
        {
            var path = VaultFile(dir, key);
            return File.Exists(path) ? (File.ReadAllText(path), File.GetLastWriteTimeUtc(path)) : ("", null);
        }
    }

    /// <summary>Substitui o conteúdo da gaveta (o que o Alexssander editou vira a versão oficial). Devolve null se deu certo, ou o erro.</summary>
    public string? WriteVault(string conversationId, string key, string? text)
    {
        if (!VaultKeys.Contains(key)) return $"Gaveta '{key}' não existe.";
        var clean = (text ?? "").Replace("\r\n", "\n");
        if (clean.Length > MaxVaultChars) return $"A gaveta passa de {MaxVaultChars} caracteres.";
        var dir = Folder(conversationId, create: true);
        if (dir is null) return "Conversa não encontrada.";
        lock (_lock)
        {
            var path = VaultFile(dir, key);
            if (clean.Trim().Length == 0) { if (File.Exists(path)) File.Delete(path); return null; } // gaveta esvaziada: some o arquivo
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            WriteAtomic(path, clean);
        }
        return null;
    }

    /// <summary>Quantos itens cada gaveta tem (linhas com texto que não são títulos). Gaveta vazia = 0.</summary>
    public Dictionary<string, int> VaultCounts(string conversationId) =>
        VaultKeys.ToDictionary(k => k, k => CountItems(ReadVault(conversationId, k).Text));

    public static int CountItems(string text) =>
        text.Split('\n').Count(l => { var t = l.Trim(); return t.Length > 0 && !t.StartsWith('#'); });

    /// <summary>As gavetas preenchidas, em bloco curto, para os subagentes consultarem. Vazio se o Alexssander não anotou nada.</summary>
    public string VaultPromptBlock(string conversationId, int perDrawerChars)
    {
        var sb = new StringBuilder();
        foreach (var key in VaultKeys)
        {
            var text = ReadVault(conversationId, key).Text.Trim();
            if (text.Length == 0) continue;
            if (text.Length > perDrawerChars) text = "[início cortado]\n" + text[^perDrawerChars..];
            sb.AppendLine($"[{VaultNames[key]}]").AppendLine(text).AppendLine();
        }
        return sb.ToString().Trim();
    }

    // ---------- histórico do micro-chat (exclusivo de cada especialista)

    public List<ChatEntry> LoadChat(string conversationId, string agentId)
    {
        var agent = SubagentCatalog.Find(agentId);
        var dir = agent is null ? null : Folder(conversationId, create: false);
        if (dir is null) return [];
        lock (_lock)
        {
            var path = Path.Combine(dir, agent!.Id + ".chat.json");
            if (!File.Exists(path)) return [];
            try { return JsonSerializer.Deserialize<List<ChatEntry>>(File.ReadAllText(path), Json) ?? []; }
            catch (JsonException) { return []; } // arquivo corrompido: começa do zero em vez de quebrar o micro-chat
        }
    }

    /// <summary>Guarda a troca. O CONTEÚDO de anexos não fica no histórico (só o nome): o texto pesaria no prompt dos próximos turnos.</summary>
    public void AppendChat(string conversationId, string agentId, string userText, string assistantText)
    {
        var agent = SubagentCatalog.Find(agentId);
        if (agent is null) return;
        var dir = Folder(conversationId, create: true);
        if (dir is null) return;
        var userStored = AttachmentBlock().Replace(userText, m => $"[[ARQUIVO {m.Groups[1].Value}]]\n(conteúdo omitido do histórico)\n[[/ARQUIVO]]");
        lock (_lock)
        {
            var all = LoadChat(conversationId, agent.Id);
            all.Add(new ChatEntry("user", userStored, DateTime.UtcNow));
            if (!string.IsNullOrWhiteSpace(assistantText)) all.Add(new ChatEntry("assistant", assistantText, DateTime.UtcNow));
            if (all.Count > MaxChatMessages) all = all.Skip(all.Count - MaxChatMessages).ToList();
            WriteAtomic(Path.Combine(dir, agent.Id + ".chat.json"), JsonSerializer.Serialize(all, Json));
        }
    }

    private static string Clean(string? text, int max)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var t = Regex.Replace(text.Replace("\r\n", "\n").Trim(), @"\n+", " ⏎ ");
        return t.Length > max ? t[..max] + "…" : t;
    }

    private static void WriteAtomic(string path, string text)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, text, new UTF8Encoding(false));
        File.Move(tmp, path, overwrite: true);
    }
}
