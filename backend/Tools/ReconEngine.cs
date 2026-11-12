using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LocalAi.Api.Tools;

public sealed record RdapInfo(string? Registrar, string? Created, string? Updated, string? Expires, IReadOnlyList<string> Nameservers, IReadOnlyList<string> Status);

public sealed record ReconReport(bool Valid, string Domain, string Text);

/// <summary>
/// Recon de um domínio com ferramentas REAIS e evidência em cada linha: DNS, RDAP, Certificate Transparency (crt.sh) e um probe HTTP
/// leve. Cada dado sai com [CONFIRMED] (a consulta respondeu), [NOT_FOUND] (rodou e veio vazio, 404 ou NXDOMAIN) ou
/// [TOOL_UNAVAILABLE] (a consulta não pôde rodar). Nada é inventado: rota só aparece com o status HTTP que o servidor devolveu.
/// O probe HTTP recusa endereços privados e de loopback (o modelo não pode usar o recon para alcançar serviços da rede local).
/// </summary>
public sealed partial class ReconEngine(IHttpClientFactory httpFactory)
{
    public const string Confirmed = "[CONFIRMED]";
    public const string NotFound = "[NOT_FOUND]";
    public const string Unavailable = "[TOOL_UNAVAILABLE]";

    /// <summary>Caminhos sondados no probe (só o que o servidor responder entra no relatório).</summary>
    public static readonly string[] ProbePaths = ["/", "/robots.txt", "/sitemap.xml", "/.well-known/security.txt"];

    private static readonly string[] SecurityHeaders = ["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options", "X-Content-Type-Options"];

    [GeneratedRegex(@"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$", RegexOptions.IgnoreCase)]
    private static partial Regex DomainShape();

    /// <summary>"https://Alvo.com.br:8443/x?y" vira "alvo.com.br". Null se não for um nome de domínio (IP, localhost, texto livre).</summary>
    public static string? NormalizeDomain(string? input)
    {
        var text = (input ?? "").Trim().Trim('"', '\'', '`', '.', ',', ';', ' ');
        if (text.Length == 0) return null;
        if (text.Contains("://") && Uri.TryCreate(text, UriKind.Absolute, out var uri)) text = uri.Host;
        text = text.Split('/', '?', '#')[0];
        var at = text.LastIndexOf('@');
        if (at >= 0) text = text[(at + 1)..];
        var colon = text.LastIndexOf(':');
        if (colon > 0 && text[(colon + 1)..].All(char.IsDigit)) text = text[..colon];
        text = text.TrimEnd('.').ToLowerInvariant();
        if (text.Length > 253 || !DomainShape().IsMatch(text)) return null;
        return text;
    }

