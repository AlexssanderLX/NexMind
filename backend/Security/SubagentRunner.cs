using System.Text;
using System.Text.Json;
using LocalAi.Api.Llm;
using LocalAi.Api.Planning;

namespace LocalAi.Api.Security;

/// <summary>
/// Executa um turno do micro-chat de um subagente: o MESMO modelo local do Nex (mesma porta), com o prompt de sistema focado só na
/// especialidade, o histórico exclusivo daquele especialista e uma única ferramenta (note_write) para guardar descobertas.
/// Contexto adaptativo igual ao do Nex principal (4096 na GPU; sobe só com anexo grande ou histórico longo).
/// </summary>
public sealed class SubagentRunner
{
    public const string NoteTool = "note_write";
    private const int MaxRounds = 3;
    private const int HistoryMessages = 12;

    public const string NoteToolDescription =
        "O QUE FAZ: guarda uma nota nas anotações deste especialista (arquivo Markdown da conversa). Não pede aprovação.\n" +
        "QUANDO USAR: quando surgir uma descoberta, hipótese ou próximo passo que valha lembrar, ou quando o Alexssander pedir para anotar.\n" +
        "COMO USAR: content = a nota, curta e completa (uma ideia por chamada). Antes de chamar, escreva UMA frase avisando.\n" +
        "NÃO FAÇA: não anote suposição como se fosse fato; não repita nota que já existe; não cole conteúdo grande de anexos.\n" +
        "RETORNA: confirmação com o total de notas.";

    private readonly OllamaClient _ollama;
    private readonly SecurityNotes _notes;

    public SubagentRunner(OllamaClient ollama, SecurityNotes notes)
    {
        _ollama = ollama;
        _notes = notes;
    }

    public static List<object> Definitions() =>
    [
        new
        {
            type = "function",
            function = new
            {
                name = NoteTool,
                description = NoteToolDescription,
                parameters = new
                {
                    type = "object",
                    properties = new Dictionary<string, object> { ["content"] = new { type = "string", description = "O texto da nota." } },
                    required = new[] { "content" },
                },
            },
        },
    ];

    public async Task RunAsync(string conversationId, Subagent agent, string userText, string model, int ceiling,
        Func<object, Task> send, CancellationToken ct)
    {
        var answer = new StringBuilder();
        ChatStats? stats = null;
        try
        {
            var history = _notes.LoadChat(conversationId, agent.Id)
                .TakeLast(HistoryMessages).Select(e => (e.Role, e.Content)).ToList();
            history.Add(("user", userText));

            var system = SubagentCatalog.BuildSystem(agent);
            var vault = _notes.VaultPromptBlock(conversationId, 900);
            if (vault.Length > 0) system += "\n\nGAVETAS DA INVESTIGAÇÃO (versão oficial, editada pelo Alexssander; trate como verdade e não contradiga sem motivo):\n" + vault;
            var tail = _notes.Read(conversationId, agent.Id, 1200);
            if (tail.Length > 0) system += "\n\nSuas notas até agora (não repita):\n" + tail;

            var tools = Definitions();
            LoadedModel? loaded = null;
            try { loaded = await _ollama.GetLoadedModelAsync(ct); } catch (HttpRequestException) { /* o erro aparece na chamada do modelo */ }
            int? loadedCtx = loaded is not null && string.Equals(loaded.Name, model, StringComparison.OrdinalIgnoreCase) ? loaded.ContextLength : null;
            var attachmentChars = System.Text.RegularExpressions.Regex.Matches(userText, @"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]").Sum(m => m.Length);
            var plan = ContextPlanner.Plan(
                ceiling,
                ContextPlanner.EstimateTokens(system.Length + JsonSerializer.Serialize(tools).Length),
                ContextPlanner.EstimateTokens(history.Sum(h => h.Content.Length)),
                usesMcp: false,
                attachmentChars,
                loadedCtx);
            int? numGpu = plan.NumCtx > 16384 ? 24 : null;

            var extra = new List<object>();
            for (var round = 0; round <= MaxRounds; round++)
            {
                if (round == MaxRounds)
                    extra.Add(new { role = "user", content = "[sistema] Limite de ferramentas atingido. Responda agora, sem chamar mais ferramentas." });
                List<ToolCall>? calls = null;
                var roundText = new StringBuilder();
                await foreach (var chunk in _ollama.ChatAsync(model, system, history, plan.NumCtx, null, numGpu, extra,
                                   round < MaxRounds ? tools : null, ct))
                {
                    if (!string.IsNullOrEmpty(chunk.Content))
                    {
                        answer.Append(chunk.Content);
                        roundText.Append(chunk.Content);
                        await send(new { type = "token", text = chunk.Content });
                    }
                    if (chunk.ToolCalls is { Count: > 0 }) calls = chunk.ToolCalls;
                    if (chunk.Stats is not null) stats = chunk.Stats;
                }
                if (calls is null) break;

                extra.Add(new
                {
                    role = "assistant",
                    content = roundText.ToString(),
                    tool_calls = calls.Select(c => new { function = new { name = c.Name, arguments = c.Arguments } }).ToList(),
                });
                foreach (var call in calls)
                {
                    string result;
                    if (call.Name != NoteTool) result = $"A ferramenta '{call.Name}' não existe.";
                    else
                    {
                        var content = ToolTelemetry.Summarize(call.Arguments);
                        await send(new { type = "mcp", name = NoteTool, state = "executando", brief = content, detail = JsonSerializer.Serialize(call.Arguments) });
                        var error = _notes.Append(conversationId, agent.Id, Arg(call.Arguments, "content"), out var count);
                        result = error is null ? $"Anotado em {agent.Id}.md. Total de notas: {count}. Confirme ao Alexssander o que anotou." : "ERRO: " + error;
                        await send(new { type = "mcp", name = NoteTool, state = error is null ? "concluida" : "falhou", detail = result });
                    }
                    extra.Add(new { role = "tool", tool_name = call.Name, content = result });
                }
            }
            _notes.AppendChat(conversationId, agent.Id, userText, answer.ToString());
            await send(new { type = "done", stats });
        }
        catch (OperationCanceledException)
        {
            if (answer.Length > 0) _notes.AppendChat(conversationId, agent.Id, userText, answer.ToString()); // parou no meio: guarda o parcial
        }
        catch (OllamaException ex) { await send(new { type = "error", message = ex.Message }); }
        catch (HttpRequestException) { await send(new { type = "error", message = "Não foi possível conectar ao Ollama. Verifique se ele está em execução." }); }
    }

    private static string? Arg(JsonElement args, string key)
    {
        if (args.ValueKind != JsonValueKind.Object) return null;
        foreach (var p in args.EnumerateObject())
            if (string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase))
                return p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.ToString();
        return null;
    }
}
