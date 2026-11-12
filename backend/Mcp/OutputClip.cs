namespace LocalAi.Api.Mcp;

/// <summary>Corte da saída das ferramentas para caber no contexto.</summary>
public static class OutputClip
{
    /// <summary>
    /// Corta a saída no limite do contexto SEM partir uma linha ou uma tag ao meio: recua até a última quebra de linha
    /// (ou o último ">") dentro dos 25% finais da janela. Se não houver ponto limpo, corta seco no limite.
    /// </summary>
    public static string Clip(string text, int maxChars)
    {
        if (text.Length <= maxChars) return text;
        var cut = maxChars;
        var floor = maxChars - maxChars / 4;
        var nl = text.LastIndexOf('\n', maxChars - 1, maxChars - floor);
        var tag = text.LastIndexOf('>', maxChars - 1, maxChars - floor);
        var best = nl >= floor ? nl : tag; // prefere a quebra de linha: um ">" no meio de uma linha ainda deixaria a linha pela metade
        if (best >= floor) cut = best + 1;
        return text[..cut].TrimEnd() + "\n[…saída cortada para caber no contexto: peça só um trecho (head/tail) ou busque antes]";
    }
}
