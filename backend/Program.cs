using System.Text;
using System.Text.Json;
using LocalAi.Api;
using LocalAi.Api.Llm;
using LocalAi.Api.Mcp;
using LocalAi.Api.Memory;
using LocalAi.Api.Metrics;
using LocalAi.Api.Storage;
using LocalAi.Api.Tools;
using LocalAi.Api.Voice;

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
builder.Services.AddSingleton<VoiceEngine>();
builder.Services.AddSingleton(sp =>
{
    // MCP pronto de leitura de arquivos (markitdown); o caminho do executável vem do appsettings
    var cfg = builder.Configuration.GetSection("Mcp:Markitdown").Get<McpServerConfig>() ?? new McpServerConfig();
    var root = builder.Environment.ContentRootPath;
    if (!Path.IsPathRooted(cfg.Command)) cfg.Command = Path.GetFullPath(Path.Combine(root, cfg.Command));
    return new FileReader(cfg, Path.Combine(root, "data"));
});
builder.Services.AddHttpClient("search", http =>
{
    http.Timeout = TimeSpan.FromSeconds(8);
    http.DefaultRequestHeaders.UserAgent.ParseAdd("NexMind/1.0 (pesquisa local)");
});
builder.Services.AddSingleton<Research>();
builder.Services.AddSingleton(new McpRegistry(Path.Combine(builder.Environment.ContentRootPath, "mcp_servers.json")));
builder.Services.AddSingleton<ApprovalBroker>();
builder.Services.AddSingleton(sp => new ConversationMemory(sp.GetRequiredService<ConversationStore>()));

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
// Renomear: só o título muda; histórico, fatos e caderno ficam como estão
api.MapPatch("/conversations/{id}", (string id, RenameRequest body, ConversationStore s) =>
{
    if (string.IsNullOrWhiteSpace(body.Title)) return Results.BadRequest("O nome não pode ficar vazio.");
    return s.Rename(id, body.Title) is { } title ? Results.Ok(new { id, title }) : Results.NotFound();
});
// Caderno da conversa (índices e tópicos): leitura, para inspeção e testes
api.MapGet("/conversations/{id}/memory", (string id, ConversationMemory m) =>
{
    var (systemIndex, agentIndex) = m.Indexes(id);
    if (systemIndex.Length == 0 && agentIndex.Length == 0) return Results.NotFound();
    var topics = ConversationMemory.Topics.ToDictionary(t => t, t => m.Read(id, t, 20_000).Text);
    return Results.Ok(new { systemIndex, agentIndex, topics });
});

