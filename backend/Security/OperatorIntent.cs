using System.Text.RegularExpressions;
using LocalAi.Api.Planning;

namespace LocalAi.Api.Security;

public enum OperatorIntentKind
{
    Other,
    Capabilities,
    Planning,
    Execution,
}

/// <summary>Classifica a frase do Alexssander antes de ligar ferramenta.</summary>
public static class OperatorIntent
{
    public static OperatorIntentKind Classify(string? userText)
    {
        var plain = IntentRouter.Normalize(Regex.Replace(userText ?? "", @"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]", " "));
        if (Regex.IsMatch(plain, @"\b(o que voce pode|oq vc pode|quais suas ferramentas|que ferramentas|o que vc faz|so um teste)\b"))
            return OperatorIntentKind.Capabilities;
        if (Regex.IsMatch(plain, @"\b(salvei um alvo|ta no escopo|olha a gaveta|alvo salvo|no escopo|cadastr|vetor)\b"))
            return OperatorIntentKind.Planning;
        if (Regex.IsMatch(plain, @"\b(faca o recon|faca recon|investigue|mapeie|osint|subdominios)\b"))
            return OperatorIntentKind.Execution;
        if (Regex.IsMatch(plain, @"\bescopo\b"))
            return OperatorIntentKind.Planning;
        return OperatorIntentKind.Other;
    }

    public static bool WantsScope(string? userText)
    {
        var plain = IntentRouter.Normalize(Regex.Replace(userText ?? "", @"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]", " "));
        return Regex.IsMatch(plain, @"\b(salvei um alvo|ta no escopo|olha a gaveta|alvo salvo|no escopo|meu alvo|nosso alvo|esse alvo|nesse alvo|o dominio|meu dominio|nesse dominio)\b");
    }

    /// <summary>Primeiro domínio, ou a primeira linha útil, da gaveta Escopo & Alvos.</summary>
    public static string? TargetFromScope(string? scopeText)
    {
        var text = scopeText ?? "";
        var host = Regex.Match(text, @"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b", RegexOptions.IgnoreCase);
        if (host.Success) return host.Value.ToLowerInvariant();
        foreach (var line in text.Split('\n'))
        {
            var t = line.Trim().TrimStart('-', '*', ' ');
            if (t.Length >= 3 && !t.StartsWith('#')) return t;
        }
        return null;
    }

    public const string EvidenceRules =
        "POLÍTICA DE EVIDÊNCIA: cada achado leva um estado. [CONFIRMED] só com resposta de ferramenta desta rodada. " +
        "[INFERRED] só como hipótese em cima de dado confirmado. [NOT_FOUND] quando a consulta rodou e veio vazio, 404 ou NXDOMAIN: escreva \"Nenhum registro encontrado nesta consulta\". " +
        "[TOOL_UNAVAILABLE] se a ferramenta não está na lista. [UNVERIFIED] para fala de terceiro sem teste. " +
        "Proibido inventar rota, arquivo, porta, subdomínio, registrar ou cabeçalho. " +
        "Proibido escrever bloco fingindo comando (wappalyzer, burp ou similar) para o Alexssander colar. " +
        "Se a ferramenta existe, chame-a. Se não existe, diga em uma frase: \"Não possuo ferramenta local para esse teste específico\" e pergunte se ele quer hipóteses conceituais. " +
        "Delegação: superfície, certificado, DNS e endpoint ficam com o Recon; BOLA, IDOR, JWT e contas com o Auth; XSS, SQLi e SSRF com marcador inerte com o Input; regra de negócio e race com o Logic; contraprova com o Verify. Ao delegar, cite o alvo, a hipótese e a nota gerada. " +
        "Descoberta com URL confirmada vai para a gaveta Superfície. Suspeita sem teste vai para Hipóteses. Não pergunte o domínio se a gaveta Escopo & Alvos já tem o alvo.";

    public static string Directive(OperatorIntentKind kind, string scopeText)
    {
        var scope = string.IsNullOrWhiteSpace(scopeText)
            ? "[Escopo & Alvos] vazia. Nenhum domínio autorizado registrado nesta conversa."
            : "[Escopo & Alvos]\n" + scopeText.Trim();
        var action = kind switch
        {
            OperatorIntentKind.Capabilities =>
                "CLASSIFICAÇÃO: [CAPABILITIES_QUERY]. Liste só as capacidades reais: recon_target (DNS A/AAAA, RDAP com registrar, datas e nameservers, subdomínios no crt.sh, probe HTTP com status, Server, CSP, HSTS e X-Frame-Options), navegador no grupo Nex, arquivos, computador, pesquisa, caderno, OSINT passivo, leitura das gavetas e os subagentes. " +
                "Se a gaveta Escopo & Alvos tem um alvo, diga que é nele que essas ferramentas atuam e cite o domínio, sem perguntar de novo. NÃO cite Burp, ZAP, Wappalyzer, nmap nem rotas como /admin: não existem aqui e nada foi sondado ainda. Não recite o checklist de 6 passos. Não chame ferramenta.",
            OperatorIntentKind.Planning =>
                "CLASSIFICAÇÃO: [PLANNING_AND_SCOPE]. A gaveta abaixo já foi lida. Se houver alvo, ele é a verdade oficial: confirme e proponha o teste mínimo. Proibido perguntar \"qual é o domínio?\". Não execute ainda.",
            OperatorIntentKind.Execution =>
                "CLASSIFICAÇÃO: [ACTIVE_EXECUTION]. Use só ferramenta disponível e o que ela devolveu. Etiquete cada achado como [CONFIRMED] ou [NOT_FOUND].",
            _ => "Antes de analisar, consulte a gaveta de escopo abaixo. O alvo cadastrado nela é o alvo padrão de toda ação de Recon e Pentest: se o Alexssander disser \"meu alvo\", \"o domínio\" ou \"tá no escopo\", use o domínio da gaveta sem perguntar de novo. Não invente alvo.",
        };
        return EvidenceRules + "\n" + action + "\n" + scope;
    }
}
