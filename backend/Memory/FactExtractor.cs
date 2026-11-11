using System.Text.Json;
using System.Text.RegularExpressions;

namespace LocalAi.Api.Memory;

/// <summary>
/// Motor de fatos: transforma o retorno de uma ferramenta que deu certo numa linha curta para facts.md.
/// Só regras sobre o que a própria ferramenta devolveu: nenhum modelo é chamado.
/// </summary>
public static partial class FactExtractor
{
    [GeneratedRegex(@"^Aba \[\d+\] (\S+)")]
    private static partial Regex DomHeader();

    /// <param name="toolName">Nome da ferramenta sem o prefixo do servidor (ex.: browser_navigate).</param>
    public static string? Extract(string toolName, JsonElement args, string resultText)
    {
        switch (toolName)
        {
            case "browser_navigate":
            case "browser_reuse_tab":
                return Arg(args, "url") is { Length: > 0 } url ? $"Aba aberta: {url}" : null;
            case "browser_get_dom":
                var m = DomHeader().Match(resultText ?? "");
                return m.Success ? $"Página lida: {m.Groups[1].Value}" : null;
            case "read_text_file":
                return Arg(args, "path") is { Length: > 0 } read ? $"Arquivo lido: {read}" : null;
            case "write_file":
                return Arg(args, "path") is { Length: > 0 } written ? $"Arquivo gravado: {written}" : null;
            case "edit_file":
                return Arg(args, "path") is { Length: > 0 } edited ? $"Arquivo editado: {edited}" : null;
            default:
                return null;
        }
    }

    private static string? Arg(JsonElement args, string key)
    {
        if (args.ValueKind != JsonValueKind.Object) return null;
        foreach (var p in args.EnumerateObject())
            if (string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase) && p.Value.ValueKind == JsonValueKind.String)
                return p.Value.GetString();
        return null;
    }
}