// --- Chat com streaming (NDJSON: {type: thinking|token|done|error, ...})
api.MapPost("/conversations/{id}/chat", async (string id, ChatRequest req, HttpContext ctx,
    ConversationStore store, OllamaClient ollama, Research research, McpRegistry mcp, ApprovalBroker approvals, ConversationMemory memory) =>
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
    if (conv.Messages.Count == 1)
    {
        // o título não deve mostrar o texto do arquivo anexado
        var plain = System.Text.RegularExpressions.Regex.Replace(userText, @"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]\s*", "").Trim();
        if (plain.Length == 0) plain = "Arquivo anexado";
        if (!conv.TitleEdited) conv.Title = plain.Length > 48 ? plain[..48] + "…" : plain;
        memory.SetIntent(conv.Id, userText); // 1ª mensagem = objetivo da conversa (intent.md), sem o texto dos anexos
    }
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
        // Regra base: respostas diretas. O modelo de 4B tende a escrever muito; texto longo custa tempo (tokens na GPU/CPU).
        var searchAddon = "";
        if (req.Search)
        {
            await Send(new { type = "tool", name = "pesquisa", state = "filtrando" });
            var (action, query, question) = await research.DecideAsync(req.Model, history, ct);
            if (action == "filtrar" && question.Length > 0)
            {
                content.Append(question);
                await Send(new { type = "token", text = question });
                await Send(new { type = "tool", name = "pesquisa", state = "pronta" });
            }
            else if (action == "pesquisar")
            {
                await Send(new { type = "tool", name = "pesquisa", state = "executando", query });
                var hits = await research.SearchAsync(query, ct);
                var notes = hits.Count == 0
                    ? "A busca não devolveu trechos. Diga isso e não invente o fato."
                    : string.Join("\n", hits.Select(h => $"- {h.Title} ({h.Url}): {h.Snippet}"));
                searchAddon = $"\n\nPesquisa autorizada para esta tarefa, consulta \"{query}\":\n{notes}\nResponda com base nesses trechos e cite a fonte. Não invente o que não estiver aí.";
                await Send(new { type = "tool", name = "pesquisa", state = "pronta" });
            }
            else await Send(new { type = "tool", name = "pesquisa", state = "pronta" });
        }
        if (content.Length == 0) // pesquisa pediu esclarecimento: pergunta já enviada, não chama o modelo
        {
        // Qwen3 4B tem 36 camadas. Acima de 16 mil tokens, 24 ficam na GPU e 12 na RAM desde o carregamento.
        int? numGpu = req.NumCtx > 16384 ? 24 : null;

        // Ferramentas MCP (só quando o usuário ligou): o modelo pode pedir uma ferramenta; o backend executa e devolve o resultado.
        IReadOnlyList<NexTool> mcpTools = [];
        if (req.Tools || req.Browser)
        {
            await Send(new { type = "mcp", name = "mcp", state = "carregando" });
            var all = await mcp.GetToolsAsync(false, ct);
            mcpTools = all.Where(t => (req.Tools && t.Server == "arquivos") || (req.Browser && t.Server == "browser")).ToList();
        }
        var fileTools = mcpTools.Where(t => t.Server == "arquivos").ToList();
        var browserTools = mcpTools.Where(t => t.Server == "browser").ToList();
        var agora = DateTime.Now.ToString("dddd, dd 'de' MMMM 'de' yyyy, HH:mm:ss", System.Globalization.CultureInfo.GetCultureInfo("pt-BR"));
        var system =
            $"Data e hora atual do sistema: {agora} (Horário local do Alexssander).\n" +
            "Você é o Nex, um assistente de IA local e inteligente rodando no computador do usuário. " +
            "Seu criador e usuário é o Alexssander, um Desenvolvedor e Pentester experiente. " +
            "Comunicação: seja direto, técnico, profissional e vá direto ao ponto, sem enrolação nem fechamentos clichês como 'espero ter ajudado'. " +
            "Quando estiver operando ferramentas, seja ultra-conciso para poupar contexto e tempo de GPU. " +
            "Quando estiver conversando conceitualmente com o Alexssander, responda com profundidade técnica e parceria.\n\n" +
            "Arquitetura de Ferramentas (MCP - Model Context Protocol):\n" +
            "- Você tem acesso a servidores MCP que expandem seu poder além do chat.\n" +
            "- NUNCA PROMETA O QUE NÃO TEM FERRAMENTA: só diga que vai fazer algo se existir uma ferramenta na lista para isso. Se não existir, diga com clareza que não consegue e, se fizer sentido, mostre o comando para o Alexssander executar. Não peça confirmação para uma ação que você não tem como executar.\n" +
            "Diretrizes de Ação e Leitura (Regra de Ouro):\n" +
            "- LEITURA E ANÁLISE SÃO 100% LIVRES: Você tem autorização TOTAL do Alexssander para LER e inspecionar qualquer página da web, tela, código ou documento.\n" +
            "- NUNCA ADIVINHE NEM ALUCINE: Se o Alexssander perguntar o que tem na página do grupo Nex, chame browser__browser_get_dom antes de responder. Não invente o nome da conta. Não leia abas fora desse grupo.\n" +
            "- CONTEÚDOS VISÍVEIS NÃO SÃO PROIBIDOS: Nomes de perfil, avatares, textos de páginas e dados visíveis no navegador são públicos para você ler e informar ao Alexssander.\n" +
            "- SE ENCONTRAR TOKENS OU DADOS CRÍTICOS: Leia e oriente o Alexssander com postura de segurança e pentester ('Atenção, identifiquei este dado exposto na página'), mas NUNCA trave a conversa nem se recuse a ler.\n" +
            "- APROVAÇÃO (Human-in-the-Loop) É EXCLUSIVA PARA MUTAÇÃO: Somente ações que alteram o sistema (clicar em botões com browser_click, submeter forms, editar/salvar arquivos) exigem autorização. Leitura NUNCA pede aprovação e NUNCA é bloqueada.\n\n" +
            "Estado Atual das Ferramentas nesta conversa:\n" +
            "- Leitor de Anexos: ATIVO. O Alexssander pode anexar PDFs, DOCX, planilhas, códigos e textos pelo botão de clipe. O conteúdo vem na mensagem entre [[ARQUIVO]] e [[/ARQUIVO]].\n";
        system += fileTools.Count > 0
            ? $"- MCP Arquivos do Nex: LIGADO ({string.Join(", ", fileTools.Select(t => t.QualifiedName))}). Você pode ler arquivos do PC e criar/editar arquivos com aprovação dele. Se faltar o caminho, pergunte. Você NÃO tem ferramenta para apagar, mover ou renomear arquivos, nem para rodar comandos: se pedirem isso, diga que não consegue.\n"
            : "- MCP Arquivos do Nex: DESLIGADO. Se o Alexssander pedir para você ler, criar ou modificar arquivos do PC, avise-o diretamente: 'Para eu mexer em arquivos, por favor ligue o interruptor \"Arquivos do Nex\" no painel lateral de Ferramentas.'\n";
        system += browserTools.Count > 0
            ? $"- MCP Navegador: LIGADO, no Chrome que o Alexssander já tem aberto e logado ({string.Join(", ", browserTools.Select(t => t.QualifiedName))}). Sua mesa de trabalho é o grupo de abas verde chamado Nex, com várias abas: é o único lugar onde você enxerga e age. O Alexssander pode abrir Gmail, LinkedIn, GitHub etc. dentro desse grupo, já logado, e pedir para você trabalhar neles; você também pode abrir sites (o grupo é criado por você: nunca peça para ele criar). Cada ferramenta traz na descrição o que faz, quando usar, como usar e o que NÃO fazer: siga à risca. Regras gerais: (1) no começo de uma tarefa, chame browser_tabs; (2) leia a página com browser_get_dom antes de afirmar qualquer coisa sobre ela; (3) depois de clicar ou digitar, leia de novo e relate só o que leu, sem inventar; (4) pedido com várias partes: uma de cada vez, na ordem, e responda no fim cobrindo todas; (5) se uma ferramenta disser que o ritmo está alto, que o site está fora do escopo ou bloqueado, ou que a extensão não respondeu, conte isso em uma frase e pare de insistir; (6) nunca peça para fechar ou reiniciar o Chrome; se a extensão não estiver ligada, diga para recarregar uma vez a pasta extension/chrome em chrome://extensions.\n"
            : "- MCP Navegador: DESLIGADO. Se o Alexssander pedir para você acessar links, ler páginas web ou automatizar sites, avise-o: 'Para eu acessar seu navegador e abas, por favor ligue o interruptor \"Navegador\" no painel lateral de Ferramentas.'\n";
        system += "\nRegra de Seleção de Ferramentas:\n" +
                  "- PÁGINAS DA WEB: use o MCP Navegador só no grupo de abas Nex. Nunca peça para rodar iniciar-chrome-sessao.ps1 e nunca peça para reabrir o Chrome.\n" +
                  "- APLICATIVOS E JANELAS DO WINDOWS (Bloco de Notas, Calculadora, alternar janelas, atalhos do sistema): use o MCP Computador (desktop_list_windows, desktop_inspect_window, desktop_click_element).\n" +
                  "NUNCA use o MCP Computador para tentar ler o conteúdo interno de uma página web dentro do Chrome.\n";
        system += req.Search
            ? "- Pesquisa na web: LIGADA. Cite a fonte e não invente o que a busca não trouxe.\n"
            : "- Pesquisa na web: DESLIGADA. Se ele pedir um fato da internet sem abrir o navegador, avise: 'Para eu pesquisar na web, ligue \"Pesquisa na web\" em Ferramentas.'\n";
        // Micro-RAG da conversa: só os dois índices compactos (~120 tokens). O detalhe fica em disco, atrás de topic_read.
        var (systemIndex, agentIndex) = memory.Indexes(conv.Id);
        system += "\nSUA MEMÓRIA (existe e funciona; nunca diga que não tem memória): cada conversa tem uma pasta em disco que sobrevive a fechar e reabrir o Nex. Ela guarda: (1) o histórico das mensagens; (2) o ÍNDICE DO SISTEMA, com o objetivo da conversa e os fatos que as ferramentas comprovaram (você só lê); (3) o SEU CADERNO (scratchpad), onde você anota hipóteses, planos e pendências com topic_write e relê com topic_read. Cada conversa tem a sua memória: o que foi anotado numa conversa não aparece em outra. Quando o Alexssander perguntar sobre a sua memória, explique isso em poucas linhas, diga o que já está guardado nesta conversa (veja os índices abaixo) e ofereça anotar algo. Se ele disser para lembrar ou anotar algo, chame topic_write na hora.\n" +
                  "\n=== CONTEXTO DA CONVERSA (ÍNDICE DO SISTEMA: fatos comprovados, você só lê) ===\n" + systemIndex +
                  "\n=== SEU CADERNO DE RACIOCÍNIO (ÍNDICE DO AGENTE: suas hipóteses e notas) ===\n" + agentIndex +
                  "\nPara consultar detalhes ou registrar hipóteses, use as ferramentas topic_read e topic_write. Quando o Alexssander perguntar o que foi anotado, combinado ou comprovado, chame topic_read antes de responder; quando ele pedir para anotar algo, chame topic_write.\n";
        if (!string.IsNullOrWhiteSpace(req.System)) system += "\n\nInstrução adicional da conversa: " + req.System;
        system += searchAddon;
        var ollamaTools = mcpTools.Select(t => (object)new
        {
            type = "function",
            function = new { name = t.QualifiedName, description = t.Description, parameters = t.Schema },
        }).ToList();
        ollamaTools.AddRange(NotebookTools.Definitions()); // topic_read e topic_write: sempre disponíveis, vinculadas a esta conversa
        var extra = new List<object>();
        // Tarefas de navegador (abrir, ler, clicar, ler de novo) precisam de mais passos que ler um arquivo.
        var MaxToolRounds = browserTools.Count > 0 ? 12 : 4;
        // Custo de contexto: cada leitura é cortada em ~metade do contexto (em caracteres, 1500..8000) e a rodada inteira
        // não passa de ~1 caractere por token de contexto; acabou o orçamento, o modelo responde com o que já leu.
        var resultCap = Math.Clamp(req.NumCtx / 2, 1500, 8000);
        var turnBudget = browserTools.Count > 0 ? req.NumCtx * 3 / 2 : req.NumCtx;

        for (var round = 0; round <= MaxToolRounds; round++)
        {
            if (round == MaxToolRounds)
            {
                // Última rodada: sem ferramentas. Sem este aviso o modelo tenta chamar uma ferramenta e escreve a chamada como texto.
                extra.Add(new { role = "user", content = "[sistema] Você atingiu o limite de ferramentas desta resposta. Responda agora com o que já leu, sem chamar mais ferramentas, e diga o que ficou por fazer." });
            }
            List<ToolCall>? calls = null;
            var roundText = new StringBuilder();
            await foreach (var chunk in ollama.ChatAsync(req.Model, system, history, req.NumCtx, req.Think, numGpu,
                               extra, round < MaxToolRounds ? ollamaTools : null, ct))
            {
                if (!string.IsNullOrEmpty(chunk.Thinking))
                {
                    thinking.Append(chunk.Thinking);
                    await Send(new { type = "thinking", text = chunk.Thinking });
                }
                if (!string.IsNullOrEmpty(chunk.Content))
                {
                    content.Append(chunk.Content);
                    roundText.Append(chunk.Content);
                    await Send(new { type = "token", text = chunk.Content });
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
                if (NotebookTools.IsNotebookTool(call.Name))
                {
                    // caderno da conversa: nativo, sem aprovação (só lê ou acrescenta notas na pasta desta conversa)
                    await Send(new { type = "mcp", name = call.Name, state = "executando" });
                    var (nbOk, nbText) = NotebookTools.Handle(call, memory, conv.Id, Math.Min(resultCap, Math.Max(turnBudget, 500)));
                    turnBudget -= nbText.Length;
                    await Send(new { type = "mcp", name = call.Name, state = nbOk ? "concluida" : "falhou" });
                    extra.Add(new { role = "tool", tool_name = call.Name, content = nbOk ? nbText : "ERRO: " + nbText });
                    continue;
                }
                var tool = mcpTools.FirstOrDefault(t => t.QualifiedName == call.Name);
                string result;
                if (tool is null) result = $"A ferramenta '{call.Name}' não existe.";
                else
                {
                    var allowed = true;
                    // Nada é proibido: caminho sensível ou escrita fora da pasta de trabalho exigem aprovação COM aviso das consequências
                    var warning = mcp.Assess(tool, call.Arguments);
                    if (turnBudget < 500)
                    {
                        extra.Add(new { role = "tool", tool_name = call.Name, content = "Orçamento de leitura desta resposta esgotado. Responda com o que já leu e diga o que faltou." });
                        continue;
                    }
                    if (tool.RequiresApproval || warning is not null)
                    {
                        // Human-in-the-loop: pausa e espera o clique de Autorizar/Rejeitar na interface
                        var approvalId = approvals.Open(out var decision);
                        await Send(new { type = "approval", id = approvalId, tool = tool.QualifiedName, server = tool.Server, name = tool.Name, args = call.Arguments, write = tool.IsWrite, warning });
                        try { allowed = await decision.WaitAsync(ApprovalBroker.Timeout, ct); }
                        catch (TimeoutException) { allowed = false; }
                        finally { approvals.Close(approvalId); }
                    }
                    if (!allowed)
                    {
                        result = "O usuário recusou esta ação (ou não respondeu a tempo). Não tente executá-la de novo; diga o que você faria.";
                        await Send(new { type = "mcp", name = tool.QualifiedName, state = "recusada" });
                    }
                    else
                    {
                        await Send(new { type = "mcp", name = tool.QualifiedName, state = "executando" });
                        var r = await mcp.CallAsync(tool, call.Arguments, Math.Min(resultCap, turnBudget), ct);
                        turnBudget -= r.Text.Length;
                        result = r.Ok ? r.Text : "ERRO: " + r.Text;
                        // motor de fatos: o que a ferramenta comprovou vai para facts.md (sem custo de GPU)
                        if (r.Ok && FactExtractor.Extract(tool.Name, call.Arguments, r.Text) is { } fact) memory.AddFact(conv.Id, fact);
                        await Send(new { type = "mcp", name = tool.QualifiedName, state = r.Ok ? "concluida" : "falhou" });
                    }
                }
                extra.Add(new { role = "tool", tool_name = call.Name, content = result });
            }
        }
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
            thinking.Length > 0 ? thinking.ToString() : null, DateTime.UtcNow, stats, req.Model));
    // se você renomeou a conversa enquanto o Nex respondia, o nome novo vale (esta cópia em memória é anterior)
    if (store.Get(id) is { TitleEdited: true } renamed) { conv.Title = renamed.Title; conv.TitleEdited = true; }
    store.Save(conv);

    if (ct.IsCancellationRequested) return;
    await Send(error is null ? new { type = "done", stats } : new { type = "error", message = error });
});

