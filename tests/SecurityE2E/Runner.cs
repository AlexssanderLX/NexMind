using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using LocalAi.Api.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Hosting;

// Ponta a ponta do Nex Security com o Ollama real e o app EM MEMÓRIA (sem porta TCP).
//  HARD  = estrutura e regras (eventos, arquivos, leitura sob demanda): precisam passar.
//  OBS   = qualidade do modelo de 4B (palavras-chave na resposta): reportadas, sem derrubar o teste.
// O prompt do modo Security vem de NEX_SECURITY_SYSTEM_FILE (o mesmo texto que a tela envia).
internal static class Runner
{
    static int hardFail;
    static int hardTotal;
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    static void Hard(string name, bool ok, string detail = "")
    {
        hardTotal++;
        if (!ok) hardFail++;
        Console.WriteLine($"{(ok ? "OK   " : "FALHA")} {name}{(ok || detail.Length == 0 ? "" : "  -> " + detail)}");
    }

    static void Obs(string name, bool ok, string detail = "") =>
        Console.WriteLine($"{(ok ? "OBS+ " : "OBS- ")} {name}{(detail.Length == 0 ? "" : "  -> " + detail)}");

    record Turn(string Text, string Thinking, List<JsonElement> Events, bool Done, string? Error, double Seconds)
    {
        public bool Has(string kind, Func<JsonElement, bool>? pred = null) =>
            Events.Any(e => e.TryGetProperty("type", out var t) && t.GetString() == kind && (pred is null || pred(e)));
    }

