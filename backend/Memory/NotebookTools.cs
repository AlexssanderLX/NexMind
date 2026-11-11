using System.Text.Json;
using LocalAi.Api.Llm;

namespace LocalAi.Api.Memory;

/// <summary>
/// topic_read e topic_write: as duas ferramentas NATIVAS do caderno da conversa (não passam por MCP).
/// Sempre disponíveis, sem aprovação: só leem e acrescentam notas na pasta da própria conversa.
/// </summary>
public static class NotebookTools
{
    public const string Read = "topic_read";
    public const string Write = "topic_write";

    public static bool IsNotebookTool(string name) => name is Read or Write;

    public const string ReadDescription =
        "O QUE FAZ: lê um arquivo do caderno desta conversa.\n" +
        "QUANDO USAR: antes de responder sobre o que já foi combinado, anotado ou comprovado nesta conversa, e quando o Alexssander perguntar \"o que anotamos\" ou \"qual hipótese está anotada\".\n" +
        "COMO USAR: name = scratchpad (suas notas e hipóteses), facts (fatos comprovados pelas ferramentas), intent (objetivo da conversa), system_index ou agent_index (os índices).\n" +
        "NÃO FAÇA: não invente conteúdo: se o tópico estiver vazio, diga que está vazio; não use para ler arquivos do PC (isso é read_text_file).\n" +
        "RETORNA: o texto do tópico (só o final, se for muito longo).";

    public const string WriteDescription =
        "O QUE FAZ: acrescenta uma nota ao seu scratchpad (hipóteses, planos, passos pendentes). Não pede aprovação: é só o seu caderno.\n" +
        "QUANDO USAR: quando o Alexssander pedir para anotar algo, ou quando você formular uma hipótese ou um plano que precise lembrar depois.\n" +
        "COMO USAR: name = scratchpad (o único em que você pode escrever); content = a nota, curta e completa (uma ideia por chamada).\n" +
        "NÃO FAÇA: não escreva fatos como se fossem comprovados (fatos são do sistema); não use para criar arquivos no PC (isso é write_file); não repita uma nota que já existe.\n" +
        "RETORNA: confirmação com o total de notas. Depois, diga ao Alexssander o que anotou.";

    public static List<object> Definitions() =>
    [
        new
        {
            type = "function",
            function = new
            {
                name = Read,
                description = ReadDescription,
                parameters = Schema(("name", "Qual tópico ler: scratchpad, facts, intent, system_index ou agent_index.", true)),
            },
        },
        new
        {
            type = "function",
            function = new
            {
                name = Write,
                description = WriteDescription,
                parameters = Schema(("name", "Sempre scratchpad.", true), ("content", "O texto da nota.", true)),
            },
        },
    ];

    private static object Schema(params (string Name, string Description, bool Required)[] props) => new
    {
        type = "object",
        properties = props.ToDictionary(p => p.Name, p => (object)new { type = "string", description = p.Description }),
        required = props.Where(p => p.Required).Select(p => p.Name).ToArray(),
    };

    /// <summary>Executa a chamada. Devolve (ok, texto para o modelo).</summary>
    public static (bool Ok, string Text) Handle(ToolCall call, ConversationMemory memory, string conversationId, int maxChars)
    {
        var name = Arg(call.Arguments, "name");
        if (call.Name == Read)
        {
            var (ok, text) = memory.Read(conversationId, name, maxChars);
            if (!ok) return (false, text);
            return (true, string.IsNullOrWhiteSpace(text) ? "(vazio)" : text);
        }
        if (call.Name == Write)
        {
            var error = memory.AppendNote(conversationId, name, Arg(call.Arguments, "content"), out var notes);
            return error is null
                ? (true, $"Anotado no scratchpad. Total de notas: {notes}. Confirme ao Alexssander o que você anotou.")
                : (false, error);
        }
        return (false, $"A ferramenta '{call.Name}' não existe.");
    }

    private static string? Arg(JsonElement args, string key)
    {
        if (args.ValueKind != JsonValueKind.Object) return null;
        foreach (var p in args.EnumerateObject())
        {
            if (!string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase)) continue;
            return p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.ToString();
        }
        return null;
    }
}
