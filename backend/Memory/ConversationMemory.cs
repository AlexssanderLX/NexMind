using System.Text;
using System.Text.RegularExpressions;
using LocalAi.Api.Storage;

namespace LocalAi.Api.Memory;

/// <summary>
/// Micro-RAG de uma conversa: tópicos completos em disco (a pasta da conversa) e DOIS índices compactos que vão no prompt.
/// - system_index.md: do backend. Resume intent.md e facts.md (o que foi pedido e o que as ferramentas comprovaram). O agente só lê.
/// - agent_index.md: do agente. Resume o scratchpad.md (hipóteses, planos). O agente escreve só por topic_write.
/// Custo de GPU zero: tudo é texto montado pelo C# a partir de eventos que já aconteceram.
/// </summary>
public sealed partial class ConversationMemory
{
    public static readonly string[] Topics = ["intent", "facts", "scratchpad", "system_index", "agent_index"];

    private const int MaxFacts = 60;
    private const int MaxScratchpadChars = 20_000;
    private const int MaxNoteChars = 2_000;
    private const int MaxIntentChars = 300;
    private const string FactsHeader = "# Fatos comprovados (escritos pelo sistema; o agente só lê)";
    private const string ScratchHeader = "# Caderno do agente (hipóteses, planos, passos pendentes)";
    private const string IntentHeader = "# Objetivo da conversa";

    private readonly ConversationStore _store;
    private readonly object _lock = new();

    public ConversationMemory(ConversationStore store) => _store = store;

    [GeneratedRegex(@"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]\s*")]
    private static partial Regex AttachmentBlock();

    /// <summary>Cria os cinco arquivos de uma pasta de conversa nova.</summary>
    public static void Seed(string folder)
    {
        Directory.CreateDirectory(folder);
        WriteAtomic(Path.Combine(folder, "intent.md"), IntentHeader + "\n(ainda não definido)\n");
        WriteAtomic(Path.Combine(folder, "facts.md"), FactsHeader + "\n");
        WriteAtomic(Path.Combine(folder, "scratchpad.md"), ScratchHeader + "\n");
        WriteAtomic(Path.Combine(folder, "system_index.md"), BuildSystemIndex("", []));
        WriteAtomic(Path.Combine(folder, "agent_index.md"), BuildAgentIndex([]));
    }

    public static string? NormalizeTopic(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var t = raw.Trim().ToLowerInvariant().Replace(".md", "").Replace(' ', '_').Replace('-', '_');
        return t switch
        {
            "intent" or "objetivo" => "intent",
            "facts" or "fatos" => "facts",
            "scratchpad" or "notas" or "caderno" or "anotacoes" => "scratchpad",
            "system_index" or "indice_sistema" => "system_index",
            "agent_index" or "indice_agente" => "agent_index",
            _ => null,
        };
    }

    /// <summary>Lê um tópico. Se passar de maxChars devolve o FIM (o mais recente) com um aviso.</summary>
    public (bool Ok, string Text) Read(string id, string? topic, int maxChars)
    {
        var name = NormalizeTopic(topic);
        if (name is null) return (false, $"Tópico '{topic}' não existe. Use: {string.Join(", ", Topics)}.");
        var folder = _store.FolderFor(id);
        if (folder is null) return (false, "Conversa não encontrada.");
        lock (_lock)
        {
            var path = Path.Combine(folder, name + ".md");
            var text = File.Exists(path) ? File.ReadAllText(path) : "";
            if (text.Length > maxChars) text = "[início cortado]\n" + text[^maxChars..];
            return (true, text);
        }
    }

    /// <summary>O agente só escreve no scratchpad, sempre acrescentando uma nota. Devolve null se deu certo, ou o erro.</summary>
    public string? AppendNote(string id, string? topic, string? content, out int notes)
    {
        notes = 0;
        var name = NormalizeTopic(topic);
        if (name is null) return $"Tópico '{topic}' não existe. O único em que você escreve é scratchpad.";
        if (name != "scratchpad")
            return $"'{name}' é escrito pelo sistema e você só pode ler. Para anotar hipóteses e planos, use name=scratchpad.";
        var text = Clean(content, MaxNoteChars);
        if (text.Length == 0) return "A nota está vazia. Informe o texto em content.";
        var folder = _store.FolderFor(id);
        if (folder is null) return "Conversa não encontrada.";
        lock (_lock)
        {
            var path = Path.Combine(folder, "scratchpad.md");
            var lines = File.Exists(path) ? File.ReadAllLines(path).ToList() : [ScratchHeader];
            lines.Add($"- [{DateTime.Now:dd/MM HH:mm}] {text}");
            var joined = string.Join("\n", lines) + "\n";
            while (joined.Length > MaxScratchpadChars && lines.Count > 2)
            {
                lines.RemoveAt(1); // descarta a nota mais antiga, mantém o cabeçalho
                joined = string.Join("\n", lines) + "\n";
            }
            WriteAtomic(path, joined);
            var noteLines = lines.Where(l => l.StartsWith("- [")).ToList();
            notes = noteLines.Count;
            WriteAtomic(Path.Combine(folder, "agent_index.md"), BuildAgentIndex(noteLines));
        }
        return null;
    }

