using System.Text;
using System.Text.Json;
using LocalAi.Api;
using LocalAi.Api.Llm;
using LocalAi.Api.Metrics;
using LocalAi.Api.Storage;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<OllamaOptions>(builder.Configuration.GetSection("Ollama"));
builder.Services.AddHttpClient<OllamaClient>((sp, http) =>
{
    var opts = builder.Configuration.GetSection("Ollama").Get<OllamaOptions>() ?? new OllamaOptions();
    http.BaseAddress = new Uri(opts.BaseUrl);
    http.Timeout = Timeout.InfiniteTimeSpan; // streaming longo; cancelamento vem do cliente
});
builder.Services.AddSingleton(new ConversationStore(Path.Combine(builder.Environment.ContentRootPath, "data", "conversations")));
builder.Services.AddSingleton<SystemMetrics>();

var app = builder.Build();
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);

app.UseDefaultFiles();
app.UseStaticFiles();

var api = app.MapGroup("/api");

// --- Conexão com o Ollama + modelos instalados
api.MapGet("/status", (OllamaClient ollama, CancellationToken ct) => ollama.GetStatusAsync(ct));

// --- Consumo de recursos (máquina + modelo carregado)
api.MapGet("/metrics", async (SystemMetrics sys, OllamaClient ollama, CancellationToken ct) =>
{
    var machine = await sys.ReadAsync(ct);
    var loaded = await ollama.GetLoadedModelAsync(ct);
    return new { machine, loadedModel = loaded };
});

// --- Conversas
api.MapGet("/conversations", (ConversationStore s) => s.List());
api.MapPost("/conversations", (ConversationStore s) => s.Create());
api.MapGet("/conversations/{id}", (string id, ConversationStore s) =>
    s.Get(id) is { } c ? Results.Ok(c) : Results.NotFound());
api.MapDelete("/conversations/{id}", (string id, ConversationStore s) =>
    s.Delete(id) ? Results.NoContent() : Results.NotFound());

// --- Chat com streaming (NDJSON: {type: thinking|token|done|error, ...})
api.MapPost("/conversations/{id}/chat", async (string id, ChatRequest req, HttpContext ctx,
    ConversationStore store, OllamaClient ollama) =>
{
    var ct = ctx.RequestAborted;
    var conv = store.Get(id);
    if (conv is null) { ctx.Response.StatusCode = 404; return; }
    if (string.IsNullOrWhiteSpace(req.Content) || string.IsNullOrWhiteSpace(req.Model) || req.NumCtx < 256)
    {
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsync("Conteúdo, modelo e contexto (>= 256) são obrigatórios.");
        return;
    }

    var userText = req.Content.Trim();
    conv.Messages.Add(new Message("user", userText, null, DateTime.UtcNow, null));
    if (conv.Messages.Count == 1) conv.Title = userText.Length > 48 ? userText[..48] + "…" : userText;
    conv.Model = req.Model;
    store.Save(conv); // a pergunta fica salva mesmo se o Ollama falhar

    ctx.Response.ContentType = "application/x-ndjson";
    async Task Send(object o)
    {
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(o, json) + "\n", ct);
        await ctx.Response.Body.FlushAsync(ct);
    }

    var content = new StringBuilder();
    var thinking = new StringBuilder();
    ChatStats? stats = null;
    string? error = null;

    try
    {
        var history = conv.Messages.Select(m => (m.Role, m.Content)).ToList();
        await foreach (var chunk in ollama.ChatAsync(req.Model, req.System, history, req.NumCtx, req.Think, ct))
        {
            if (!string.IsNullOrEmpty(chunk.Thinking))
            {
                thinking.Append(chunk.Thinking);
                await Send(new { type = "thinking", text = chunk.Thinking });
            }
            if (!string.IsNullOrEmpty(chunk.Content))
            {
                content.Append(chunk.Content);
                await Send(new { type = "token", text = chunk.Content });
            }
            if (chunk.Stats is not null) stats = chunk.Stats;
        }
    }
    catch (OperationCanceledException) { /* usuário parou ou fechou a aba: salva o parcial */ }
    catch (OllamaException ex) { error = ex.Message; }
    catch (HttpRequestException)
    {
        error = "Não foi possível conectar ao Ollama. Verifique se ele está em execução.";
    }

    if (content.Length > 0 || thinking.Length > 0)
        conv.Messages.Add(new Message("assistant", content.ToString(),
            thinking.Length > 0 ? thinking.ToString() : null, DateTime.UtcNow, stats));
    store.Save(conv);

    if (ct.IsCancellationRequested) return;
    await Send(error is null ? new { type = "done", stats } : new { type = "error", message = error });
});

app.MapFallbackToFile("index.html");
app.Run();
