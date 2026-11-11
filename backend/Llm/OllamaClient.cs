using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace LocalAi.Api.Llm;

public class OllamaOptions
{
    public string BaseUrl { get; set; } = "http://localhost:11434";
}

public class OllamaException(string message) : Exception(message);

public record ModelInfo(string Name, long SizeMb);
public record OllamaStatus(bool Connected, string BaseUrl, string? Version, string? Error, List<ModelInfo> Models);
public record LoadedModel(string Name, long SizeMb, long VramMb, int? ContextLength);

/// <summary>Um pedaço da resposta em streaming. Stats só vem no último.</summary>
public record ChatChunk(string? Content, string? Thinking, ChatStats? Stats, List<ToolCall>? ToolCalls = null);

/// <summary>Pedido de ferramenta emitido pelo modelo (function calling do Ollama).</summary>
public record ToolCall(string Name, JsonElement Arguments);

/// <summary>Toda a comunicação com o Ollama fica aqui. Nada específico de Qwen.</summary>
public class OllamaClient(HttpClient http, IOptions<OllamaOptions> options)
{
    private string BaseUrl => options.Value.BaseUrl;

    public async Task<OllamaStatus> GetStatusAsync(CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            // as duas consultas em paralelo: a latência vira a da mais lenta, não a soma
            var versionTask = http.GetFromJsonAsync<JsonElement>("/api/version", cts.Token);
            var tagsTask = http.GetFromJsonAsync<JsonElement>("/api/tags", cts.Token);
            await Task.WhenAll(versionTask, tagsTask);
            var version = versionTask.Result.GetProperty("version").GetString();
            var tags = tagsTask.Result;
            var models = new List<ModelInfo>();
            if (tags.TryGetProperty("models", out var arr))
                foreach (var m in arr.EnumerateArray())
                    models.Add(new ModelInfo(m.GetProperty("name").GetString()!, m.GetProperty("size").GetInt64() / 1_048_576));
            return new OllamaStatus(true, BaseUrl, version, null, models);
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException)
        {
            return new OllamaStatus(false, BaseUrl, null,
                $"Ollama não está respondendo em {BaseUrl}. Verifique se está instalado e em execução (ollama serve).", []);
        }
    }

    /// <summary>Modelo atualmente carregado em memória (quanto está na GPU vs CPU).</summary>
    public async Task<LoadedModel?> GetLoadedModelAsync(CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            var ps = await http.GetFromJsonAsync<JsonElement>("/api/ps", cts.Token);
            if (!ps.TryGetProperty("models", out var arr) || arr.GetArrayLength() == 0) return null;
            var m = arr[0];
            int? ctx = m.TryGetProperty("context_length", out var c) && c.ValueKind == JsonValueKind.Number ? c.GetInt32() : null;
            return new LoadedModel(
                m.GetProperty("name").GetString()!,
                m.GetProperty("size").GetInt64() / 1_048_576,
                m.GetProperty("size_vram").GetInt64() / 1_048_576,
                ctx);
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or KeyNotFoundException)
        {
            return null;
        }
    }

    public async IAsyncEnumerable<ChatChunk> ChatAsync(
        string model, string? system, IEnumerable<(string Role, string Content)> messages, int numCtx, bool? think,
        int? numGpu, IReadOnlyList<object>? extraMessages, IReadOnlyList<object>? tools,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var msgs = new List<object>();
        if (!string.IsNullOrWhiteSpace(system)) msgs.Add(new { role = "system", content = system });
        msgs.AddRange(messages.Select(m => (object)new { role = m.Role, content = m.Content }));
        if (extraMessages is not null) msgs.AddRange(extraMessages); // troca de ferramentas desta rodada (assistant tool_calls + tool)

        var body = new Dictionary<string, object?>
        {
            ["model"] = model,
            ["stream"] = true,
            ["messages"] = msgs,
            ["options"] = numGpu is null ? new { num_ctx = numCtx } : (object)new { num_ctx = numCtx, num_gpu = numGpu },
        };
        if (think is not null) body["think"] = think;
        if (tools is { Count: > 0 }) body["tools"] = tools;

        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/chat") { Content = JsonContent.Create(body) };
        using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!resp.IsSuccessStatusCode)
            throw new OllamaException(await ReadErrorAsync(resp, ct));

        using var reader = new StreamReader(await resp.Content.ReadAsStreamAsync(ct));
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;

            if (root.TryGetProperty("error", out var err))
                throw new OllamaException(err.GetString() ?? "Erro desconhecido do Ollama.");

            string? content = null, thinking = null;
            List<ToolCall>? toolCalls = null;
            if (root.TryGetProperty("message", out var msg))
            {
                if (msg.TryGetProperty("content", out var c)) content = c.GetString();
                if (msg.TryGetProperty("thinking", out var t)) thinking = t.GetString();
                if (msg.TryGetProperty("tool_calls", out var tc) && tc.ValueKind == JsonValueKind.Array)
                {
                    toolCalls = [];
                    foreach (var call in tc.EnumerateArray())
                        if (call.TryGetProperty("function", out var fn) && fn.TryGetProperty("name", out var fname))
                            toolCalls.Add(new ToolCall(fname.GetString() ?? "",
                                fn.TryGetProperty("arguments", out var a) ? a.Clone() : default));
                }
            }

            ChatStats? stats = null;
            if (root.TryGetProperty("done", out var done) && done.GetBoolean())
            {
                var evalCount = Int(root, "eval_count");
                var evalSec = Long(root, "eval_duration") / 1e9;
                stats = new ChatStats(
                    Int(root, "prompt_eval_count"), evalCount,
                    evalSec > 0 ? Math.Round(evalCount / evalSec, 1) : 0,
                    Math.Round(Long(root, "total_duration") / 1e9, 1),
                    Math.Round(Long(root, "load_duration") / 1e9, 1));
            }

            yield return new ChatChunk(content, thinking, stats, toolCalls);
        }
    }

    private static int Int(JsonElement e, string name) => e.TryGetProperty(name, out var v) ? v.GetInt32() : 0;
    private static long Long(JsonElement e, string name) => e.TryGetProperty(name, out var v) ? v.GetInt64() : 0;

    private static async Task<string> ReadErrorAsync(HttpResponseMessage resp, CancellationToken ct)
    {
        var text = await resp.Content.ReadAsStringAsync(ct);
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.TryGetProperty("error", out var e)) return e.GetString() ?? text;
        }
        catch (JsonException) { }
        return $"Ollama respondeu {(int)resp.StatusCode}: {text}";
    }
}