    /// <summary>Endereço roteável na internet pública. Falso para loopback, rede privada, link-local, CGNAT e equivalentes IPv6.</summary>
    public static bool IsPublicAddress(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any)) return false;
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return !(ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast || (ip.GetAddressBytes()[0] & 0xFE) == 0xFC);
        var b = ip.GetAddressBytes();
        return !(b[0] == 10 || b[0] == 0 || b[0] >= 224
            || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
            || (b[0] == 192 && b[1] == 168)
            || (b[0] == 169 && b[1] == 254)
            || (b[0] == 100 && b[1] >= 64 && b[1] <= 127));
    }

    /// <summary>RDAP oficial do Registro.br para .br; rdap.org (que redireciona ao registro certo) para os demais.</summary>
    public static string RdapUrl(string domain) =>
        domain.EndsWith(".br", StringComparison.OrdinalIgnoreCase)
            ? "https://rdap.registro.br/domain/" + domain
            : "https://rdap.org/domain/" + domain;

    /// <summary>Candidatos a domínio registrável: o próprio nome e, tirando rótulos da esquerda, até sobrarem 2 (3 se terminar em .br).</summary>
    public static List<string> RegistrableCandidates(string domain)
    {
        var labels = domain.Split('.');
        var min = domain.EndsWith(".br", StringComparison.OrdinalIgnoreCase) ? 3 : 2;
        var list = new List<string>();
        for (var i = 0; labels.Length - i >= Math.Min(min, labels.Length); i++)
        {
            list.Add(string.Join('.', labels.Skip(i)));
            if (list.Count >= 3) break;
        }
        return list;
    }

    public static RdapInfo? ParseRdap(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            string? created = null, updated = null, expires = null, registrar = null;
            if (root.TryGetProperty("events", out var events) && events.ValueKind == JsonValueKind.Array)
                foreach (var ev in events.EnumerateArray())
                {
                    var action = ev.TryGetProperty("eventAction", out var a) ? a.GetString() : null;
                    var date = ev.TryGetProperty("eventDate", out var d) ? d.GetString() : null;
                    if (date is null) continue;
                    if (action == "registration") created = date;
                    else if (action == "last changed") updated = date;
                    else if (action == "expiration") expires = date;
                }
            var ns = new List<string>();
            if (root.TryGetProperty("nameservers", out var servers) && servers.ValueKind == JsonValueKind.Array)
                foreach (var s in servers.EnumerateArray())
                    if (s.TryGetProperty("ldhName", out var n) && n.GetString() is { Length: > 0 } name) ns.Add(name.ToLowerInvariant());
            var status = new List<string>();
            if (root.TryGetProperty("status", out var st) && st.ValueKind == JsonValueKind.Array)
                foreach (var s in st.EnumerateArray()) if (s.GetString() is { Length: > 0 } v) status.Add(v);
            if (root.TryGetProperty("entities", out var entities) && entities.ValueKind == JsonValueKind.Array)
                foreach (var e in entities.EnumerateArray())
                {
                    if (!e.TryGetProperty("roles", out var roles) || roles.ValueKind != JsonValueKind.Array) continue;
                    if (!roles.EnumerateArray().Any(r => r.GetString() == "registrar")) continue;
                    registrar = VcardName(e) ?? (e.TryGetProperty("handle", out var h) ? h.GetString() : null);
                    if (registrar is not null) break;
                }
            if (created is null && updated is null && expires is null && ns.Count == 0 && registrar is null) return null;
            return new RdapInfo(registrar, created, updated, expires, ns, status);
        }
        catch (JsonException) { return null; }
    }

    private static string? VcardName(JsonElement entity)
    {
        if (!entity.TryGetProperty("vcardArray", out var vcard) || vcard.ValueKind != JsonValueKind.Array || vcard.GetArrayLength() < 2) return null;
        foreach (var prop in vcard[1].EnumerateArray())
            if (prop.ValueKind == JsonValueKind.Array && prop.GetArrayLength() >= 4 && prop[0].GetString() == "fn") return prop[3].GetString();
        return null;
    }

    /// <summary>Nomes (únicos, em minúsculas) do domínio e dos subdomínios vistos nos certificados. Total real em <paramref name="total"/>.</summary>
    public static List<string> ParseCrt(string json, string domain, int max, out int total)
    {
        total = 0;
        var names = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
            foreach (var row in doc.RootElement.EnumerateArray())
            {
                if (!row.TryGetProperty("name_value", out var value)) continue;
                foreach (var line in (value.GetString() ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    var name = line.TrimStart('*').TrimStart('.').ToLowerInvariant();
                    if (name.Length == 0 || name.Contains(' ')) continue;
                    if (name == domain || name.EndsWith("." + domain, StringComparison.Ordinal)) names.Add(name);
                }
            }
        }
        catch (JsonException) { return []; }
        total = names.Count;
        return names.Take(max).ToList();
    }

    /// <summary>Uma linha por cabeçalho de segurança: valor com [CONFIRMED] ou ausência com [NOT_FOUND]. HSTS só conta em HTTPS.</summary>
    public static List<string> HeaderEvidence(IReadOnlyDictionary<string, string> headers, bool https)
    {
        var lines = new List<string>();
        foreach (var name in SecurityHeaders)
        {
            if (name == "Strict-Transport-Security" && !https) { lines.Add($"- {name}: n/a (resposta em HTTP)"); continue; }
            var found = headers.FirstOrDefault(h => string.Equals(h.Key, name, StringComparison.OrdinalIgnoreCase));
            if (found.Key is null) lines.Add($"- {name}: ausente {NotFound}");
            else lines.Add($"- {name}: {Short(found.Value, 90)} {Confirmed}");
        }
        return lines;
    }

    private static string Short(string text, int max) => text.Length <= max ? text : text[..max] + "…";

    public async Task<ReconReport> RunAsync(string input, CancellationToken ct)
    {
        var domain = NormalizeDomain(input);
        if (domain is null)
            return new ReconReport(false, input ?? "", $"Entrada inválida: '{input}' não é um nome de domínio (ex.: exemplo.com.br). {NotFound}");

        var sb = new StringBuilder();
        sb.AppendLine($"RECON_TARGET {domain}");

        // DNS
        var addresses = new List<IPAddress>();
        sb.AppendLine("[DNS]");
        try
        {
            addresses.AddRange(await Dns.GetHostAddressesAsync(domain, ct));
            foreach (var ip in addresses.Take(6)) sb.AppendLine($"- {(ip.AddressFamily == AddressFamily.InterNetworkV6 ? "AAAA" : "A")} {ip} {Confirmed}");
        }
        catch (SocketException) { sb.AppendLine($"- Sem registro A/AAAA (NXDOMAIN ou sem resposta) {NotFound}"); }
        catch (Exception ex) when (ex is not OperationCanceledException) { sb.AppendLine($"- Resolução DNS falhou: {ex.GetType().Name} {Unavailable}"); }

        // RDAP
        sb.AppendLine("[RDAP]");
        await AppendRdapAsync(sb, domain, ct);

        // Certificate Transparency
        sb.AppendLine("[CERTIFICADOS crt.sh]");
        await AppendCrtAsync(sb, domain, ct);

        // HTTP
        sb.AppendLine("[HTTP]");
        await AppendHttpAsync(sb, domain, addresses, ct);

        return new ReconReport(true, domain, sb.ToString().TrimEnd());
    }

    private async Task AppendRdapAsync(StringBuilder sb, string domain, CancellationToken ct)
    {
        var http = httpFactory.CreateClient("search");
        var reached = false;
        foreach (var candidate in RegistrableCandidates(domain))
        {
            try
            {
                using var resp = await http.GetAsync(RdapUrl(candidate), ct);
                reached = true;
                if ((int)resp.StatusCode == 404) continue;
                if (!resp.IsSuccessStatusCode) { sb.AppendLine($"- RDAP respondeu {(int)resp.StatusCode} para {candidate} {Unavailable}"); return; }
                var info = ParseRdap(await resp.Content.ReadAsStringAsync(ct));
                if (info is null) { sb.AppendLine($"- RDAP de {candidate} veio sem dados utilizáveis {NotFound}"); return; }
                sb.AppendLine($"- Domínio consultado: {candidate} {Confirmed}");
                if (info.Registrar is not null) sb.AppendLine($"- Registrar: {info.Registrar} {Confirmed}");
                if (info.Created is not null) sb.AppendLine($"- Criado: {info.Created} {Confirmed}");
                if (info.Updated is not null) sb.AppendLine($"- Última alteração: {info.Updated} {Confirmed}");
                if (info.Expires is not null) sb.AppendLine($"- Expira: {info.Expires} {Confirmed}");
                if (info.Nameservers.Count > 0) sb.AppendLine($"- Nameservers: {string.Join(", ", info.Nameservers)} {Confirmed}");
                if (info.Status.Count > 0) sb.AppendLine($"- Status: {string.Join(", ", info.Status.Take(4))} {Confirmed}");
                return;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                sb.AppendLine($"- RDAP indisponível ({ex.GetType().Name}) {Unavailable}");
                return;
            }
        }
        sb.AppendLine(reached ? $"- Nenhum registro RDAP encontrado nesta consulta {NotFound}" : $"- RDAP não pôde ser consultado {Unavailable}");
    }

    private async Task AppendCrtAsync(StringBuilder sb, string domain, CancellationToken ct)
    {
        try
        {
            var http = httpFactory.CreateClient("recon-slow"); // crt.sh costuma levar mais de 8 s
            using var resp = await http.GetAsync("https://crt.sh/?q=" + Uri.EscapeDataString(domain) + "&output=json", ct);
            if (!resp.IsSuccessStatusCode) { sb.AppendLine($"- crt.sh respondeu {(int)resp.StatusCode} {Unavailable}"); return; }
            var names = ParseCrt(await resp.Content.ReadAsStringAsync(ct), domain, 15, out var total);
            if (total == 0) { sb.AppendLine($"- Nenhum certificado encontrado nesta consulta {NotFound}"); return; }
            sb.AppendLine($"- {total} nome(s) em certificados {Confirmed}: {string.Join(", ", names)}{(total > names.Count ? $" (+{total - names.Count} omitidos)" : "")}");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            sb.AppendLine($"- crt.sh indisponível ({ex.GetType().Name}) {Unavailable}");
        }
    }

    private async Task AppendHttpAsync(StringBuilder sb, string domain, List<IPAddress> addresses, CancellationToken ct)
    {
        if (addresses.Count == 0) { sb.AppendLine($"- Sem IP para sondar {NotFound}"); return; }
        if (!addresses.Any(IsPublicAddress)) { sb.AppendLine($"- Todos os IPs são privados ou locais: probe HTTP bloqueado por segurança {NotFound}"); return; }

        var http = httpFactory.CreateClient("recon");
        foreach (var scheme in new[] { "https", "http" })
        {
            var baseUrl = $"{scheme}://{domain}";
            var first = await ProbeAsync(http, baseUrl + "/", ct);
            if (first is null) { sb.AppendLine($"- {baseUrl}/ sem resposta (conexão recusada, timeout ou TLS) {NotFound}"); continue; }

            var (status, headers) = first.Value;
            headers.TryGetValue("Location", out var location);
            headers.TryGetValue("Server", out var server);
            sb.AppendLine($"- {baseUrl}/ -> {status}{(location is null ? "" : " Location: " + Short(location, 80))}{(server is null ? "" : " Server: " + Short(server, 40))} {Confirmed}");
            foreach (var line in HeaderEvidence(headers, scheme == "https")) sb.AppendLine(line);

            foreach (var path in ProbePaths.Skip(1))
            {
                var r = await ProbeAsync(http, baseUrl + path, ct);
                if (r is null) { sb.AppendLine($"- {path}: sem resposta {NotFound}"); continue; }
                sb.AppendLine($"- {path} -> {r.Value.Status} {(r.Value.Status is 200 or 301 or 302 or 403 ? Confirmed : NotFound)}");
            }
            return; // o esquema que respondeu basta
        }
    }

    private static async Task<(int Status, Dictionary<string, string> Headers)?> ProbeAsync(HttpClient http, string url, CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct); // só os cabeçalhos: o corpo não é lido
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var h in resp.Headers) headers[h.Key] = string.Join(", ", h.Value);
            foreach (var h in resp.Content.Headers) headers[h.Key] = string.Join(", ", h.Value);
            return ((int)resp.StatusCode, headers);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            return null;
        }
    }
}