// --- Anexos: lê o arquivo (PDF, DOCX, md, texto, código...) e devolve o texto para ir junto da mensagem
api.MapPost("/files/read", async (HttpRequest request, FileReader files, CancellationToken ct) =>
{
    if (!request.HasFormContentType) return Results.BadRequest("Envie o arquivo como multipart.");
    var form = await request.ReadFormAsync(ct);
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0) return Results.BadRequest("Arquivo vazio.");
    if (file.Length > FileReader.MaxBytes) return Results.BadRequest("Arquivo maior que 25 MB.");
    var maxChars = int.TryParse(request.Query["maxChars"], out var mc) ? Math.Clamp(mc, 500, 200_000) : 8000;
    try { return Results.Ok(await files.ReadAsync(file, maxChars, ct)); }
    catch (Exception ex) when (ex is InvalidOperationException or TimeoutException or IOException)
    {
        return Results.Problem("Não consegui ler o arquivo: " + ex.Message, statusCode: 422);
    }
});

// --- MCP: ferramentas disponíveis e aprovação humana das que mudam estado
api.MapGet("/mcp/tools", async (McpRegistry mcp, bool? refresh, CancellationToken ct) =>
    (await mcp.GetToolsAsync(refresh == true, ct)).Select(t => new { t.Server, t.Name, t.Description, t.RequiresApproval }));
