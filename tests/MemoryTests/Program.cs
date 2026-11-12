using System.Text.Json;
using LocalAi.Api;
using LocalAi.Api.Llm;
using LocalAi.Api.Memory;
using LocalAi.Api.Planning;
using LocalAi.Api.Storage;
using LocalAi.Api.Voice;

// Testes do micro-RAG da conversa. Sem framework: cada Check imprime OK/FALHA e o processo sai com 1 se algo falhar.
var failures = 0;
var total = 0;
void Check(string name, bool ok, string detail = "")
{
    total++;
    if (!ok) failures++;
    Console.WriteLine($"{(ok ? "OK   " : "FALHA")} {name}{(ok || detail.Length == 0 ? "" : "  -> " + detail)}");
}

var root = Path.Combine(Path.GetTempPath(), "nex-memtest-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var convDir = Path.Combine(root, "conversations");
var store = new ConversationStore(convDir);
var mem = new ConversationMemory(store);
JsonElement Args(string json) => JsonDocument.Parse(json).RootElement.Clone();
string Read(string id, string topic) => mem.Read(id, topic, 100_000).Text;

try
{
    // ---------- micropasta
    var c = store.Create();
    var folder = Path.Combine(convDir, c.Id);
    var expected = new[] { "conversation.json", "system_index.md", "intent.md", "facts.md", "agent_index.md", "scratchpad.md" };
    Check("Create cria a micropasta com os 6 arquivos", expected.All(f => File.Exists(Path.Combine(folder, f))),
        string.Join(",", Directory.GetFiles(folder).Select(Path.GetFileName)));
    Check("Create não deixa .tmp para trás", !Directory.GetFiles(folder, "*.tmp").Any());
    Check("Seed: índices nascem vazios e compactos", Read(c.Id, "system_index").Contains("nenhum") && Read(c.Id, "agent_index").Contains("vazio"));

    c.Messages.Add(new Message("user", "oi", null, DateTime.UtcNow, null));
    c.Title = "Teste";
    store.Save(c);
    Check("Save/Get: ida e volta", store.Get(c.Id) is { } back && back.Messages.Count == 1 && back.Title == "Teste");
    Check("Save atômico não deixa .tmp", !Directory.GetFiles(folder, "*.tmp").Any());
    Check("List mostra a conversa", store.List().Any(s => s.Id == c.Id && s.Title == "Teste"));

    // formato antigo solto é ignorado e uma nova instância reindexa as micropastas
    File.WriteAllText(Path.Combine(convDir, "0123456789abcdef0123456789abcdef.json"), "{\"id\":\"0123456789abcdef0123456789abcdef\",\"title\":\"antiga\",\"updatedAt\":\"2026-01-01T00:00:00Z\",\"messages\":[]}");
    var store2 = new ConversationStore(convDir);
    Check("Reinício: reindexa as micropastas", store2.List().Any(s => s.Id == c.Id));
    Check("Reinício: .json solto do formato antigo é ignorado", !store2.List().Any(s => s.Title == "antiga") && store2.Get("0123456789abcdef0123456789abcdef") is null);
    Check("Reinício: o .json antigo foi ARQUIVADO em _legado (nada apagado)", File.Exists(Path.Combine(convDir, "_legado", "0123456789abcdef0123456789abcdef.json")) && !File.Exists(Path.Combine(convDir, "0123456789abcdef0123456789abcdef.json")));
    Check("a pasta _legado não vira conversa", store2.List().All(s => s.Id.Length == 32 && s.Id != "_legado"));

    // ---------- segurança de caminho
    var sentinel = Path.Combine(root, "nao-apague");
    Directory.CreateDirectory(sentinel);
    foreach (var bad in new[] { "..", "../nao-apague", "..\\nao-apague", "", "ZZZZ", new string('g', 32), c.Id + "/..", "../" + c.Id })
    {
        Check($"Delete('{bad}') recusado e nada some", !store.Delete(bad) && Directory.Exists(sentinel) && Directory.Exists(folder));
        Check($"FolderFor('{bad}') = null", store.FolderFor(bad) is null);
    }
    Check("Get com id inválido = null", store.Get("../x") is null);

    // ---------- intent
    var attach = "Analise isso\n[[ARQUIVO relatorio.pdf]]\nTEXTO ENORME DO ANEXO\n[[/ARQUIVO]]\n";
    mem.SetIntent(c.Id, attach + new string('x', 500));
    var intent = Read(c.Id, "intent");
    Check("SetIntent tira o texto do anexo", !intent.Contains("TEXTO ENORME") && intent.Contains("Analise isso"));
    Check("SetIntent limita a 300 caracteres (+…)", intent.Split('\n')[1].Length <= 301, intent.Split('\n')[1].Length.ToString());
    Check("system_index mostra o intent", Read(c.Id, "system_index").Contains("Analise isso"));
    mem.SetIntent(c.Id, "[[ARQUIVO a.txt]]x[[/ARQUIVO]]");
    Check("SetIntent só com anexo vira 'Arquivo anexado'", Read(c.Id, "intent").Contains("Arquivo anexado"));

    // ---------- fatos
    mem.AddFact(c.Id, "Aba aberta: https://alexssanderlx.com.br/");
    mem.AddFact(c.Id, "Aba aberta: https://alexssanderlx.com.br/");
    Check("AddFact não duplica", Read(c.Id, "facts").Split('\n').Count(l => l.StartsWith("- ")) == 1);
    for (var i = 0; i < 80; i++) mem.AddFact(c.Id, $"Fato número {i}");
    var facts = Read(c.Id, "facts").Split('\n').Where(l => l.StartsWith("- ")).ToList();
    Check("facts.md guarda só os 60 últimos", facts.Count == 60 && facts[^1] == "- Fato número 79" && !facts.Contains("- Fato número 10"), facts.Count.ToString());
    var si = Read(c.Id, "system_index");
    Check("system_index: contagem e 3 últimos fatos", si.Contains("facts (60)") && si.Contains("Fato número 79") && si.Contains("Fato número 77") && !si.Contains("Fato número 70"), si);

    // ---------- caderno do agente
    Check("topic_write só aceita scratchpad: facts", mem.AppendNote(c.Id, "facts", "hack", out _) is not null);
    Check("topic_write só aceita scratchpad: intent", mem.AppendNote(c.Id, "intent", "hack", out _) is not null);
    Check("topic_write só aceita scratchpad: system_index", mem.AppendNote(c.Id, "system_index", "hack", out _) is not null);
    Check("topic_write só aceita scratchpad: agent_index", mem.AppendNote(c.Id, "agent_index", "hack", out _) is not null);
    Check("topic_write recusa tópico inventado e caminho", mem.AppendNote(c.Id, "../../x", "a", out _) is not null && mem.AppendNote(c.Id, "conversation", "a", out _) is not null);
    Check("recusas não alteraram facts.md", !Read(c.Id, "facts").Contains("hack"));
    Check("nota vazia é recusada", mem.AppendNote(c.Id, "scratchpad", "   ", out _) is not null);
    var err = mem.AppendNote(c.Id, "scratchpad", "Hipótese 1: testar o bypass via cabeçalho X-Forwarded-For", out var n1);
    Check("AppendNote grava no scratchpad", err is null && n1 == 1 && Read(c.Id, "scratchpad").Contains("X-Forwarded-For"));
    mem.AppendNote(c.Id, "Scratchpad.md", "Hipótese 2: linha 1\nlinha 2", out var n2);
    Check("nome com .md e maiúscula é aceito; várias linhas viram uma nota", n2 == 2 && Read(c.Id, "scratchpad").Contains("linha 1 ⏎ linha 2"));
    var ai = Read(c.Id, "agent_index");
    Check("agent_index: contagem e última nota", ai.Contains("2 nota(s)") && ai.Contains("Hipótese 2"), ai);
    Check("aliases de leitura (notas, caderno, fatos)", Read(c.Id, "notas").Contains("Hipótese 1") && Read(c.Id, "caderno").Contains("Hipótese 2") && Read(c.Id, "fatos").Contains("Fato número 79"));
    Check("Read de tópico inexistente dá erro claro", mem.Read(c.Id, "senhas", 100) is (false, var t) && t.Contains("não existe"));
    Check("Read de conversa inexistente dá erro", mem.Read("0000000000000000000000000000dead", "facts", 100).Ok == false);
    var tail = mem.Read(c.Id, "facts", 120).Text;
    Check("Read longo devolve o FIM com aviso", tail.StartsWith("[início cortado]") && tail.Contains("Fato número 79"));

    // limite do scratchpad: descarta as mais antigas, mantém o cabeçalho
    for (var i = 0; i < 40; i++) mem.AppendNote(c.Id, "scratchpad", $"nota grande {i} " + new string('z', 1500), out _);
    var pad = File.ReadAllText(Path.Combine(folder, "scratchpad.md"));
    Check("scratchpad respeita o teto (20 mil) e mantém cabeçalho e as notas mais novas", pad.Length <= 20_500 && pad.StartsWith("# Caderno") && pad.Contains("nota grande 39") && !pad.Contains("Hipótese 1"), pad.Length.ToString());

    // orçamento dos índices no prompt
    var (sysIdx, agIdx) = mem.Indexes(c.Id);
    Check("índices cabem no orçamento (~120 tokens = até ~650 caracteres)", (sysIdx + agIdx).Length <= 650, (sysIdx + agIdx).Length.ToString());
    Check("Indexes de id inválido é vazio", mem.Indexes("../x") == ("", ""));

    // ---------- concorrência
    var c2 = store.Create();
    Parallel.For(0, 60, i =>
    {
        if (i % 2 == 0) mem.AddFact(c2.Id, $"fato paralelo {i}");
        else mem.AppendNote(c2.Id, "scratchpad", $"nota paralela {i}", out _);
    });
    Check("gravações paralelas não corrompem (30 fatos, 30 notas)",
        Read(c2.Id, "facts").Split('\n').Count(l => l.StartsWith("- ")) == 30 && Read(c2.Id, "scratchpad").Split('\n').Count(l => l.StartsWith("- [")) == 30);

    // ---------- renomear
    var rn = store.Create();
    var before = store.List().First(s => s.Id == rn.Id).UpdatedAt;
    Thread.Sleep(30);
    Check("Rename devolve o título limpo (espaços colapsados)", store.Rename(rn.Id, "  Auditoria   do  endpoint X \n") == "Auditoria do endpoint X");
    var renamed = store.Get(rn.Id)!;
    Check("Rename grava o título e marca TitleEdited", renamed.Title == "Auditoria do endpoint X" && renamed.TitleEdited);
    Check("Rename não mexe na data (não sobe na lista)", renamed.UpdatedAt == before && store.List().First(s => s.Id == rn.Id).UpdatedAt == before);
    Check("Rename aparece na lista", store.List().Any(s => s.Id == rn.Id && s.Title == "Auditoria do endpoint X"));
    Check("Rename corta em 80 caracteres", store.Rename(rn.Id, new string('a', 200))!.Length == ConversationStore.MaxTitleChars);
    Check("Rename vazio ou só espaços = recusado", store.Rename(rn.Id, "   ") is null && store.Rename(rn.Id, null) is null && store.Get(rn.Id)!.Title.StartsWith("aaa"));
    Check("Rename de id inexistente ou malicioso = null", store.Rename("0000000000000000000000000000dead", "x") is null && store.Rename("../x", "x") is null && store.Rename("..", "x") is null);
    Check("Rename mantém histórico, fatos e caderno", File.Exists(Path.Combine(convDir, rn.Id, "scratchpad.md")) && File.Exists(Path.Combine(convDir, rn.Id, "facts.md")) && store.Get(rn.Id)!.Messages.Count == 0);
    var store3 = new ConversationStore(convDir);
    Check("Rename sobrevive a reiniciar o Nex", store3.List().Any(s => s.Id == rn.Id && s.Title.StartsWith("aaa")));

    // ---------- ativos de voz (Piper e modelo): caminho configurado, senão a pasta comum
    var voiceRoot = Path.Combine(root, "voice-comum");
    var cfgDir = Path.Combine(root, "backend");
    Directory.CreateDirectory(Path.Combine(voiceRoot, "piper"));
    Directory.CreateDirectory(Path.Combine(voiceRoot, "models"));
    File.WriteAllText(Path.Combine(voiceRoot, "piper", "piper.exe"), "x");
    File.WriteAllText(Path.Combine(voiceRoot, "models", "pt_BR-faber-medium.onnx"), "x");
    var (vExe, vModel) = VoiceAssets.Resolve(cfgDir, "voice/bin/piper/piper.exe", "voice/models/pt_BR-faber-medium.onnx", voiceRoot);
    Check("voz: sem o caminho configurado, usa a pasta comum (exe)", vExe == Path.Combine(voiceRoot, "piper", "piper.exe"), vExe);
    Check("voz: sem o caminho configurado, usa a pasta comum (modelo)", vModel == Path.Combine(voiceRoot, "models", "pt_BR-faber-medium.onnx"), vModel);
    var local = Path.Combine(cfgDir, "voice", "bin", "piper");
    Directory.CreateDirectory(local);
    Directory.CreateDirectory(Path.Combine(cfgDir, "voice", "models"));
    File.WriteAllText(Path.Combine(local, "piper.exe"), "x");
    File.WriteAllText(Path.Combine(cfgDir, "voice", "models", "pt_BR-faber-medium.onnx"), "x");
    var (lExe, lModel) = VoiceAssets.Resolve(cfgDir, "voice/bin/piper/piper.exe", "voice/models/pt_BR-faber-medium.onnx", voiceRoot);
    Check("voz: o caminho configurado que existe tem prioridade", lExe == Path.GetFullPath(Path.Combine(local, "piper.exe")) && lModel.StartsWith(cfgDir), lExe + " | " + lModel);
    var (nExe, nModel) = VoiceAssets.Resolve(cfgDir, "voice/bin/piper/piper.exe", "voice/models/pt_BR-faber-medium.onnx", Path.Combine(root, "nao-existe"));
    Check("voz: configurado existe e a pasta comum não: nada muda", File.Exists(nExe) && File.Exists(nModel));
    File.Delete(Path.Combine(local, "piper.exe"));
    File.Delete(Path.Combine(cfgDir, "voice", "models", "pt_BR-faber-medium.onnx"));
    var (mExe, mModel) = VoiceAssets.Resolve(cfgDir, "voice/bin/piper/piper.exe", "voice/models/pt_BR-faber-medium.onnx", Path.Combine(root, "nao-existe"));
    Check("voz: nada em lugar nenhum: devolve os caminhos configurados (Piper fica indisponível, sem exceção)", !File.Exists(mExe) && !File.Exists(mModel) && mExe.EndsWith("piper.exe"));
    var (eExe, eModel) = VoiceAssets.Resolve(cfgDir, "", null, voiceRoot);
    Check("voz: configuração vazia usa a pasta comum para o exe e deixa o modelo vazio", eExe == Path.Combine(voiceRoot, "piper", "piper.exe") && eModel == "");
    var (aExe, aModel) = VoiceAssets.Resolve(cfgDir, Path.Combine(voiceRoot, "piper", "piper.exe"), Path.Combine(voiceRoot, "models", "pt_BR-faber-medium.onnx"), Path.Combine(root, "x"));
    Check("voz: caminho absoluto configurado é respeitado", aExe == Path.Combine(voiceRoot, "piper", "piper.exe") && File.Exists(aModel));
    Check("voz: dica de instalação cita o script", VoiceAssets.SetupHint.Contains("setup-voice-assets.ps1"));
    var antes = Environment.GetEnvironmentVariable("NEX_VOICE_HOME");
    Environment.SetEnvironmentVariable("NEX_VOICE_HOME", Path.Combine(root, "outro-lugar"));
    Check("voz: NEX_VOICE_HOME troca a pasta comum", VoiceAssets.LocalRoot == Path.Combine(root, "outro-lugar"), VoiceAssets.LocalRoot);
    Environment.SetEnvironmentVariable("NEX_VOICE_HOME", antes);
    Check("voz: sem NEX_VOICE_HOME volta para %LOCALAPPDATA%\nex\voice", VoiceAssets.LocalRoot.EndsWith(Path.Combine("nex", "voice")), VoiceAssets.LocalRoot);

    // ---------- roteador de intenção: tudo desligado por padrão, a frase liga só o que precisa
    ToolIntent R(string text, bool f = false, bool b = false, bool d = false, bool notes = false) => IntentRouter.Route(text, f, b, d, notes);
    foreach (var direta in new[] { "Bom dia Nex", "Explique o que é um race condition", "Qual a diferença entre TCP e UDP?", "Escreva um código em C# que soma dois números", "Como está o abacaxi?", "Me dá um resumo do OWASP Top 10" })
        Check($"intenção direta, nenhuma ferramenta: '{direta}'", !R(direta).Any, R(direta).Describe());
    Check("intenção: URL liga só o navegador", R("Abre https://alexssanderlx.com.br e me diz o título") is { Browser: true, Files: false, Desktop: false });
    Check("intenção: 'abas' e 'página' ligam o navegador (com e sem acento)", R("liste as abas do grupo").Browser && R("leia a página aberta").Browser && R("leia a pagina aberta").Browser);
    Check("intenção: 'aba' não casa dentro de 'abacaxi'", !R("quanto custa o abacaxi").Browser);
    Check("intenção: GitHub, Gmail e LinkedIn ligam o navegador", R("vê o que tem no GitHub").Browser && R("resume meu gmail").Browser && R("abre o LinkedIn").Browser);
    Check("intenção: arquivo, pasta e caminho do Windows ligam só Arquivos", R("leia o arquivo notas.md") is { Files: true, Browser: false } && R("liste a pasta C:/dados").Files && R("abra C:\\temp\\x.txt").Files);
    Check("intenção: extensão conhecida liga Arquivos", R("revise o Program.cs").Files && R("olha o config.json").Files);
    Check("intenção: janela, calculadora e bloco de notas ligam o Computador", R("abre a calculadora").Desktop && R("lista as janelas abertas").Desktop && R("escreve no bloco de notas").Desktop);
    Check("intenção: anotar e hipótese ligam o Caderno", R("anote no scratchpad que a hipótese 1 é X").Notebook && R("o que anotamos até agora?").Notebook && R("como é sua memória?").Notebook);
    Check("intenção: caderno com notas já existentes fica disponível", R("bom dia", notes: true).Notebook && !R("bom dia").Notebook);
    Check("intenção: interruptor do usuário liga mesmo sem a frase", R("oi", f: true).Files && R("oi", b: true).Browser && R("oi", d: true).Desktop);
    Check("intenção: texto de anexo não conta (PDF que cita 'site')", !R("[[ARQUIVO a.pdf]]\nvisite o site https://x.com na pasta\n[[/ARQUIVO]]\nresuma em duas frases").AnyMcp);
    Check("intenção: Describe lista os nomes", R("abre https://x.com e anota").Describe() == "Navegador, Caderno" && R("oi").Describe() == "nenhuma");
    Check("intenção: Normalize tira acento e caixa", IntentRouter.Normalize("PÁGINA Já Aberta") == "pagina ja aberta");

    // ---------- contexto adaptativo
    var p0 = ContextPlanner.Plan(32768, 1800, 20, usesMcp: false, attachmentChars: 0, loadedCtx: null);
    Check("contexto: 'Bom dia Nex' fica em 4096 e 100% GPU", p0.NumCtx == 4096 && p0.Complexity == "direta" && p0.GpuNote == "100% na GPU" && p0.Warning is null, $"{p0.NumCtx} {p0.Complexity}");
    var p1 = ContextPlanner.Plan(32768, 3000, 100, usesMcp: true, attachmentChars: 0, loadedCtx: null);
    Check("contexto: ferramenta MCP sobe para 8192 (ainda 100% GPU)", p1.NumCtx == 8192 && p1.Complexity == "ferramenta" && p1.Warning is null, $"{p1.NumCtx}");
    var p2 = ContextPlanner.Plan(32768, 1800, 9000, usesMcp: false, attachmentChars: 30000, loadedCtx: null);
    Check("contexto: anexo grande sobe para 16384 e avisa do desempenho", p2.NumCtx == 16384 && p2.Complexity == "extensa" && p2.Warning is not null && p2.Warning.Contains("RAM"), $"{p2.NumCtx} {p2.Warning}");
    var p3 = ContextPlanner.Plan(32768, 1800, 25000, usesMcp: false, attachmentChars: 75000, loadedCtx: null);
    Check("contexto: conversa gigante chega a 32768 com aviso de CPU", p3.NumCtx == 32768 && p3.Warning!.Contains("14") && p3.GpuNote.Contains("CPU"), $"{p3.NumCtx}");
    var p4 = ContextPlanner.Plan(8192, 1800, 40000, usesMcp: false, attachmentChars: 0, loadedCtx: null);
    Check("contexto: o teto das Configurações manda e o corte é avisado", p4.NumCtx == 8192 && p4.Warning!.Contains("cortado"), $"{p4.NumCtx} {p4.Warning}");
    Check("contexto: teto menor que 4096 é respeitado", ContextPlanner.Plan(2048, 1800, 20, false, 0, null).NumCtx == 2048);
    Check("contexto: modelo já carregado em 8192 não recarrega para 4096", ContextPlanner.Plan(32768, 1800, 20, false, 0, 8192).NumCtx == 8192);
    Check("contexto: histerese não passa de 8192 (16k fica caro na GPU)", ContextPlanner.Plan(32768, 1800, 20, false, 0, 16384).NumCtx == 4096);
    Check("contexto: carregado menor que o necessário não segura", ContextPlanner.Plan(32768, 3000, 100, true, 0, 4096).NumCtx == 8192);
    Check("contexto: GpuNote por faixa", ContextPlanner.GpuNote(4096) == "100% na GPU" && ContextPlanner.GpuNote(8192) == "100% na GPU" && ContextPlanner.GpuNote(16384).Contains("12 na RAM") && ContextPlanner.GpuNote(32768).Contains("CPU"));
    Check("contexto: estimativa de tokens (3 caracteres por token)", ContextPlanner.EstimateTokens(300) == 100 && ContextPlanner.EstimateTokens(301) == 101);

    // ---------- telemetria e bloco de planejamento
    Check("telemetria: resume argumentos", ToolTelemetry.Summarize(Args("{\"url\":\"https://a.com/x\",\"tab_id\":5}")) == "url=https://a.com/x tab_id=5");
    Check("telemetria: corta texto longo e tira quebra de linha", ToolTelemetry.Summarize(Args("{\"text\":\"" + new string('a', 200) + "\\nlinha\"}")).Length <= 141);
    Check("telemetria: objeto aninhado vira reticências e não-objeto vira vazio", ToolTelemetry.Summarize(Args("{\"edits\":[1,2]}")) == "edits=…" && ToolTelemetry.Summarize(Args("[]")) == "");
    var blockDirect = ToolTelemetry.PlanningBlock(R("Bom dia"), p0);
    Check("planejamento: conversa direta mostra contexto 4096 e nenhuma ferramenta", blockDirect.Contains("[Planejamento de Execução]") && blockDirect.Contains("Contexto: 4096 (100% na GPU)") && blockDirect.Contains("Ferramentas: nenhuma"), blockDirect);
    var blockTools = ToolTelemetry.PlanningBlock(R("abre https://x.com"), p1);
    Check("planejamento: com navegador mostra Ferramentas: [Navegador] e contexto 8192", blockTools.Contains("Ferramentas: [Navegador]") && blockTools.Contains("Contexto: 8192"), blockTools);
    Check("planejamento: o aviso de desempenho aparece no bloco", ToolTelemetry.PlanningBlock(R("oi"), p2).Contains("⚠"));

    // ---------- Delete leva a micropasta inteira
    Check("Delete remove a micropasta inteira", store.Delete(c2.Id) && !Directory.Exists(Path.Combine(convDir, c2.Id)) && store.Get(c2.Id) is null);
    Check("Delete de conversa inexistente = false", !store.Delete(c2.Id));
    Check("Delete não tocou na pasta vizinha", Directory.Exists(sentinel) && Directory.Exists(folder));

    // ---------- motor de fatos
    Check("fato: browser_navigate", FactExtractor.Extract("browser_navigate", Args("{\"url\":\"https://github.com/\"}"), "ok") == "Aba aberta: https://github.com/");
    Check("fato: browser_reuse_tab", FactExtractor.Extract("browser_reuse_tab", Args("{\"tab_id\":5,\"url\":\"https://a.com/\"}"), "ok") == "Aba aberta: https://a.com/");
    Check("fato: browser_get_dom lê o cabeçalho 'Aba [id] url'", FactExtractor.Extract("browser_get_dom", Args("{}"), "Aba [2007] https://mail.google.com/\nTexto visível:\nx") == "Página lida: https://mail.google.com/");
    Check("fato: get_dom sem cabeçalho = nada", FactExtractor.Extract("browser_get_dom", Args("{}"), "Nenhum texto") is null);
    Check("fato: read_text_file", FactExtractor.Extract("read_text_file", Args("{\"path\":\"C:/a/b.txt\"}"), "conteudo") == "Arquivo lido: C:/a/b.txt");
    Check("fato: write_file e edit_file", FactExtractor.Extract("write_file", Args("{\"path\":\"C:/x.md\",\"content\":\"a\"}"), "ok") == "Arquivo gravado: C:/x.md"
        && FactExtractor.Extract("edit_file", Args("{\"path\":\"C:/x.md\"}"), "ok") == "Arquivo editado: C:/x.md");
    Check("fato: ferramentas sem fato (click, type, tabs, list_directory, topic_*)", new[] { "browser_click", "browser_type", "browser_tabs", "list_directory", "topic_write" }
        .All(t => FactExtractor.Extract(t, Args("{\"path\":\"x\",\"url\":\"y\"}"), "Aba [1] z") is null));

    // ---------- ferramentas nativas
    var defs = NotebookTools.Definitions();
    var defJson = JsonSerializer.Serialize(defs);
    Check("há exatamente 2 ferramentas nativas: topic_read e topic_write", defs.Count == 2 && defJson.Contains("\"topic_read\"") && defJson.Contains("\"topic_write\""));
    Check("as 2 descrições têm o formato explícito", new[] { NotebookTools.ReadDescription, NotebookTools.WriteDescription }
        .All(d => new[] { "O QUE FAZ:", "QUANDO USAR:", "COMO USAR:", "NÃO FAÇA:", "RETORNA:" }.All(d.Contains) && d.Length <= 1100));
    Check("IsNotebookTool", NotebookTools.IsNotebookTool("topic_read") && NotebookTools.IsNotebookTool("topic_write") && !NotebookTools.IsNotebookTool("browser_tabs"));

    var c3 = store.Create();
    var w = NotebookTools.Handle(new ToolCall("topic_write", Args("{\"name\":\"scratchpad\",\"content\":\"hipótese 1: testar X-Forwarded-For\"}")), mem, c3.Id, 4000);
    Check("topic_write (nativo) grava e confirma", w.Ok && w.Text.Contains("Total de notas: 1"), w.Text);
    var r = NotebookTools.Handle(new ToolCall("topic_read", Args("{\"name\":\"scratchpad\"}")), mem, c3.Id, 4000);
    Check("topic_read (nativo) devolve o que foi anotado", r.Ok && r.Text.Contains("X-Forwarded-For"), r.Text);
    var empty = NotebookTools.Handle(new ToolCall("topic_read", Args("{\"name\":\"facts\"}")), mem, c3.Id, 4000);
    Check("topic_read de tópico sem fatos devolve só o cabeçalho (sem inventar)", empty.Ok && !empty.Text.Contains("http"));
    var bad1 = NotebookTools.Handle(new ToolCall("topic_write", Args("{\"name\":\"facts\",\"content\":\"x\"}")), mem, c3.Id, 4000);
    Check("topic_write em facts dá erro explicando", !bad1.Ok && bad1.Text.Contains("só pode ler"), bad1.Text);
    var bad2 = NotebookTools.Handle(new ToolCall("topic_write", Args("{\"name\":\"scratchpad\"}")), mem, c3.Id, 4000);
    Check("topic_write sem content dá erro", !bad2.Ok);
    var upper = NotebookTools.Handle(new ToolCall("topic_write", Args("{\"NAME\":\"scratchpad\",\"Content\":123}")), mem, c3.Id, 4000);
    Check("argumentos com maiúsculas e valor não-texto são tolerados", upper.Ok, upper.Text);
    var none = NotebookTools.Handle(new ToolCall("topic_read", Args("[]")), mem, c3.Id, 4000);
    Check("argumentos que não são objeto dão erro, sem exceção", !none.Ok);
    var other = NotebookTools.Handle(new ToolCall("topic_delete", Args("{}")), mem, c3.Id, 4000);
    Check("ferramenta desconhecida dá erro", !other.Ok);
}
catch (Exception ex)
{
    failures++;
    total++;
    Console.WriteLine("FALHA exceção inesperada: " + ex);
}
finally
{
    try { Directory.Delete(root, recursive: true); } catch { /* temporário */ }
}

Console.WriteLine($"\n{total - failures}/{total} verificações ok");
return failures == 0 ? 0 : 1;
