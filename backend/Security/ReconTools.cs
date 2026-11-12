using System.Text.Json;
using LocalAi.Api.Llm;
using LocalAi.Api.Tools;

namespace LocalAi.Api.Security;

/// <summary>
/// Ferramentas nativas de Security entregues ao Nex principal (modo Security) e aos subagentes:
///   recon_target(domain)  DNS, RDAP, crt.sh e probe HTTP reais, cada dado com [CONFIRMED], [NOT_FOUND] ou [TOOL_UNAVAILABLE]
///   vault_read(drawer)    lê uma gaveta da investigação (escopo, superfície, hipóteses, testes, efeitos, evidências)
/// Leitura apenas: não pedem aprovação. O que NÃO está aqui (Burp, ZAP, Wappalyzer, nmap) não existe, e o modelo deve dizer isso.
/// </summary>
public static class ReconTools
{
    public const string Recon = "recon_target";
    public const string VaultRead = "vault_read";

    public const string ReconDescription =
        "O QUE FAZ: faz o recon real de um domínio: DNS (A/AAAA), RDAP (registrar, datas, nameservers), certificados no crt.sh (subdomínios) e um probe HTTP leve (status, Server, CSP, HSTS, X-Frame-Options, robots.txt, sitemap.xml, security.txt). Cada linha vem com [CONFIRMED], [NOT_FOUND] ou [TOOL_UNAVAILABLE].\n" +
        "QUANDO USAR: ao pedido de recon, OSINT, mapear ou investigar um domínio. Se o Alexssander não citar o domínio, use o da gaveta Escopo & Alvos.\n" +
        "COMO USAR: domain = só o domínio, sem http nem caminho (ex.: exemplo.com.br).\n" +
        "NÃO FAÇA: não invente rota, subdomínio, porta ou cabeçalho que não esteja no resultado; não use em IP nem em rede local (é recusado); não finja outra ferramenta.\n" +
        "RETORNA: relatório em texto com uma seção por consulta. Copie o estado de cada achado exatamente como veio.";

    public const string VaultDescription =
        "O QUE FAZ: lê uma gaveta da investigação desta conversa, na versão que o Alexssander editou.\n" +
        "QUANDO USAR: antes de agir sobre alvo, escopo ou achados anteriores; e quando ele perguntar o que está salvo.\n" +
        "COMO USAR: drawer = scope, surface, hypotheses, tests, effects ou evidence.\n" +
        "NÃO FAÇA: não invente conteúdo de gaveta vazia; não grave por aqui (só leitura).\n" +
        "RETORNA: o texto da gaveta, ou aviso de que está vazia.";

    public static bool IsReconTool(string name) => name is Recon or VaultRead;

    public static List<object> Definitions(bool includeRecon = true, bool includeVault = true)
    {
        var list = new List<object>();
        if (includeRecon)
            list.Add(new
            {
                type = "function",
                function = new
                {
                    name = Recon,
                    description = ReconDescription,
                    parameters = new
                    {
                        type = "object",
                        properties = new Dictionary<string, object> { ["domain"] = new { type = "string", description = "Domínio alvo, ex.: exemplo.com.br" } },
                        required = new[] { "domain" },
                    },
                },
            });
        if (includeVault)
            list.Add(new
            {
                type = "function",
                function = new
                {
                    name = VaultRead,
                    description = VaultDescription,
                    parameters = new
                    {
                        type = "object",
                        properties = new Dictionary<string, object> { ["drawer"] = new { type = "string", description = "scope, surface, hypotheses, tests, effects ou evidence" } },
                        required = new[] { "drawer" },
                    },
                },
            });
        return list;
    }

    /// <summary>Executa a chamada. Devolve (ok, texto para o modelo), já cortado em <paramref name="maxChars"/> numa quebra de linha.</summary>
    public static async Task<(bool Ok, string Text)> HandleAsync(ToolCall call, ReconEngine recon, SecurityNotes notes, string conversationId, int maxChars, CancellationToken ct)
    {
        if (call.Name == VaultRead)
        {
            var key = (Arg(call.Arguments, "drawer") ?? "").Trim().ToLowerInvariant();
            if (!SecurityNotes.VaultKeys.Contains(key)) return (false, $"Gaveta '{key}' não existe. Use: {string.Join(", ", SecurityNotes.VaultKeys)}.");
            var text = notes.ReadVault(conversationId, key).Text.Trim();
            return (true, text.Length == 0 ? $"A gaveta {key} está vazia. {ReconEngine.NotFound}" : Clip(text, maxChars));
        }
        if (call.Name == Recon)
        {
            var domain = Arg(call.Arguments, "domain");
            // sem argumento válido, cai no alvo da gaveta de escopo (o Alexssander já o cadastrou)
            if (ReconEngine.NormalizeDomain(domain) is null)
                domain = OperatorIntent.TargetFromScope(notes.ReadVault(conversationId, "scope").Text);
            var report = await recon.RunAsync(domain ?? "", ct);
            return (report.Valid, Clip(report.Text, maxChars));
        }
        return (false, $"A ferramenta '{call.Name}' não existe.");
    }

    private static string Clip(string text, int maxChars)
    {
        if (text.Length <= maxChars) return text;
        var cut = text.LastIndexOf('\n', Math.Max(0, maxChars - 1));
        if (cut < maxChars / 2) cut = maxChars;
        return text[..cut].TrimEnd() + "\n[…cortado para caber no contexto]";
    }

    private static string? Arg(JsonElement args, string key)
    {
        if (args.ValueKind != JsonValueKind.Object) return null;
        foreach (var p in args.EnumerateObject())
            if (string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase))
                return p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.ToString();
        return null;
    }
}