api.MapPost("/approvals/{id}", (string id, ApprovalDecision d, ApprovalBroker approvals) =>
    approvals.Resolve(id, d.Approve) ? Results.NoContent() : Results.NotFound());

api.MapGet("/voice/status", (VoiceEngine voice) => new
{
    engines = voice.List(),
    voices = voice.WindowsVoices(),
    whisperModel = voice.Options.WhisperModel,
});

api.MapPost("/voice/transcribe", async (HttpRequest request, VoiceEngine voice, CancellationToken ct) =>
{
    if (!request.HasFormContentType) return Results.BadRequest("Envie o áudio em multipart (campo audio).");
    var form = await request.ReadFormAsync(ct);
    var file = form.Files["audio"];
    if (file is null || file.Length == 0) return Results.BadRequest("Áudio vazio.");
    if (file.Length > 8 * 1024 * 1024) return Results.BadRequest("Áudio acima de 8 MB.");
    var tmp = Path.Combine(Path.GetTempPath(), "nex-stt-" + Guid.NewGuid().ToString("n") + ".wav");
    try
    {
        await using (var fs = File.Create(tmp))
            await file.CopyToAsync(fs, ct);
        var (text, ms) = await voice.TranscribeAsync(tmp, ct);
        return Results.Ok(new { text, sttMs = ms });
    }
    catch (InvalidOperationException ex)
    {
        return Results.Problem(ex.Message, statusCode: 503);
    }
    finally
    {
        try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* temporário */ }
    }
});

api.MapPost("/voice/speak", async (SpeakRequest req, VoiceEngine voice, HttpContext ctx) =>
{
    var text = (req.Text ?? "").Trim();
    if (text.Length == 0) { ctx.Response.StatusCode = 400; return; }
    if (text.Length > 4000) text = text[..4000];
    try
    {
        var (wav, ms, engine) = await voice.SpeakAsync(text, req.Engine ?? "sapi", req.Voice, req.Rate <= 0 ? 1 : req.Rate, ctx.RequestAborted);
        ctx.Response.ContentType = "audio/wav";
        ctx.Response.Headers["X-Tts-Ms"] = ms.ToString();
        ctx.Response.Headers["X-Tts-Engine"] = engine;
        await ctx.Response.Body.WriteAsync(wav, ctx.RequestAborted);
    }
    catch (InvalidOperationException ex)
    {
        ctx.Response.StatusCode = 503;
        await ctx.Response.WriteAsync(ex.Message);
    }
});

app.MapFallbackToFile("index.html");
app.Run();
