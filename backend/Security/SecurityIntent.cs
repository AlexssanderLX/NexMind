using System.Text.RegularExpressions;
using LocalAi.Api.Planning;

namespace LocalAi.Api.Security;

/// <param name="AgentId">O especialista pedido, ou null para "todos os subagentes".</param>
public sealed record NotesRequest(string? AgentId);

/// <summary>
/// O Alexssander está PERGUNTANDO pelas anotações dos subagentes? ("O que o Recon achou?", "Mostre as anotações do Auth".)
/// Só nesse caso o Nex principal lê a pasta security/. Função pura, sem arquivo: o que decide é a frase.
/// </summary>
public static partial class SecurityIntent
{
    [GeneratedRegex(@"\b(achou|achamos|acharam|descobriu|descobriram|encontrou|encontraram|anotou|anotaram|anotacoes?|notas|relatorio|findings|resultados?|conclusoes?|concluiu|concluiram)\b")]
    private static partial Regex AskWords();

    [GeneratedRegex(@"\bsubagentes?\b|\bespecialistas?\b")]
    private static partial Regex Generic();

    private static readonly (string Id, Regex Words)[] Agents =
    [
        ("recon", new Regex(@"\b(recon|reconhecimento)\b", RegexOptions.Compiled)),
        ("auth", new Regex(@"\b(auth|autenticacao|autorizacao)\b", RegexOptions.Compiled)),
        ("input", new Regex(@"\b(input|injecao)\b", RegexOptions.Compiled)),
        ("logic", new Regex(@"\b(logic|logica)\b", RegexOptions.Compiled)),
        ("verify", new Regex(@"\b(verify|verificacao|verificador)\b", RegexOptions.Compiled)),
    ];

    public static NotesRequest? Detect(string? userText)
    {
        // o texto dos anexos não conta
        var plain = IntentRouter.Normalize(Regex.Replace(userText ?? "", @"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]", " "));
        if (!AskWords().IsMatch(plain)) return null;
        var named = Agents.Where(a => a.Words.IsMatch(plain)).Select(a => a.Id).ToList();
        if (named.Count == 1) return new NotesRequest(named[0]);
        if (named.Count > 1 || Generic().IsMatch(plain)) return new NotesRequest(null);
        return null;
    }

    /// <summary>Frase curta para o bloco de planejamento ("Leitura pontual: notas do Recon").</summary>
    public static string Describe(NotesRequest ask) =>
        ask.AgentId is null ? "Leitura pontual: notas de todos os subagentes de Security" : $"Leitura pontual: notas do {SubagentCatalog.Find(ask.AgentId)?.Name ?? ask.AgentId}";
}
