using System.Text.Json;
using LocalAi.Api;
using LocalAi.Api.Llm;
using LocalAi.Api.Memory;
using LocalAi.Api.Storage;

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
