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
        if (Regex.IsMatch(plain, @"\b(faca o recon|faca recon|investigue|mapeie|osint|subdominios)\b"))
            return OperatorIntentKind.Execution;
        if (Regex.IsMatch(plain, @"\b(escopo|alvo salvo|ta no escopo|no escopo|cadastr|vetor)\b"))
            return OperatorIntentKind.Planning;
        return OperatorIntentKind.Other;
    }

    public const string EvidenceRules =
        "POLÍTICA DE EVIDÊNCIA: cada achado leva um estado. [CONFIRMED] só com resposta de ferramenta desta rodada. " +
        "[INFERRED] só como hipótese em cima de dado confirmado. [NOT_FOUND] quando a consulta rodou e veio vazio, 404 ou NXDOMAIN: escreva \"Nenhum registro encontrado nesta consulta\". " +
        "[TOOL_UNAVAILABLE] se a ferramenta não está na lista. [UNVERIFIED] para fala de terceiro sem teste. " +
        "Proibido inventar rota, arquivo, porta, subdomínio, registrar ou cabeçalho. " +
        "Proibido emitir caixa de comando para o Alexssander colar, a menos que ele peça o comando manual. " +
        "Se a ação não tem ferramenta local, diga: \"Não possuo ferramenta local ativa para executar esta ação\".";

    public static string Directive(OperatorIntentKind kind, string scopeText)
    {
        var scope = string.IsNullOrWhiteSpace(scopeText)
            ? "[Escopo & Alvos] vazia. Nenhum domínio autorizado registrado nesta conversa."
            : "[Escopo & Alvos]\n" + scopeText.Trim();
        var action = kind switch
        {
            OperatorIntentKind.Capabilities =>
                "CLASSIFICAÇÃO: [CAPABILITIES_QUERY]. Liste só as capacidades reais (navegador no grupo Nex, arquivos, computador, pesquisa, caderno, OSINT passivo, subagentes). Não recite o checklist de 6 passos. Não chame ferramenta.",
            OperatorIntentKind.Planning =>
                "CLASSIFICAÇÃO: [PLANNING_AND_SCOPE]. Confirme o alvo com a gaveta abaixo. Se ele disse que o alvo já está salvo, use o que está na gaveta e não peça para digitar de novo. Proponha o teste mínimo. Não execute ainda.",
            OperatorIntentKind.Execution =>
                "CLASSIFICAÇÃO: [ACTIVE_EXECUTION]. Use só ferramenta disponível e o que ela devolveu. Etiquete cada achado como [CONFIRMED] ou [NOT_FOUND].",
            _ => "Antes de analisar, consulte a gaveta de escopo abaixo. Não invente alvo.",
        };
        return EvidenceRules + "\n" + action + "\n" + scope;
    }
}
