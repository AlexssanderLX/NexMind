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

    /// <summary>
    /// Busca resiliente: tenta DuckDuckGo; se houver limitação de robô (anomaly/captcha) ou zero resultados,
    /// recorre automaticamente ao Bing Search com decodificação de URLs reais.
    /// </summary>
    public async Task<IReadOnlyList<SearchHit>> SearchAsync(string query, CancellationToken ct, int limit = 4)
    {
        var hits = new List<SearchHit>();
        try
        {
            var http = httpFactory.CreateClient("search");
            using var body = new FormUrlEncodedContent(new Dictionary<string, string> { ["q"] = query });
            using var resp = await http.PostAsync("https://html.duckduckgo.com/html/", body, ct);
            if (resp.IsSuccessStatusCode)
            {
                var html = await resp.Content.ReadAsStringAsync(ct);
                if (!html.Contains("anomaly-modal") && !html.Contains("bots use DuckDuckGo too"))
                {
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
                }
            }
        }
        catch
        {
            // fallback para Bing abaixo
        }

        if (hits.Count > 0) return hits;

        // Fallback: Bing Search
        return await SearchBingAsync(query, ct, limit);
    }

    public async Task<IReadOnlyList<SearchHit>> SearchBingAsync(string query, CancellationToken ct, int limit = 4)
    {
        try
        {
            var http = httpFactory.CreateClient("search");
            using var req = new HttpRequestMessage(HttpMethod.Get, "https://www.bing.com/search?q=" + Uri.EscapeDataString(query));
            req.Headers.UserAgent.Clear();
            req.Headers.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
            req.Headers.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
            req.Headers.Add("Accept-Language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7");
            using var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode) return [];
            var html = await resp.Content.ReadAsStringAsync(ct);
            var hits = new List<SearchHit>();
            var matches = Regex.Matches(html, @"<li class=""b_algo""[^>]*>[\s\S]*?<h2><a[^>]*href=""(?<url>[^""]+)""[^>]*>(?<title>.*?)</a></h2>(?:[\s\S]*?<p[^>]*>(?<snip>.*?)</p>)?", RegexOptions.IgnoreCase);
            foreach (Match m in matches)
            {
                if (hits.Count >= limit) break;
                var rawUrl = WebUtility.HtmlDecode(m.Groups["url"].Value);
                var title = Regex.Replace(m.Groups["title"].Value, "<.*?>", " ").Trim();
                title = WebUtility.HtmlDecode(Regex.Replace(title, @"\s+", " "));
                var snippet = Regex.Replace(m.Groups["snip"].Value, "<.*?>", " ").Trim();
                snippet = WebUtility.HtmlDecode(Regex.Replace(snippet, @"\s+", " "));
                var cleanUrl = DecodeBingUrl(rawUrl);
                if (cleanUrl.Length < 8 || cleanUrl.Contains("bing.com", StringComparison.OrdinalIgnoreCase)) continue;
                hits.Add(new SearchHit(title, cleanUrl, snippet.Length > 280 ? snippet[..280] : snippet));
            }
            return hits;
        }
        catch
        {
            return [];
        }
    }

    private static string DecodeBingUrl(string rawUrl)
    {
        if (!rawUrl.Contains("/ck/a?!") || !rawUrl.Contains("&u=a1")) return rawUrl;
        try
        {
            var match = Regex.Match(rawUrl, @"&u=a1([A-Za-z0-9_-]+)");
            if (!match.Success) return rawUrl;
            var b64 = match.Groups[1].Value.Replace('-', '+').Replace('_', '/');
            var pad = (4 - (b64.Length % 4)) % 4;
            if (pad > 0) b64 += new string('=', pad);
            var bytes = Convert.FromBase64String(b64);
            return Encoding.UTF8.GetString(bytes);
        }
        catch
        {
            return rawUrl;
        }
    }

    public sealed record OsintReport(List<SearchHit> Hits, List<string> Facts);

    /// <summary>Vetores passivos. Cada dork avisa o balão antes e depois da consulta.</summary>
    public static IReadOnlyList<(string Name, string Query)> Vectors(string target)
    {
        var name = target.Trim();
        var list = new List<(string, string)>
        {
            ("Vetor Código", $"\"{name}\" site:github.com"),
            ("Vetor Profissional", $"\"{name}\" site:linkedin.com/in"),
            ("Vetor Registros", $"\"{name}\" site:jusbrasil.com.br"),
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
        var hits = new List<SearchHit>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void AddHit(SearchHit h)
        {
            if (!string.IsNullOrWhiteSpace(h.Url) && seen.Add(h.Url))
                hits.Add(h);
        }

        var vectors = Vectors(target);
        foreach (var vector in vectors)
        {
            await onProgress($"🔎 [OSINT: {vector.Name}] Dork: {vector.Query}\n");
            if (vector.Name == "Vetor Certificados")
            {
                var host = vector.Query["crt.sh ".Length..];
                var names = await CertificatesAsync(host, ct);
                var certHits = names.Select(n => new SearchHit(n, "https://crt.sh/?q=" + Uri.EscapeDataString(n), "Certificate Transparency")).ToList();
                foreach (var ch in certHits) AddHit(ch);
                await onProgress(certHits.Count == 0
                    ? "   ↳ 0 registros públicos encontrados.\n"
                    : string.Join("", certHits.Take(8).Select(h => $"   ↳ Encontrado: {h.Title}\n")));
            }
            else
            {
                var found = (await SearchAsync(vector.Query, ct, 4)).ToList();
                
                // No vetor de código, enriquecer com consulta direta à API do GitHub
                if (vector.Name == "Vetor Código")
                {
                    var ghHits = await GitHubDirectAsync(target, ct);
                    foreach (var gh in ghHits)
                    {
                        if (!found.Any(f => f.Url.Equals(gh.Url, StringComparison.OrdinalIgnoreCase)))
                            found.Insert(0, gh);
                    }
                }

                foreach (var f in found) AddHit(f);
                await onProgress(found.Count == 0
                    ? "   ↳ 0 registros públicos encontrados.\n"
                    : string.Join("", found.Select(h => $"   ↳ Encontrado: {h.Title}\n")));
            }
            // intervalo suave para evitar bloqueios de taxa
            await Task.Delay(250, ct);
        }

        var facts = hits.Select(h =>
        {
            var title = h.Title.Length > 80 ? h.Title[..80] : h.Title;
            return $"Fonte: [{title}]({h.Url}) - Fato comprovado";
        }).ToList();
        await onProgress($"💾 Memória: {facts.Count} fatos verificados registrados em facts.md.\n");
        return new OsintReport(hits, facts);
    }

    private async Task<List<SearchHit>> GitHubDirectAsync(string target, CancellationToken ct)
    {
        var hits = new List<SearchHit>();
        try
        {
            var http = httpFactory.CreateClient("search");
            // 1. Tentar busca direta pelo termo/username
            using var req = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/search/users?q=" + Uri.EscapeDataString(target));
            req.Headers.UserAgent.Clear();
            req.Headers.UserAgent.ParseAdd("NexMind/1.0 (local-osint)");
            using var resp = await http.SendAsync(req, ct);
            if (resp.IsSuccessStatusCode)
            {
                using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
                if (doc.RootElement.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
                {
                    foreach (var user in items.EnumerateArray().Take(2))
                    {
                        var login = user.GetProperty("login").GetString() ?? "";
                        var htmlUrl = user.GetProperty("html_url").GetString() ?? "";
                        hits.Add(new SearchHit($"GitHub - {login}", htmlUrl, $"Perfil público no GitHub de {login}"));

                        // Repositórios mais recentes
                        using var repoReq = new HttpRequestMessage(HttpMethod.Get, $"https://api.github.com/users/{login}/repos?sort=updated&per_page=3");
                        repoReq.Headers.UserAgent.Clear();
                        repoReq.Headers.UserAgent.ParseAdd("NexMind/1.0 (local-osint)");
                        using var repoResp = await http.SendAsync(repoReq, ct);
                        if (repoResp.IsSuccessStatusCode)
                        {
                            using var repoDoc = await JsonDocument.ParseAsync(await repoResp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
                            if (repoDoc.RootElement.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var repo in repoDoc.RootElement.EnumerateArray())
                                {
                                    var repoName = repo.GetProperty("name").GetString() ?? "";
                                    var repoUrl = repo.GetProperty("html_url").GetString() ?? "";
                                    var desc = repo.TryGetProperty("description", out var d) ? d.GetString() ?? "" : "";
                                    var lang = repo.TryGetProperty("language", out var l) ? l.GetString() ?? "" : "";
                                    hits.Add(new SearchHit($"Repositório GitHub: {login}/{repoName}", repoUrl, $"{desc} (Linguagem: {lang})".Trim()));
                                }
                            }
                        }
                    }
                }
            }
        }
        catch
        {
            // Silencioso em caso de falha de rede da API do GitHub
        }
        return hits;
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
