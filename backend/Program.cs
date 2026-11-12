using System.Text;
using System.Text.Json;
using LocalAi.Api;
using LocalAi.Api.Llm;
using LocalAi.Api.Mcp;
using LocalAi.Api.Memory;
using LocalAi.Api.Metrics;
using LocalAi.Api.Planning;
using LocalAi.Api.Security;
using LocalAi.Api.Storage;
using LocalAi.Api.Tools;
using LocalAi.Api.Dev;
using LocalAi.Api.Rag;
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
builder.Services.AddSingleton(new RagEngine(Path.Combine(builder.Environment.ContentRootPath, "data", "conversations")));
builder.Services.AddSingleton<WorkspaceManager>();
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
builder.Services.AddSingleton<OsintEngine>();
// recon real: o probe HTTP mostra o redirecionamento em vez de segui-lo
builder.Services.AddHttpClient("recon", http =>
{
    http.Timeout = TimeSpan.FromSeconds(8);
    http.DefaultRequestHeaders.UserAgent.ParseAdd("NexMind-Recon/1.0 (recon local do operador)");
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddHttpClient("recon-slow", http =>
{
    http.Timeout = TimeSpan.FromSeconds(25);
    http.DefaultRequestHeaders.UserAgent.ParseAdd("NexMind-Recon/1.0 (recon local do operador)");
});
builder.Services.AddSingleton<ReconEngine>();
builder.Services.AddSingleton(new McpRegistry(Path.Combine(builder.Environment.ContentRootPath, "mcp_servers.json")));
builder.Services.AddSingleton<ApprovalBroker>();
builder.Services.AddSingleton(sp => new ConversationMemory(sp.GetRequiredService<ConversationStore>()));
builder.Services.AddSingleton(sp => new SecurityNotes(sp.GetRequiredService<ConversationStore>()));
builder.Services.AddSingleton<LocalAi.Api.Services.BackgroundTaskManager>();
builder.Services.AddTransient<SubagentRunner>();

var app = builder.Build();
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
app.UseDefaultFiles();
app.UseStaticFiles();

var api = app.MapGroup("/api");

// --- Conexão com o Ollama + modelos instalados
api.MapGet("/status", (OllamaClient ollama, CancellationToken ct) => ollama.GetStatusAsync(ct));

// --- Tarefas em background ativas (para resiliência a F5 e navegação)
api.MapGet("/tasks/active", (LocalAi.Api.Services.BackgroundTaskManager tm) => tm.ListActive());
api.MapPost("/tasks/{id}/cancel", (string id, LocalAi.Api.Services.BackgroundTaskManager tm) => { tm.CancelTask(id); return Results.Ok(); });

// --- Consumo de recursos (máquina + modelo carregado)
api.MapGet("/metrics", async (SystemMetrics sys, OllamaClient ollama, CancellationToken ct) =>
{
    var machine = await sys.ReadAsync(ct);
    var loaded = await ollama.GetLoadedModelAsync(ct);
    return new { machine, loadedModel = loaded };
});

// --- Conversas
// ?mode=general|security|dev lista só as conversas daquele workspace; sem o parâmetro, todas (cada item traz o mode)
api.MapGet("/conversations", (string? mode, ConversationStore s) => s.List(mode));
// ?mode=... vincula a conversa nova ao workspace ativo
api.MapPost("/conversations", (string? mode, ConversationStore s) => s.Create(mode));
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
// Micro-RAG: ingestão em background e listagem dos arquivos já fatiados
api.MapPost("/conversations/{id}/rag/upload", async (string id, HttpRequest req, ConversationStore store, RagEngine rag, CancellationToken ct) =>
{
    if (store.FolderFor(id) is null) return Results.NotFound();
    if (!req.HasFormContentType) return Results.BadRequest("Envie o arquivo como multipart.");
    var form = await req.ReadFormAsync(ct);
    var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
    if (file is null || file.Length == 0) return Results.BadRequest("Arquivo vazio.");
    await using var buffer = new MemoryStream();
    await file.CopyToAsync(buffer, ct);
    var fileId = rag.StartIngest(id, buffer.ToArray(), file.FileName);
    return Results.Accepted($"/api/conversations/{id}/rag/files", new { fileId });
});
api.MapGet("/conversations/{id}/rag/files", (string id, ConversationStore store, RagEngine rag) =>
    store.FolderFor(id) is null ? Results.NotFound() : Results.Ok(rag.GetFiles(id)));

// Caderno da conversa (índices e tópicos): leitura, para inspeção e testes
api.MapGet("/conversations/{id}/memory", (string id, ConversationMemory m) =>
{
    var (systemIndex, agentIndex) = m.Indexes(id);
    if (systemIndex.Length == 0 && agentIndex.Length == 0) return Results.NotFound();
    var topics = ConversationMemory.Topics.ToDictionary(t => t, t => m.Read(id, t, 20_000).Text);
    return Results.Ok(new { systemIndex, agentIndex, topics });
});

// --- Nex Security: subagentes especialistas (micro-chat) e as anotações deles (micro-RAG sob demanda)
api.MapGet("/security/agents", () => SubagentCatalog.All.Select(a => new { a.Id, a.Name, a.Emoji, a.Summary }));
// histórico do micro-chat de um especialista e o índice das anotações (a tela abre o modal com isto)
api.MapGet("/conversations/{id}/security/{agent}", (string id, string agent, ConversationStore store, SecurityNotes notes) =>
{
    if (SubagentCatalog.Find(agent) is not { } a || store.FolderFor(id) is null) return Results.NotFound();
    return Results.Ok(new { agent = a.Id, messages = notes.LoadChat(id, a.Id), notes = notes.Read(id, a.Id, 20_000) });
});
// as 6 gavetas da investigação: contagens, leitura e gravação (o que o Alexssander edita é o que os agentes consultam)
api.MapGet("/conversations/{id}/security-vault", (string id, ConversationStore store, SecurityNotes notes) =>
    store.FolderFor(id) is null ? Results.NotFound() : Results.Ok(notes.VaultCounts(id)));
api.MapGet("/conversations/{id}/security-vault/{key}", (string id, string key, ConversationStore store, SecurityNotes notes) =>
{
    if (!SecurityNotes.VaultKeys.Contains(key) || store.FolderFor(id) is null) return Results.NotFound();
    var (text, updatedAt) = notes.ReadVault(id, key);
    return Results.Ok(new { key, text, updatedAt, count = SecurityNotes.CountItems(text) });
});
api.MapPut("/conversations/{id}/security-vault/{key}", (string id, string key, VaultWrite body, ConversationStore store, SecurityNotes notes) =>
{
    if (!SecurityNotes.VaultKeys.Contains(key) || store.FolderFor(id) is null) return Results.NotFound();
    var error = notes.WriteVault(id, key, body.Text);
    if (error is not null) return Results.BadRequest(new { error });
    var (text, updatedAt) = notes.ReadVault(id, key);
    return Results.Ok(new { key, text, updatedAt, count = SecurityNotes.CountItems(text) });
});
api.MapPost("/conversations/{id}/security/{agent}/chat", async (string id, string agent, SubagentRequest req, HttpContext ctx,
    ConversationStore store, SubagentRunner runner) =>
{
    if (SubagentCatalog.Find(agent) is not { } a || store.FolderFor(id) is null) { ctx.Response.StatusCode = 404; return; }
    if (string.IsNullOrWhiteSpace(req.Content) || string.IsNullOrWhiteSpace(req.Model) || req.NumCtx < 256)
    {
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsync("Conteúdo, modelo e contexto (>= 256) são obrigatórios.");
        return;
    }
    var ct = ctx.RequestAborted;
    ctx.Response.ContentType = "application/x-ndjson";
    async Task Send(object o)
    {
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(o, json) + "\n", ct);
        await ctx.Response.Body.FlushAsync(ct);
    }
    await runner.RunAsync(id, a, req.Content.Trim(), req.Model, req.NumCtx, Send, ct);
});

// --- Chat com streaming (NDJSON: {type: thinking|token|done|error, ...})
api.MapPost("/conversations/{id}/chat", async (string id, ChatRequest req, HttpContext ctx,
    ConversationStore store, OllamaClient ollama, Research research, McpRegistry mcp, ApprovalBroker approvals, ConversationMemory memory, SecurityNotes secNotes, RagEngine rag, LocalAi.Api.Services.BackgroundTaskManager taskManager, ReconEngine recon, WorkspaceManager workspace) =>
{
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

    var history = conv.Messages.Select(m => (m.Role, m.Content)).ToList();
    var osintTarget = OsintEngine.ResolveTarget(userText, history);
    var taskTitle = osintTarget is not null ? $"OSINT: {osintTarget}" : userText.Length > 28 ? userText[..28] + "…" : userText;
    // Tarefa desacoplada em background: F5 ou troca de aba não abortam o processamento
    var activeTask = taskManager.StartTask(id, conv.Mode, taskTitle, out var taskCt);
    var ct = taskCt;

    ctx.Response.ContentType = "application/x-ndjson";
    async Task Send(object o)
    {
        if (ctx.RequestAborted.IsCancellationRequested) return;
        try
        {
            await ctx.Response.WriteAsync(JsonSerializer.Serialize(o, json) + "\n", ctx.RequestAborted);
            await ctx.Response.Body.FlushAsync(ctx.RequestAborted);
        }
        catch { /* Se o usuário deu F5 ou navegou, a conexão HTTP encerra mas a tarefa de background continua gerando */ }
    }

    var content = new StringBuilder();
    var thinking = new StringBuilder();
    ChatStats? stats = null;
    string? error = null;

    try
    {
        // Regra base: respostas diretas. O modelo de 4B tende a escrever muito; texto longo custa tempo (tokens na GPU/CPU).
        var textLower = userText.ToLowerInvariant();
        // pesquisa na web liga pela frase ("pesquise na internet…", "busque no google…"), sem interruptor; o filtro antes da busca continua
        var kind = OperatorIntent.Classify(userText);
        if (osintTarget is null && (kind == OperatorIntentKind.Execution || OperatorIntent.WantsScope(userText)))
            osintTarget = OperatorIntent.TargetFromScope(secNotes.ReadVault(conv.Id, "scope").Text);
        var wantsOsint = kind == OperatorIntentKind.Execution && (OsintEngine.WantsInvestigation(userText) || osintTarget is not null);
        var autoSearch = kind != OperatorIntentKind.Capabilities && kind != OperatorIntentKind.Planning &&
            (req.Search || IntentRouter.WantsSearch(userText) || textLower.Contains("pesquisa na web") || textLower.Contains("pesquise na internet") || wantsOsint);
        var searchAddon = "";
        string? investigationTarget = null;
        if (wantsOsint)
        {
            if (osintTarget is null)
            {
                var ask = "Qual é o alvo do OSINT: um nome ou um domínio?";
                content.Append(ask);
                await Send(new { type = "token", text = ask });
            }
            else
            {
                async Task Progress(string msg)
                {
                    thinking.Append(msg);
                    await Send(new { type = "thinking", text = msg });
                }
                await Progress($"💭 [Investigação OSINT]\n• Alvo: {osintTarget}\n• Escopo: Reconhecimento Passivo Multi-Vetores\n");
                var result = await research.InvestigateTargetAsync(osintTarget, Progress, taskCt);
                foreach (var fact in result.Facts)
                    memory.AddFact(conv.Id, fact);
                if (result.Hits.Count > 0)
                {
                    var current = secNotes.ReadVault(conv.Id, "surface").Text.Trim();
                    var lines = result.Hits.Select(h => $"- [CONFIRMED] {h.Title} | {h.Url}");
                    secNotes.WriteVault(conv.Id, "surface", (current + "\n" + string.Join("\n", lines)).Trim());
                }
                investigationTarget = osintTarget;
                var notes = result.Hits.Count == 0
                    ? "Nenhum registro encontrado em nenhum vetor."
                    : string.Join("\n", result.Hits.Select(h => $"- {h.Title} | {h.Url} | {h.Snippet}"));
                searchAddon = "\n\nREGRA DE OURO DA INTELIGÊNCIA:\n" +
                    "1. É terminantemente PROIBIDO gerar links ou citar redes sociais que NÃO constem na lista abaixo.\n" +
                    "2. Se um vetor veio vazio, escreva \"Nenhum registro encontrado\" ou omita. Jamais invente handle ou link no formato site.com/@usuario.\n" +
                    "3. Saída: Apresente o Sumário Executivo de Inteligência com os fatos confirmados de forma direta e concisa. Se a busca não retornou dados nesta consulta, diga claramente que não foram encontrados registros públicos indexados nesta consulta.\n\n" +
                    $"Alvo: {osintTarget}\nResultados brutos desta rodada:\n{notes}\n";
            }
        }
        else if (autoSearch)
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
                foreach (var h in hits)
                    if (FactExtractor.FromWeb(h.Title, h.Url) is { } line)
                        memory.AddFact(conv.Id, line);
                investigationTarget = query;
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
        // Ferramentas sob demanda: tudo começa DESLIGADO. Só a intenção da frase (ou um interruptor do usuário) injeta o que precisa,
        // porque cada definição de ferramenta custa tokens e contexto. "Bom dia Nex" não leva nenhuma.
        var (_, agentIndex0) = memory.Indexes(conv.Id);
        var hasRag = rag.GetFiles(conv.Id).Count > 0;
        var intent = IntentRouter.Route(userText, req.Tools, req.Browser, req.Desktop, hasNotes: agentIndex0.Contains("nota(s)"), hasRagFiles: hasRag);
        var autoBrowser = kind != OperatorIntentKind.Capabilities && kind != OperatorIntentKind.Planning && intent.Browser;
        var autoFiles = kind != OperatorIntentKind.Capabilities && kind != OperatorIntentKind.Planning && intent.Files;
        var autoDesktop = kind != OperatorIntentKind.Capabilities && kind != OperatorIntentKind.Planning && intent.Desktop;
        IReadOnlyList<NexTool> mcpTools = [];
        if (autoFiles || autoBrowser || autoDesktop)
        {
            await Send(new { type = "mcp", name = "mcp", state = "carregando" });
            var all = await mcp.GetToolsAsync(false, ct);
            mcpTools = all.Where(t =>
                (autoFiles && t.Server == "arquivos") ||
                (autoBrowser && t.Server == "browser") ||
                (autoDesktop && t.Server == "desktop")).ToList();
        }
        var fileTools = mcpTools.Where(t => t.Server == "arquivos").ToList();
        var browserTools = mcpTools.Where(t => t.Server == "browser").ToList();
        var desktopTools = mcpTools.Where(t => t.Server == "desktop").ToList();
        var agora = DateTime.Now.ToString("dddd, dd 'de' MMMM 'de' yyyy, HH:mm:ss", System.Globalization.CultureInfo.GetCultureInfo("pt-BR"));
        var system =
            $"Data e hora atual do sistema: {agora} (Horário local do Alexssander).\n" +
            "Você é o Nex, parceiro técnico sênior e amigo de bancada do Alexssander (desenvolvedor e pentester experiente), rodando local no computador dele. " +
            "Fale como um colega experiente: direto, calmo, confiante e técnico. Zero bajulação: nada de elogio vazio, de 'claro!', 'ótima pergunta' nem de 'espero ter ajudado'. " +
            "Texto curto e denso: vá ao ponto, dê a recomendação e o motivo em uma ou duas frases, com termos de engenharia. " +
            "Se discordar ou enxergar um risco, diga com franqueza e proponha a alternativa; se não souber, diga que não sabe. " +
            "Em conversa conceitual aprofunde com parceria, sem enrolar.\n\n" +
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
            : "- MCP Arquivos do Nex: não acionado nesta mensagem (liga sozinho pelo que o Alexssander pede, sem interruptor). Se ele pedir para ler, criar ou modificar arquivos do PC, peça só o caminho ou o nome do arquivo, pois a ferramenta entra assim que ele disser. NUNCA mande ele ligar nada.\n";
        system += browserTools.Count > 0
            ? $"- MCP Navegador: LIGADO, no Chrome que o Alexssander já tem aberto e logado ({string.Join(", ", browserTools.Select(t => t.QualifiedName))}). Sua mesa de trabalho é o grupo de abas verde chamado Nex, com várias abas: é o único lugar onde você enxerga e age. O Alexssander pode abrir Gmail, LinkedIn, GitHub etc. dentro desse grupo, já logado, e pedir para você trabalhar neles; você também pode abrir sites (o grupo é criado por você: nunca peça para ele criar). Cada ferramenta traz na descrição o que faz, quando usar, como usar e o que NÃO fazer: siga à risca. Regras gerais: (1) no começo de uma tarefa, chame browser_tabs; (2) leia a página com browser_get_dom antes de afirmar qualquer coisa sobre ela; (3) depois de clicar ou digitar, leia de novo e relate só o que leu, sem inventar; (4) pedido com várias partes: uma de cada vez, na ordem, e responda no fim cobrindo todas; (5) se uma ferramenta disser que o ritmo está alto, que o site está fora do escopo ou bloqueado, ou que a extensão não respondeu, conte isso em uma frase e pare de insistir; (6) nunca peça para fechar ou reiniciar o Chrome; se a extensão não estiver ligada, diga para recarregar uma vez a pasta extension/chrome em chrome://extensions.\n"
            : "- MCP Navegador: não acionado nesta mensagem (liga sozinho pelo que o Alexssander pede, sem interruptor). Se ele pedir para acessar links, ler páginas web ou mapear um site, peça só a URL ou diga para citar o endereço, pois a ferramenta entra assim que ele disser. NUNCA mande ele ligar nada.\n";
        system += desktopTools.Count > 0
            ? $"- MCP Computador: LIGADO ({string.Join(", ", desktopTools.Select(t => t.QualifiedName))}). Use só em janelas do Windows. Clique, digitação e atalho pedem aprovação.\n"
            : "- MCP Computador: não acionado nesta mensagem (liga sozinho pelo que ele pede). Se ele pedir para controlar um programa do Windows, peça o nome do programa ou da janela. NUNCA mande ele ligar nada.\n";
        system += "\nRegra de Seleção de Ferramentas:\n" +
                  "- PÁGINAS DA WEB: use o MCP Navegador só no grupo de abas Nex. Para MAPEAR a superfície (rotas, endpoints, formulários, parâmetros, scripts) use browser__browser_recon, que devolve um JSON curto; para LER o texto da página use browser__browser_get_dom.Nunca peça para rodar iniciar-chrome-sessao.ps1 e nunca peça para reabrir o Chrome.\n" +
                  "- APLICATIVOS E JANELAS DO WINDOWS (Bloco de Notas, Calculadora, alternar janelas, atalhos do sistema): use o MCP Computador (desktop_list_windows, desktop_inspect_window, desktop_click_element).\n" +
                  "NUNCA use o MCP Computador para tentar ler o conteúdo interno de uma página web dentro do Chrome.\n";
        system += autoSearch
            ? "- Pesquisa na web: LIGADA. Cite a fonte e não invente o que a busca não trouxe.\n"
            : "- Pesquisa na web: não acionada nesta mensagem (liga sozinha quando ele pede para pesquisar na internet). Se ele pedir um fato atual da internet, diga para ele pedir 'pesquise na internet ...'. NUNCA mande ele ligar nada.\n";
        system += intent.Any
            ? "\nSe for usar uma ferramenta, chame-a direto. Não escreva antes uma frase do tipo 'vou abrir' ou 'vou pesquisar': essa frase encerra o turno sem executar nada. A interface já mostra o status.\n"
            : "\nNesta resposta você NÃO tem ferramentas: responda direto, sem anunciar nem prometer ações como abrir sites, ler arquivos ou clicar.\n";
        // Micro-RAG da conversa: só os dois índices compactos (~120 tokens). O detalhe fica em disco, atrás de topic_read.
        var (systemIndex, agentIndex) = memory.Indexes(conv.Id);
        system += "\nSUA MEMÓRIA (existe e funciona; nunca diga que não tem memória): cada conversa tem uma pasta em disco que sobrevive a fechar e reabrir o Nex. Ela guarda: (1) o histórico das mensagens; (2) o ÍNDICE DO SISTEMA, com o objetivo da conversa e os fatos que as ferramentas comprovaram (você só lê); (3) o SEU CADERNO (scratchpad), onde você anota hipóteses, planos e pendências com topic_write e relê com topic_read. Cada conversa tem a sua memória: o que foi anotado numa conversa não aparece em outra. Quando o Alexssander perguntar sobre a sua memória, explique isso em poucas linhas, diga o que já está guardado nesta conversa (veja os índices abaixo) e ofereça anotar algo. Se ele disser para lembrar ou anotar algo, chame topic_write na hora.\n" +
                  "\n=== CONTEXTO DA CONVERSA (ÍNDICE DO SISTEMA: fatos comprovados, você só lê) ===\n" + systemIndex +
                  "\n=== SEU CADERNO DE RACIOCÍNIO (ÍNDICE DO AGENTE: suas hipóteses e notas) ===\n" + agentIndex +
                  "\nPara consultar detalhes ou registrar hipóteses, use as ferramentas topic_read e topic_write. Quando o Alexssander perguntar o que foi anotado, combinado ou comprovado, chame topic_read antes de responder; quando ele pedir para anotar algo, chame topic_write.\n";
        if (!string.IsNullOrWhiteSpace(req.System)) system += "\n\nInstrução adicional da conversa: " + req.System;
        // O escopo cadastrado na gaveta entra SEMPRE no modo Security (e em qualquer conversa que já tenha alvo salvo): é o alvo oficial
        // e vale mais que qualquer nome que uma regex tire da frase.
        var scopeText = secNotes.ReadVault(conv.Id, "scope").Text;
        if (conv.Mode == "security" || kind != OperatorIntentKind.Other || !string.IsNullOrWhiteSpace(scopeText))
            system += "\n\n" + OperatorIntent.Directive(kind, scopeText) + "\n";
        if (conv.Mode == "dev" && store.FolderFor(conv.Id) is { } devDir)
        {
            var session = workspace.LoadSession(devDir);
            if (!string.IsNullOrWhiteSpace(session.RootPath) && Directory.Exists(session.RootPath))
            {
                workspace.Open(session.RootPath);
                var digest = CodeScanner.Scan(session.RootPath);
                var active = "";
                var ext = "";
                if (!string.IsNullOrWhiteSpace(session.ActiveFile))
                {
                    try
                    {
                        active = workspace.Read(session.ActiveFile);
                        ext = Path.GetExtension(session.ActiveFile).TrimStart('.');
                    }
                    catch (InvalidOperationException) { active = ""; }
                }
                if (active.Length > 12_000) active = active[..12_000] + "\n…";
                system += "\n\n[ESTADO ATUAL DA BANCADA DEV]\n" +
                          $"Projeto: {session.RootPath}\nMapa Arquitetural do Projeto:\n{digest}\n\n" +
                          $"Arquivo em Edição na Tela: {session.ActiveFile}\nConteúdo Completo do Arquivo Ativo:\n```{ext}\n{active}\n```\n";
                if (!string.IsNullOrWhiteSpace(req.Selection))
                    system += $"[Trecho selecionado pelo usuário nas linhas {req.SelectionStart}-{req.SelectionEnd}: {req.Selection}]\n";
            }
        }
        // Micro-RAG de segurança SOB DEMANDA: as anotações dos subagentes só são lidas quando o Alexssander PERGUNTA por elas
        // ("O que o Recon achou?"). Em qualquer outra conversa nada de security/ é lido, e o Nex principal continua leve.
        var notesAsk = SecurityIntent.Detect(userText);
        if (notesAsk is not null)
        {
            system += "\n\n=== ANOTAÇÕES DOS SUBAGENTES DE SECURITY (lidas agora, porque o Alexssander perguntou por elas) ===\n" +
                      secNotes.BuildPromptBlock(conv.Id, notesAsk.AgentId, 3500) +
                      "\n=== fim das anotações ===\nResponda com base SÓ nelas: não invente achados que não estão escritos.\n";
        }
        system += searchAddon;
        var ollamaTools = mcpTools.Select(t => (object)new
        {
            type = "function",
            function = new { name = t.QualifiedName, description = t.Description, parameters = t.Schema },
        }).ToList();
        // recon real (DNS, RDAP, crt.sh, probe HTTP) e leitura das gavetas: no modo Security ou em pedido de execução; nunca em "o que você pode fazer?" nem em planejamento
        var reconTools = (conv.Mode == "security" || kind == OperatorIntentKind.Execution) && kind is not (OperatorIntentKind.Capabilities or OperatorIntentKind.Planning);
        if (reconTools)
        {
            ollamaTools.AddRange(ReconTools.Definitions());
            system += "\nFERRAMENTAS DE RECON REAIS: recon_target (DNS, RDAP, crt.sh e probe HTTP) e vault_read (gavetas). Não existe Burp, ZAP, Wappalyzer nem nmap: se pedirem, diga [TOOL_UNAVAILABLE]. Nunca escreva comando de terminal nem [ACTIVE_EXECUTION] fingindo que rodou algo; chame a ferramenta.\n";
        }
        if (intent.Notebook) ollamaTools.AddRange(NotebookTools.Definitions()); // topic_read e topic_write só quando a frase fala do caderno ou ele já tem notas
        if (intent.Rag)
        {
            ollamaTools.AddRange(RagTools.Definitions());
            system += "\n" + RagTools.CitationRule + "\n" +
                      "Os arquivos desta conversa NÃO estão no prompt. Para saber o que foi indexado, chame rag_list_files. Para achar um trecho, chame rag_search. Para ler o bloco inteiro, chame rag_read_chunk. Não cole o arquivo na resposta.\n";
        }

        // Contexto adaptativo: decidido aqui, com o tamanho REAL do prompt e das ferramentas injetadas. Começa em 4096 (100% na GPU)
        // e só sobe quando a conversa precisa; o valor das Configurações é o teto.
        LoadedModel? loadedModel = null;
        try { loadedModel = await ollama.GetLoadedModelAsync(ct); } catch (HttpRequestException) { /* sem Ollama: o erro aparece na chamada do modelo */ }
        int? loadedCtx = loadedModel is not null && string.Equals(loadedModel.Name, req.Model, StringComparison.OrdinalIgnoreCase) ? loadedModel.ContextLength : null;
        var attachmentChars = System.Text.RegularExpressions.Regex.Matches(userText, @"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]").Sum(m => m.Length);
        var plan = ContextPlanner.Plan(
            req.NumCtx,
            ContextPlanner.EstimateTokens(system.Length + JsonSerializer.Serialize(ollamaTools).Length),
            ContextPlanner.EstimateTokens(history.Sum(h => h.Content.Length)),
            intent.AnyMcp,
            attachmentChars,
            loadedCtx);
        var numCtx = plan.NumCtx;
        // consciência de recursos: o modelo vê quanto do contexto já está ocupado e se autorregula
        system = ToolTelemetry.MemoryTelemetry(plan, intent.Notebook) + "\n\n" + system;
        // Qwen3 4B tem 36 camadas. Acima de 16 mil tokens, 24 ficam na GPU e 12 na RAM desde o carregamento.
        int? numGpu = numCtx > 16384 ? 24 : null;
        // O planejamento abre o raciocínio da resposta: o usuário vê o que o Nex decidiu (contexto e ferramentas) antes de qualquer token.
        if (investigationTarget is null)
        {
        var planning = ToolTelemetry.PlanningBlock(intent, plan, notesAsk is null ? null : SecurityIntent.Describe(notesAsk));
        thinking.Append(planning).Append('\n');
        await Send(new { type = "thinking", text = planning + "\n" });
        }

        var extra = new List<object>();
        // Tarefas de navegador (abrir, ler, clicar, ler de novo) precisam de mais passos que ler um arquivo.
        var MaxToolRounds = browserTools.Count > 0 ? 12 : 4;
        // Custo de contexto: cada leitura é cortada em ~metade do contexto (em caracteres, 1500..8000) e a rodada inteira
        // não passa de ~1 caractere por token de contexto; acabou o orçamento, o modelo responde com o que já leu.
        var resultCap = Math.Clamp(numCtx / 2, 1500, 8000);
        var turnBudget = browserTools.Count > 0 ? numCtx * 3 / 2 : numCtx;

        for (var round = 0; round <= MaxToolRounds; round++)
        {
            if (round == MaxToolRounds)
            {
                // Última rodada: sem ferramentas. Sem este aviso o modelo tenta chamar uma ferramenta e escreve a chamada como texto.
                extra.Add(new { role = "user", content = "[sistema] Você atingiu o limite de ferramentas desta resposta. Responda agora com o que já leu, sem chamar mais ferramentas, e diga o que ficou por fazer." });
            }
            List<ToolCall>? calls = null;
            var roundText = new StringBuilder();
            var replyCap = investigationTarget is null ? (int?)null : 1024;
            await foreach (var chunk in ollama.ChatAsync(req.Model, system, history, numCtx, investigationTarget is null ? req.Think : false, numGpu,
                               extra, investigationTarget is null && round < MaxToolRounds && ollamaTools.Count > 0 ? ollamaTools : null, replyCap, taskCt))
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
                if (ReconTools.IsReconTool(call.Name))
                {
                    await Send(new { type = "mcp", name = call.Name, state = "executando", brief = ToolTelemetry.Summarize(call.Arguments), detail = JsonSerializer.Serialize(call.Arguments) });
                    var (rcOk, rcText) = await ReconTools.HandleAsync(call, recon, secNotes, conv.Id, Math.Min(resultCap, Math.Max(turnBudget, 500)), ct);
                    turnBudget -= rcText.Length;
                    await Send(new { type = "mcp", name = call.Name, state = rcOk ? "concluida" : "falhou", detail = rcOk ? (rcText.Length > 800 ? rcText[..800] : rcText) : "ERRO: " + rcText });
                    extra.Add(new { role = "tool", tool_name = call.Name, content = rcOk ? rcText : "ERRO: " + rcText });
                    continue;
                }
                if (RagTools.IsRagTool(call.Name))
                {
                    await Send(new { type = "mcp", name = call.Name, state = "executando", brief = ToolTelemetry.Summarize(call.Arguments), detail = JsonSerializer.Serialize(call.Arguments) });
                    var (ragOk, ragText) = await RagTools.Handle(call, rag, conv.Id, ct);
                    turnBudget -= ragText.Length;
                    await Send(new { type = "mcp", name = call.Name, state = ragOk ? "concluida" : "falhou", detail = ragOk ? (ragText.Length > 800 ? ragText[..800] : ragText) : "ERRO: " + ragText });
                    extra.Add(new { role = "tool", tool_name = call.Name, content = ragOk ? ragText : "ERRO: " + ragText });
                    continue;
                }
                if (NotebookTools.IsNotebookTool(call.Name))
                {
                    // caderno da conversa: nativo, sem aprovação (só lê ou acrescenta notas na pasta desta conversa)
                    await Send(new { type = "mcp", name = call.Name, state = "executando", brief = ToolTelemetry.Summarize(call.Arguments), detail = JsonSerializer.Serialize(call.Arguments) });
                    var (nbOk, nbText) = NotebookTools.Handle(call, memory, conv.Id, Math.Min(resultCap, Math.Max(turnBudget, 500)));
                    turnBudget -= nbText.Length;
                    await Send(new { type = "mcp", name = call.Name, state = nbOk ? "concluida" : "falhou", detail = nbOk ? (nbText.Length > 800 ? nbText[..800] : nbText) : "ERRO: " + nbText });
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
                        await Send(new { type = "mcp", name = tool.QualifiedName, state = "recusada", brief = ToolTelemetry.Summarize(call.Arguments), detail = "Recusada pelo Alexssander (ou sem resposta a tempo)." });
                    }
                    else
                    {
                        var argsText = JsonSerializer.Serialize(call.Arguments);
                        await Send(new { type = "mcp", name = tool.QualifiedName, state = "executando", brief = ToolTelemetry.Summarize(call.Arguments), detail = argsText.Length > 500 ? argsText[..500] : argsText });
                        var r = await mcp.CallAsync(tool, call.Arguments, Math.Min(resultCap, turnBudget), ct);
                        turnBudget -= r.Text.Length;
                        result = r.Ok ? r.Text : "ERRO: " + r.Text;
                        // motor de fatos: o que a ferramenta comprovou vai para facts.md (sem custo de GPU)
                        var extractedFact = FactExtractor.Extract(tool.Name, call.Arguments, r.Text);
                        if (r.Ok && extractedFact is not null) memory.AddFact(conv.Id, extractedFact);
                        var shown = result.Length > 800 ? result[..800] : result;
                        await Send(new { type = "mcp", name = tool.QualifiedName, state = r.Ok ? "concluida" : "falhou", detail = shown });
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

    taskManager.FinishTask(activeTask.Id);

    if (ctx.RequestAborted.IsCancellationRequested) return;
    await Send(error is null ? new { type = "done", stats } : new { type = "error", message = error });
});

api.MapGet("/dev/workspace", (string id, ConversationStore store, WorkspaceManager ws) =>
{
    var dir = store.FolderFor(id);
    if (dir is null) return Results.NotFound();
    var session = ws.LoadSession(dir);
    if (!string.IsNullOrWhiteSpace(session.RootPath) && Directory.Exists(session.RootPath)) ws.Open(session.RootPath);
    return Results.Ok(session);
});
api.MapPost("/dev/workspace/open-folder", (DevOpenFolder body, ConversationStore store, WorkspaceManager ws) =>
{
    var dir = store.FolderFor(body.Id);
    if (dir is null) return Results.NotFound();
    try
    {
        var session = ws.OpenFolder(dir, body.Path);
        return Results.Ok(new { path = session.RootPath, nodes = ws.Tree(), digest = CodeScanner.Scan(session.RootPath!) });
    }
    catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
});
api.MapPut("/dev/workspace/session", (string id, DevSession body, ConversationStore store, WorkspaceManager ws) =>
{
    var dir = store.FolderFor(id);
    if (dir is null) return Results.NotFound();
    if (!string.IsNullOrWhiteSpace(body.RootPath))
    {
        try { ws.Open(body.RootPath); }
        catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
        body.RootPath = ws.Root;
    }
    ws.SaveSession(dir, body);
    return Results.Ok(body);
});
api.MapPut("/dev/file", (WorkspaceFile body, WorkspaceManager ws) =>
{
    try { return Results.Ok(new { path = body.Path, bytes = ws.Write(body.Path, body.Content ?? "") }); }
    catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
});
api.MapPost("/dev/workspace/open", (WorkspaceOpen body, WorkspaceManager ws) =>
{
    try { return Results.Ok(new { path = ws.Open(body.Path) }); }
    catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
});
// "Abrir Pasta": abre a janela nativa de seleção de pasta do Windows, define a escolhida como workspace e já devolve a árvore
api.MapPost("/dev/workspace/pick", async (WorkspaceManager ws, CancellationToken ct) =>
{
    try
    {
        var picked = await ws.PickFolderAsync(ct);
        if (picked is null) return Results.Ok(new { cancelled = true });
        var path = ws.Open(picked);
        return Results.Ok(new { cancelled = false, path, name = WorkspaceManager.FolderName(path), root = ws.Root, nodes = ws.Tree() });
    }
    catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
});
api.MapGet("/dev/workspace/tree", (WorkspaceManager ws) =>
{
    try { return Results.Ok(new { root = ws.Root, nodes = ws.Tree() }); }
    catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
});
api.MapGet("/dev/workspace/file", (string path, WorkspaceManager ws) =>
{
    try { return Results.Ok(new { path, content = ws.Read(path) }); }
    catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
});
api.MapPost("/dev/workspace/file", (WorkspaceFile body, WorkspaceManager ws) =>
{
    try { return Results.Ok(new { path = body.Path, bytes = ws.Write(body.Path, body.Content ?? "") }); }
    catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
});
api.MapPost("/dev/workspace/command", async (WorkspaceCommand body, WorkspaceManager ws, CancellationToken ct) =>
{
    try
    {
        var (exit, output) = await ws.RunAsync(body.Command, ct);
        return Results.Ok(new { command = body.Command, exitCode = exit, output });
    }
    catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
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

// Exposto para os testes de ponta a ponta (tests/SecurityE2E), que rodam o app em memória.
public partial class Program { }
