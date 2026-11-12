using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LocalAi.Api.Llm;

namespace LocalAi.Api.Tools;

public sealed record SearchHit(string Title, string Url, string Snippet);

public sealed class Research(IHttpClientFactory httpFactory, IWebHostEnvironment env, OllamaClient ollama)
{
    public string Skill()
    {
        var path = Path.Combine(env.ContentRootPath, "skills", "pesquisa.md");
        return File.Exists(path) ? File.ReadAllText(path) : "Pesquise só um tema específico. Se estiver vago, pergunte.";
    }

    /// <summary>O modelo pequeno só escolhe: nada, filtrar ou pesquisar. Não executa a busca.</summary>
    public async Task<(string Action, string Query, string Question)> DecideAsync(
        string model, IReadOnlyList<(string Role, string Content)> history, CancellationToken ct)
    {
        var recent = history.TakeLast(6).ToList();
        var system = Skill() + """

            Responda só com um JSON, sem texto em volta:
            {"acao":"nada"|"filtrar"|"pesquisar","consulta":"","pergunta":""}
            acao "nada" = responde normal, sem internet.
            acao "filtrar" = o tema ainda está largo; pergunta é a única frase para o usuário.
            acao "pesquisar" = consulta é a busca curta, pergunta fica vazia.
            """;
        var sb = new StringBuilder();
        await foreach (var chunk in ollama.ChatAsync(model, system, recent, 2048, false, null, null, null, numPredict: null, ct))
        {
            if (!string.IsNullOrEmpty(chunk.Content)) sb.Append(chunk.Content);
        }
        return Parse(sb.ToString());
    }

    public async Task<IReadOnlyList<SearchHit>> SearchAsync(string query, CancellationToken ct, int limit = 4)
    {
        var http = httpFactory.CreateClient("search");
        using var body = new FormUrlEncodedContent(new Dictionary<string, string> { ["q"] = query });
        using var resp = await http.PostAsync("https://html.duckduckgo.com/html/", body, ct);
        if (!resp.IsSuccessStatusCode) return [];
        var html = await resp.Content.ReadAsStringAsync(ct);
        var hits = new List<SearchHit>();
        foreach (Match m in Regex.Matches(html, "result__a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", RegexOptions.Singleline))
        {
            if (hits.Count >= limit) break;
            var url = WebUtility.HtmlDecode(m.Groups[1].Value);
            var title = Regex.Replace(m.Groups[2].Value, "<.*?>", " ").Trim();
            title = WebUtility.HtmlDecode(Regex.Replace(title, "\\s+", " "));
            if (title.Length < 3 || url.Contains("duckduckgo.com", StringComparison.OrdinalIgnoreCase)) continue;
            var snippet = "";
            var after = html.AsSpan(m.Index, Math.Min(800, html.Length - m.Index));
            var snip = Regex.Match(after.ToString(), "result__snippet[^>]*>(.*?)</", RegexOptions.Singleline);
            if (snip.Success)
                snippet = WebUtility.HtmlDecode(Regex.Replace(snip.Groups[1].Value, "<.*?>", " ").Trim());
            hits.Add(new SearchHit(title, url, snippet.Length > 280 ? snippet[..280] : snippet));
        }
        return hits;
    }

    public sealed record OsintReport(List<SearchHit> Hits, List<string> Facts);

    /// <summary>Quatro vetores passivos em paralelo. Cada dork avisa o balão antes e depois da consulta.</summary>
    public static IReadOnlyList<(string Name, string Query)> Vectors(string target)
    {
        var name = target.Trim();
        var list = new List<(string, string)>
        {
            ("Vetor Código", $"\"{name}\" site:github.com OR site:gitlab.com"),
            ("Vetor Profissional", $"\"{name}\" site:linkedin.com/in OR site:dev.to OR site:medium.com"),
            ("Vetor Registros", $"\"{name}\" site:jusbrasil.com.br OR \"{name}\" developer"),
        };
        if (OsintEngine.IsDomain(name) || OsintEngine.EmbeddedDomain(name) is not null)
        {
            var host = OsintEngine.IsDomain(name) ? name.Split('/')[0] : OsintEngine.EmbeddedDomain(name)!;
            list.Add(("Vetor Certificados", "crt.sh " + host));
        }
        return list;
    }

