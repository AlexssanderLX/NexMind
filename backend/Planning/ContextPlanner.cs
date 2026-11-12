namespace LocalAi.Api.Planning;

/// <param name="Complexity">direta (conversa), ferramenta (usa MCP) ou extensa (muito texto ou anexos grandes).</param>
/// <param name="GpuNote">Onde o modelo roda neste contexto, para mostrar no planejamento.</param>
/// <param name="Warning">Aviso de desempenho ou de corte, quando houver.</param>
public sealed record ContextPlan(int NumCtx, string Complexity, string GpuNote, string? Warning);

/// <summary>
/// Contexto adaptativo. Medido na RTX 3050 de 6 GB: 4k e 8k ficam 100% na GPU (~41 tok/s), 16k manda 12 das 36 camadas
/// para a RAM, 32k deixa ~36% na CPU (~14 tok/s). Então começa em 4096 e só sobe quando a conversa realmente precisa;
/// o valor das Configurações é o TETO, não o padrão.
/// </summary>
public static class ContextPlanner
{
    public static readonly int[] Steps = [4096, 8192, 16384, 32768];

    /// <summary>Tokens estimados de um texto (~3 caracteres por token em português com código).</summary>
    public static int EstimateTokens(int chars) => (int)Math.Ceiling(chars / 3.0);

    /// <param name="ceiling">Contexto máximo das Configurações.</param>
    /// <param name="promptTokens">Prompt de sistema + definições das ferramentas já injetadas.</param>
    /// <param name="conversationTokens">Histórico + a mensagem atual.</param>
    /// <param name="usesMcp">Alguma ferramenta MCP foi injetada: os resultados (páginas, arquivos) ocupam contexto.</param>
    /// <param name="attachmentChars">Texto de anexos na mensagem.</param>
    /// <param name="loadedCtx">Contexto do modelo que já está carregado na GPU (trocar de contexto recarrega o modelo, ~7 s).</param>
    public static ContextPlan Plan(int ceiling, int promptTokens, int conversationTokens, bool usesMcp, int attachmentChars, int? loadedCtx)
    {
        const int replyRoom = 1000;       // espaço para a resposta
        const int toolResultsRoom = 2500; // páginas e arquivos lidos nesta rodada

        var needed = promptTokens + conversationTokens + replyRoom + (usesMcp ? toolResultsRoom : 0);
        var pick = Steps.FirstOrDefault(s => s >= needed);
        if (pick == 0) pick = Steps[^1];
        if (usesMcp && pick < 8192) pick = 8192; // ferramenta de navegador/arquivo não cabe direito em 4k

        string? warning = null;
        var cap = Math.Max(ceiling, 1024);
        if (pick > cap)
        {
            if (needed > cap) warning = $"O conteúdo precisa de ~{needed} tokens e o máximo nas Configurações é {cap}: o início da conversa pode ser cortado.";
            pick = cap;
        }

        // histerese: trocar de contexto recarrega o modelo (~7 s). Se já há um carregado até 8k (100% GPU) e ele serve, fica nele.
        if (loadedCtx is int lc && lc > pick && lc <= 8192 && lc <= cap) pick = lc;

        var complexity = attachmentChars > 6000 || needed > 8192 ? "extensa" : usesMcp ? "ferramenta" : "direta";
        if (pick >= 16384)
            warning ??= $"Contexto de {pick}: parte das camadas vai para a RAM e a resposta fica mais lenta ({(pick >= 32768 ? "~14" : "~25")} tok/s).";

        return new ContextPlan(pick, complexity, GpuNote(pick), warning);
    }

    public static string GpuNote(int numCtx) => numCtx switch
    {
        <= 8192 => "100% na GPU",
        <= 16384 => "24 de 36 camadas na GPU, 12 na RAM",
        _ => "~36% na CPU",
    };
}
