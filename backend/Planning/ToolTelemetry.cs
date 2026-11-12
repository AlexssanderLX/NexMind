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

    /// <summary>O bloco que abre o raciocínio de cada resposta: o que o Nex decidiu antes de falar.</summary>
    public static string PlanningBlock(ToolIntent intent, ContextPlan plan, string? hint = null)
    {
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