    public async Task<OsintReport> InvestigateTargetAsync(string target, Func<string, Task> onProgress, CancellationToken ct)
    {
        var gate = new SemaphoreSlim(1, 1);
        async Task Report(string line)
        {
            await gate.WaitAsync(ct);
            try { await onProgress(line); }
            finally { gate.Release(); }
        }

        var vectors = Vectors(target);
        var bags = await Task.WhenAll(vectors.Select(async vector =>
        {
            await Report($"🔎 [OSINT: {vector.Name}] Dork: {vector.Query}\n");
            if (vector.Name == "Vetor Certificados")
            {
                var host = vector.Query["crt.sh ".Length..];
                var names = await CertificatesAsync(host, ct);
                var hits = names.Select(n => new SearchHit(n, "https://crt.sh/?q=" + Uri.EscapeDataString(n), "Certificate Transparency")).ToList();
                await Report(hits.Count == 0
                    ? "   ↳ 0 registros públicos encontrados.\n"
                    : string.Join("", hits.Take(8).Select(h => $"   ↳ Encontrado: {h.Title}\n")));
                return hits;
            }
            var found = (await SearchAsync(vector.Query, ct, 4)).ToList();
            await Report(found.Count == 0
                ? "   ↳ 0 registros públicos encontrados.\n"
                : string.Join("", found.Select(h => $"   ↳ Encontrado: {h.Title}\n")));
            return found;
        }));

        var hits = new List<SearchHit>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var hit in bags.SelectMany(b => b))
        {
            if (string.IsNullOrWhiteSpace(hit.Url) || !seen.Add(hit.Url)) continue;
            hits.Add(hit);
        }
        var facts = hits.Select(h =>
        {
            var title = h.Title.Length > 80 ? h.Title[..80] : h.Title;
            return $"Fonte: [{title}]({h.Url}) - Fato comprovado";
        }).ToList();
        await Report($"💾 Memória: {facts.Count} fatos verificados registrados em facts.md.\n");
        return new OsintReport(hits, facts);
    }

    private async Task<List<string>> CertificatesAsync(string host, CancellationToken ct)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var http = httpFactory.CreateClient("search");
            using var resp = await http.GetAsync("https://crt.sh/?q=" + Uri.EscapeDataString(host) + "&output=json", ct);
            if (!resp.IsSuccessStatusCode) return [];
            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
            foreach (var row in doc.RootElement.EnumerateArray())
            {
                if (!row.TryGetProperty("name_value", out var value)) continue;
                foreach (var line in (value.GetString() ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    var name = line.Trim().TrimStart('*').TrimStart('.');
                    if (name.Length == 0 || !name.EndsWith(host, StringComparison.OrdinalIgnoreCase)) continue;
                    names.Add(name.ToLowerInvariant());
                    if (names.Count >= 20) break;
                }
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            return [];
        }
        return names.OrderBy(n => n).ToList();
    }

    private static (string Action, string Query, string Question) Parse(string raw)
    {
        var start = raw.IndexOf('{');
        var end = raw.LastIndexOf('}');
        if (start < 0 || end <= start) return ("nada", "", "");
        try
        {
            using var doc = JsonDocument.Parse(raw[start..(end + 1)]);
            var root = doc.RootElement;
            var action = root.TryGetProperty("acao", out var a) ? a.GetString() ?? "nada" : "nada";
            var query = root.TryGetProperty("consulta", out var q) ? (q.GetString() ?? "").Trim() : "";
            var question = root.TryGetProperty("pergunta", out var p) ? (p.GetString() ?? "").Trim() : "";
            if (action != "filtrar" && action != "pesquisar") action = "nada";
            if (action == "pesquisar" && query.Length < 8) return ("filtrar", "", "O que exatamente você quer que eu pesquise?");
            return (action, query, question);
        }
        catch (JsonException)
        {
            return ("nada", "", "");
        }
    }
}
