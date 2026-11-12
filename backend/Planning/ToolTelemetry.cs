using System.Text;
using System.Text.Json;

namespace LocalAi.Api.Planning;

/// <summary>Texto curto que a barra de tarefa mostra enquanto a ferramenta roda ("url=https://…"), para o usuário não ficar no escuro.</summary>
public static class ToolTelemetry
{
    /// <summary>Resume os argumentos de uma chamada numa linha curta. Textos longos (conteúdo de arquivo, texto digitado) são cortados.</summary>
    public static string Summarize(JsonElement args, int max = 140)
    {
        if (args.ValueKind != JsonValueKind.Object) return "";
        var sb = new StringBuilder();
        foreach (var p in args.EnumerateObject())
        {
            var value = p.Value.ValueKind switch
            {
                JsonValueKind.String => p.Value.GetString() ?? "",
                JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False => p.Value.ToString(),
                _ => "…",
            };
            value = value.Replace("\r", " ").Replace("\n", " ");
            if (value.Length > 60) value = value[..60] + "…";
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(p.Name).Append('=').Append(value);
            if (sb.Length >= max) break;
        }
        var text = sb.ToString();
        return text.Length > max ? text[..max] + "…" : text;
    }

    /// <summary>
    /// "Bateria de memória ativa": diz ao modelo quanto do contexto já está ocupado, para ele se autorregular. Passou de 75%, ele
    /// grava os achados no caderno (se a ferramenta está disponível) e responde direto, preservando a velocidade da GPU.
    /// </summary>
    public static string MemoryTelemetry(ContextPlan plan, bool notebookAvailable)
    {
        var pct = Math.Clamp(plan.EstimatedTokens * 100 / Math.Max(plan.NumCtx, 1), 1, 100);
        var offload = notebookAvailable ? "descarregue os achados em disco com topic_write" : "não há caderno nesta mensagem: resuma os achados na resposta";
        return $"[TELEMETRIA DE MEMÓRIA ATIVA: {plan.EstimatedTokens}/{plan.NumCtx} tokens ({pct}% ocupado) | Diretriz: se passar de 75%, {offload} e mantenha suas respostas diretas para preservar 100% da velocidade da GPU]";
    }

    /// <summary>O bloco que abre o raciocínio. Em OSINT, só as fases da investigação. Sem métrica de GPU.</summary>
    public static string PlanningBlock(ToolIntent intent, ContextPlan plan, string? hint = null, string? osintTarget = null)
    {
        if (!string.IsNullOrWhiteSpace(osintTarget))
        {
            var sbOsint = new StringBuilder();
            sbOsint.AppendLine("💭 [Investigação OSINT]");
            sbOsint.AppendLine($"• Alvo: {osintTarget}");
            sbOsint.AppendLine("• Escopo: Reconhecimento Passivo Multi-Vetores");
            return sbOsint.ToString();
        }
        var sb = new StringBuilder();
        sb.AppendLine("💭 [Planejamento de Execução]");
        sb.AppendLine($"• Complexidade: {plan.Complexity}");
        sb.AppendLine($"• Contexto: {plan.NumCtx} ({plan.GpuNote})");
        sb.AppendLine($"• Ferramentas: {(intent.Any ? "[" + intent.Describe() + "]" : "nenhuma")}");
        if (!string.IsNullOrWhiteSpace(hint)) sb.AppendLine($"• {hint}");
        if (plan.Warning is not null) sb.AppendLine($"⚠ {plan.Warning}");
        return sb.ToString();
    }
}