    static async Task<Turn> Stream(HttpClient http, string url, object body)
    {
        var t0 = DateTime.UtcNow;
        using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        if (!res.IsSuccessStatusCode) return new Turn("", "", [], false, $"HTTP {(int)res.StatusCode}: {await res.Content.ReadAsStringAsync()}", 0);
        var text = new StringBuilder();
        var thinking = new StringBuilder();
        var events = new List<JsonElement>();
        string? error = null;
        var done = false;
        using var reader = new StreamReader(await res.Content.ReadAsStreamAsync());
        while (await reader.ReadLineAsync() is { } line)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var ev = JsonDocument.Parse(line).RootElement.Clone();
            events.Add(ev);
            switch (ev.GetProperty("type").GetString())
            {
                case "token": text.Append(ev.GetProperty("text").GetString()); break;
                case "thinking": thinking.Append(ev.GetProperty("text").GetString()); break;
                case "done": done = true; break;
                case "error": error = ev.GetProperty("message").GetString(); break;
            }
        }
        return new Turn(text.ToString(), thinking.ToString(), events, done, error, (DateTime.UtcNow - t0).TotalSeconds);
    }

    static string Short(string s, int n = 220) => s.Length <= n ? s.Replace("\n", " ") : s[..n].Replace("\n", " ") + "…";

    public static async Task<int> Main()
    {
        var systemFile = Environment.GetEnvironmentVariable("NEX_SECURITY_SYSTEM_FILE");
        var securitySystem = systemFile is not null && File.Exists(systemFile) ? File.ReadAllText(systemFile) : "";
        Hard("o prompt do modo Security foi carregado (mesmo texto da tela)", securitySystem.Contains("Nex Security") && securitySystem.Contains("/workbench.html"));

        // o repositório não tem .sln: aponta o WebApplicationFactory para a pasta do backend (appsettings.json, mcp_servers.json, data/)
        var backendDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "backend"));
        Hard("a raiz do backend foi encontrada", File.Exists(Path.Combine(backendDir, "appsettings.json")), backendDir);
        Environment.SetEnvironmentVariable("ASPNETCORE_TEST_CONTENTROOT_LOCALAI_API", backendDir);

        await using var factory = new WebApplicationFactory<Program>();
        var http = factory.CreateClient();
        http.Timeout = TimeSpan.FromMinutes(5);
        var root = factory.Services.GetRequiredService<IWebHostEnvironment>().ContentRootPath;
        var notes = factory.Services.GetRequiredService<SecurityNotes>();
        const string model = "qwen3:4b-instruct";

        var conv = await (await http.PostAsync("/api/conversations", null)).Content.ReadFromJsonAsync<JsonElement>();
        var id = conv.GetProperty("id").GetString()!;
        var secDir = Path.Combine(root, "data", "conversations", id, "security");
        Console.WriteLine($"conversa de teste {id[..8]} (app em memória, sem porta; dados em {Path.Combine(root, "data")})\n");

        object Chat(string content) => new { content, model, numCtx = 32768, think = (bool?)null, system = securitySystem, search = false, tools = false, browser = false, desktop = false };
        object Sub(string content) => new { content, model, numCtx = 32768 };

        // ---------- 1. o Nex principal no modo Security explica o app
        var t1 = await Stream(http, $"/api/conversations/{id}/chat", Chat("Quero saber o que esse app faz"));
        Hard("1. chat principal responde sem erro (modo Security)", t1.Done && t1.Error is null && t1.Text.Length > 80, t1.Error ?? Short(t1.Text));
        Hard("1. o planejamento mostra contexto 4096 e nenhuma ferramenta", t1.Thinking.Contains("[Planejamento de Execução]") && t1.Thinking.Contains("Contexto: 4096") && t1.Thinking.Contains("Ferramentas: nenhuma"), Short(t1.Thinking));
        Hard("1. nenhuma leitura de anotações em conversa normal (regra de ouro)", !t1.Thinking.Contains("Leitura pontual"));
        var low = t1.Text.ToLowerInvariant();
        var keys = new[] { "workbench", "wstg", "estágio", "subagente", "recon", "escopo", "owasp", "hipótese" }.Where(low.Contains).ToList();
        Obs($"1. a resposta mostra domínio do app e da metodologia ({keys.Count}/8 termos: {string.Join(", ", keys)})", keys.Count >= 4);
        Console.WriteLine($"      [{t1.Seconds:0.0}s] {Short(t1.Text, 600)}\n");

        // ---------- 2. o Nex principal em conversa normal não lê as notas
        var t2 = await Stream(http, $"/api/conversations/{id}/chat", Chat("Bom dia Nex"));
        Hard("2. 'Bom dia Nex' responde rápido e sem planejamento de leitura", t2.Done && t2.Error is null && !t2.Thinking.Contains("Leitura pontual"), t2.Error ?? "");
        var l2 = t2.Text.ToLowerInvariant();
        Obs("2. sem ferramentas, o Nex não promete abrir site, ler arquivo nem clicar", !new[] { "vou abrir", "vou ler", "vou clicar", "vou acessar" }.Any(l2.Contains), Short(t2.Text, 200));
        Console.WriteLine($"      [{t2.Seconds:0.0}s] {Short(t2.Text)}\n");

        // ---------- 3. subagente Recon: micro-chat, anotação
        var s1 = await Stream(http, $"/api/conversations/{id}/security/recon/chat",
            Sub("Alvo autorizado. No bundle main.js vi as rotas /api/v2/users e /admin/export. Anote essas duas rotas nas suas notas e diga o próximo passo de mapeamento."));
        Hard("3. Recon responde (tokens + done, sem erro)", s1.Done && s1.Error is null && s1.Text.Length > 40, s1.Error ?? Short(s1.Text));
        Console.WriteLine($"      [{s1.Seconds:0.0}s] {Short(s1.Text, 500)}");
        var noted = s1.Has("mcp", e => e.GetProperty("name").GetString() == "note_write" && e.GetProperty("state").GetString() == "concluida");
        if (!noted)
        {
            var s1b = await Stream(http, $"/api/conversations/{id}/security/recon/chat", Sub("Use a ferramenta note_write agora para anotar: rotas /api/v2/users e /admin/export vistas no main.js."));
            noted = s1b.Has("mcp", e => e.GetProperty("name").GetString() == "note_write" && e.GetProperty("state").GetString() == "concluida");
            Console.WriteLine($"      (2ª tentativa pedindo a anotação) note_write chamado: {noted}");
        }
        Obs("3. o modelo chamou note_write sozinho e a nota foi gravada em recon.md", noted && File.Exists(Path.Combine(secDir, "recon.md")));
        if (!File.Exists(Path.Combine(secDir, "recon.md")))
        {
            notes.Append(id, "recon", "Rotas /api/v2/users e /admin/export vistas no bundle main.js", out _);
            Console.WriteLine("      (o modelo não anotou: gravei a nota pelo serviço para testar a leitura sob demanda a seguir)");
        }
        Hard("3. recon.md e INDEX.md existem em security/", File.Exists(Path.Combine(secDir, "recon.md")) && File.Exists(Path.Combine(secDir, "INDEX.md")));
        Console.WriteLine($"      recon.md:\n{Indent(File.ReadAllText(Path.Combine(secDir, "recon.md")))}\n");

        // ---------- 4. histórico exclusivo do especialista
        var hist = await http.GetFromJsonAsync<JsonElement>($"/api/conversations/{id}/security/recon");
        var msgs = hist.GetProperty("messages").GetArrayLength();
        Hard("4. o histórico do Recon fica salvo (pares usuário/assistente)", msgs >= 2 && msgs % 2 == 0, $"{msgs} mensagens");
        var authHist = await http.GetFromJsonAsync<JsonElement>($"/api/conversations/{id}/security/auth");
        Hard("4. o histórico do Auth está vazio (exclusivo de cada especialista)", authHist.GetProperty("messages").GetArrayLength() == 0);
        var notFound = await http.GetAsync($"/api/conversations/{id}/security/hacker");
        Hard("4. especialista inexistente dá 404", (int)notFound.StatusCode == 404);

        // ---------- 5. o Nex principal lê as notas SÓ quando perguntado
        var t5 = await Stream(http, $"/api/conversations/{id}/chat", Chat("O que o Recon achou?"));
        Hard("5. a pergunta aciona a leitura pontual das notas do Recon", t5.Done && t5.Error is null && t5.Thinking.Contains("Leitura pontual: notas do Recon Specialist"), Short(t5.Thinking));
        var l5 = t5.Text.ToLowerInvariant();
        Obs("5. a resposta traz o que o Recon anotou (/admin/export ou /api/v2/users)", l5.Contains("/admin/export") || l5.Contains("/api/v2/users"), Short(t5.Text, 300));
        Console.WriteLine($"      [{t5.Seconds:0.0}s] {Short(t5.Text, 400)}\n");

        var t5b = await Stream(http, $"/api/conversations/{id}/chat", Chat("Mostre as anotações do Auth"));
        Hard("5. sem anotações do Auth, a leitura pontual diz isso (sem inventar)", t5b.Done && t5b.Thinking.Contains("notas do Auth Specialist"));
        Obs("5. a resposta admite que o Auth ainda não anotou nada", t5b.Text.ToLowerInvariant().Contains("não há") || t5b.Text.ToLowerInvariant().Contains("nenhuma") || t5b.Text.ToLowerInvariant().Contains("ainda não"), Short(t5b.Text, 200));

        // ---------- 6. anexo no micro-chat do Auth
        var s6 = await Stream(http, $"/api/conversations/{id}/security/auth/chat",
            Sub("[[ARQUIVO req.txt]]\nGET /api/orders/1001 HTTP/1.1\nHost: alvo.example\nAuthorization: Bearer TOKEN_SECRETO_ABC\n[[/ARQUIVO]]\n\nAnalise este pedido (conta A) e proponha o teste mínimo."));
        Hard("6. Auth responde com anexo", s6.Done && s6.Error is null && s6.Text.Length > 40, s6.Error ?? Short(s6.Text));
        var l6 = s6.Text.ToLowerInvariant();
        Obs("6. a resposta fala de IDOR/BOLA/orders (especialidade do Auth)", l6.Contains("idor") || l6.Contains("bola") || l6.Contains("orders") || l6.Contains("conta b"), Short(s6.Text, 300));
        var authAfter = await http.GetFromJsonAsync<JsonElement>($"/api/conversations/{id}/security/auth");
        var stored = authAfter.GetProperty("messages")[0].GetProperty("content").GetString()!;
        Hard("6. o histórico guarda o nome do anexo, mas NÃO o conteúdo (token fica de fora)", stored.Contains("[[ARQUIVO req.txt]]") && !stored.Contains("TOKEN_SECRETO_ABC"), stored);
        Console.WriteLine($"      [{s6.Seconds:0.0}s] {Short(s6.Text, 400)}\n");

        // ---------- 7. foco da especialidade
        var s7 = await Stream(http, $"/api/conversations/{id}/security/recon/chat", Sub("Teste uma SQL injection no formulário de login com ' OR 1=1 --"));
        Hard("7. Recon responde à pergunta fora da especialidade sem erro", s7.Done && s7.Error is null);
        var l7 = s7.Text.ToLowerInvariant();
        Obs("7. o Recon se mantém no papel e indica o Input Specialist", l7.Contains("input"), Short(s7.Text, 300));
        Console.WriteLine($"      [{s7.Seconds:0.0}s] {Short(s7.Text, 400)}\n");

        // ---------- 8. sem travar: chat principal e micro-chat ao mesmo tempo
        var a = Stream(http, $"/api/conversations/{id}/chat", Chat("Responda só: ok"));
        var b = Stream(http, $"/api/conversations/{id}/security/verify/chat", Sub("Responda só: ok"));
        await Task.WhenAll(a, b);
        Hard("8. chat principal e micro-chat ao mesmo tempo terminam sem erro (o Ollama enfileira)", a.Result.Done && b.Result.Done && a.Result.Error is null && b.Result.Error is null,
            $"principal {a.Result.Seconds:0.0}s, micro-chat {b.Result.Seconds:0.0}s");

        // ---------- 9. arquivos finais e limpeza
        var files = Directory.Exists(secDir) ? Directory.GetFiles(secDir).Select(Path.GetFileName).OrderBy(x => x).ToList() : [];
        Console.WriteLine($"\n      security/: {string.Join(", ", files)}");
        var del = await http.DeleteAsync($"/api/conversations/{id}");
        Hard("9. apagar a conversa remove a pasta security/ junto", (int)del.StatusCode == 204 && !Directory.Exists(Path.GetDirectoryName(secDir)!));

        Console.WriteLine($"\n{hardTotal - hardFail}/{hardTotal} verificações obrigatórias ok");
        return hardFail == 0 ? 0 : 1;
    }

    static string Indent(string s) => string.Join("\n", s.Split('\n').Select(l => "        " + l));
}
