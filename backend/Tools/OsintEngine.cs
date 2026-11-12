using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LocalAi.Api.Tools;

public sealed record OsintFinding(string Title, string Url, string Snippet);

public sealed record OsintResult(string Target, string Kind, IReadOnlyList<OsintFinding> Findings, IReadOnlyList<string> Facts);

/// <summary>
/// OSINT passivo. Domínio: Certificate Transparency no crt.sh, sem pedido ao alvo.
/// Pessoa: buscas públicas com dorks. Nada aqui explora serviço.
/// </summary>
public sealed partial class OsintEngine(IHttpClientFactory httpFactory, Research research)
{
    [GeneratedRegex(@"\bosint\s+(?:sobre|de|em|do|da|no|na|para)?\s*(.+)$", RegexOptions.IgnoreCase)]
    private static partial Regex TargetPhrase();

    [GeneratedRegex(@"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$", RegexOptions.IgnoreCase)]
    private static partial Regex DomainShape();

    public static string? TargetOf(string userText)
    {
        var plain = Regex.Replace(userText ?? "", @"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]", " ").Trim();
        var match = TargetPhrase().Match(plain);
        if (!match.Success) return null;
        var target = match.Groups[1].Value.Trim().Trim('"', '\'', '.', '?', '!');
        return target.Length >= 3 ? target : null;
    }

    public static bool IsDomain(string target)
    {
        var host = target.Trim().TrimEnd('/');
        if (host.Contains("://"))
        {
            if (!Uri.TryCreate(host, UriKind.Absolute, out var uri)) return false;
            host = uri.Host;
        }
        host = host.Split('/')[0];
        return DomainShape().IsMatch(host);
    }

    public async Task<OsintResult> InvestigateAsync(string target, CancellationToken ct)
    {
        target = target.Trim();
        if (IsDomain(target)) return await DomainAsync(HostOf(target), ct);
        return await PersonAsync(target, ct);
    }

    private async Task<OsintResult> DomainAsync(string host, CancellationToken ct)
    {
        var findings = new List<OsintFinding>();
        foreach (var name in await CertificatesAsync(host, ct))
            findings.Add(new OsintFinding(name, "https://crt.sh/?q=" + Uri.EscapeDataString(name), "Nome visto em Certificate Transparency."));
        foreach (var hit in await research.SearchAsync("site:" + host, ct))
            findings.Add(new OsintFinding(hit.Title, hit.Url, hit.Snippet));
        return Pack(host, "domínio", findings);
    }

    private async Task<OsintResult> PersonAsync(string name, CancellationToken ct)
    {
        var findings = new List<OsintFinding>();
        foreach (var query in new[] { $"\"{name}\" site:github.com", $"\"{name}\" developer" })
        {
            foreach (var hit in await research.SearchAsync(query, ct))
                findings.Add(new OsintFinding(hit.Title, hit.Url, hit.Snippet));
        }
        return Pack(name, "pessoa", findings);
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
                    if (name.Length == 0 || name.Contains(' ')) continue;
                    if (!name.Equals(host, StringComparison.OrdinalIgnoreCase) && !name.EndsWith("." + host, StringComparison.OrdinalIgnoreCase)) continue;
                    names.Add(name.ToLowerInvariant());
                    if (names.Count >= 30) return names.OrderBy(n => n).ToList();
                }
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            return names.OrderBy(n => n).ToList();
        }
        return names.OrderBy(n => n).ToList();
    }

    private static OsintResult Pack(string target, string kind, List<OsintFinding> findings)
    {
        var unique = new List<OsintFinding>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in findings)
        {
            if (string.IsNullOrWhiteSpace(item.Url) || !seen.Add(item.Url)) continue;
            unique.Add(item);
            if (unique.Count >= 12) break;
        }
        var facts = unique.Select(f => FactExtractorLine(f.Title, f.Url)).Where(s => s.Length > 0).ToList();
        return new OsintResult(target, kind, unique, facts);
    }

    public static string FactExtractorLine(string title, string url)
    {
        var line = WebUtility.HtmlDecode($"{title} | {url}").Replace('\n', ' ').Trim();
        return line.Length > 220 ? line[..220] : line;
    }

    private static string HostOf(string target)
    {
        var host = target.Trim();
        if (host.Contains("://") && Uri.TryCreate(host, UriKind.Absolute, out var uri)) host = uri.Host;
        return host.Split('/')[0].Trim().TrimEnd('.');
    }
}