    /// <summary>Objetivo inicial da conversa (1ª mensagem do usuário, sem o texto dos anexos).</summary>
    public void SetIntent(string id, string userText)
    {
        var folder = _store.FolderFor(id);
        if (folder is null) return;
        var text = Clean(AttachmentBlock().Replace(userText, "").Trim(), MaxIntentChars);
        if (text.Length == 0) text = "Arquivo anexado";
        lock (_lock)
        {
            WriteAtomic(Path.Combine(folder, "intent.md"), IntentHeader + "\n" + text + "\n");
            RebuildSystemIndex(folder);
        }
    }

    /// <summary>Anota um fato comprovado por uma ferramenta. Repetido não entra de novo; guarda os últimos MaxFacts.</summary>
    public void AddFact(string id, string fact)
    {
        var folder = _store.FolderFor(id);
        if (folder is null) return;
        var text = Clean(fact, 240);
        if (text.Length == 0) return;
        lock (_lock)
        {
            var path = Path.Combine(folder, "facts.md");
            var lines = File.Exists(path) ? File.ReadAllLines(path).ToList() : [FactsHeader];
            var entry = "- " + text;
            if (lines.Contains(entry)) return;
            lines.Add(entry);
            while (lines.Count(l => l.StartsWith("- ")) > MaxFacts) lines.RemoveAt(lines.FindIndex(l => l.StartsWith("- ")));
            WriteAtomic(path, string.Join("\n", lines) + "\n");
            RebuildSystemIndex(folder);
        }
    }

    /// <summary>Os dois índices que vão no prompt (~120 tokens no total).</summary>
    public (string System, string Agent) Indexes(string id)
    {
        var folder = _store.FolderFor(id);
        if (folder is null) return ("", "");
        lock (_lock)
        {
            string Load(string n) => File.Exists(Path.Combine(folder, n)) ? File.ReadAllText(Path.Combine(folder, n)).Trim() : "";
            return (Load("system_index.md"), Load("agent_index.md"));
        }
    }

    private static void RebuildSystemIndex(string folder)
    {
        var intentPath = Path.Combine(folder, "intent.md");
        var intent = File.Exists(intentPath)
            ? string.Join(" ", File.ReadAllLines(intentPath).Skip(1)).Trim()
            : "";
        if (intent.StartsWith("(ainda")) intent = "";
        var factsPath = Path.Combine(folder, "facts.md");
        var facts = File.Exists(factsPath)
            ? File.ReadAllLines(factsPath).Where(l => l.StartsWith("- ")).Select(l => l[2..]).ToList()
            : [];
        WriteAtomic(Path.Combine(folder, "system_index.md"), BuildSystemIndex(intent, facts));
    }

    private static string BuildSystemIndex(string intent, List<string> facts)
    {
        var sb = new StringBuilder();
        sb.Append("- intent: ").AppendLine(intent.Length == 0 ? "(ainda não definido)" : Cut(intent, 140));
        if (facts.Count == 0) sb.AppendLine("- facts: nenhum ainda");
        else sb.Append("- facts (").Append(facts.Count).Append("): ").AppendLine(string.Join("; ", facts.TakeLast(3).Select(f => Cut(f, 70))));
        return sb.ToString();
    }

    private static string BuildAgentIndex(List<string> noteLines)
    {
        if (noteLines.Count == 0) return "- scratchpad: vazio\n";
        var last = Regex.Replace(noteLines[^1], @"^- \[[^\]]*\]\s*", "");
        return $"- scratchpad: {noteLines.Count} nota(s); última: {Cut(last, 80)}\n";
    }

    private static string Clean(string? text, int max)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var t = text.Replace("\r\n", "\n").Trim();
        t = Regex.Replace(t, @"\n+", " ⏎ ");
        return t.Length > max ? t[..max] + "…" : t;
    }

    private static string Cut(string text, int max) => text.Length <= max ? text : text[..max] + "…";

    /// <summary>Escreve num temporário e troca: fechar o app no meio não corrompe o arquivo.</summary>
    internal static void WriteAtomic(string path, string text)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, text, new UTF8Encoding(false));
        File.Move(tmp, path, overwrite: true);
    }
}
