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
        await foreach (var chunk in ollama.ChatAsync(model, system, recent, 2048, false, ct))
        {
            if (!string.IsNullOrEmpty(chunk.Content)) sb.Append(chunk.Content);
        }
        return Parse(sb.ToString());
    }

    public async Task<IReadOnlyList<SearchHit>> SearchAsync(string query, CancellationToken ct)
    {
        var http = httpFactory.CreateClient("search");
        using var body = new FormUrlEncodedContent(new Dictionary<string, string> { ["q"] = query });
        using var resp = await http.PostAsync("https://html.duckduckgo.com/html/", body, ct);
        if (!resp.IsSuccessStatusCode) return [];
        var html = await resp.Content.ReadAsStringAsync(ct);
        var hits = new List<SearchHit>();
        foreach (Match m in Regex.Matches(html, "result__a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", RegexOptions.Singleline))
        {
            if (hits.Count >= 4) break;
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
