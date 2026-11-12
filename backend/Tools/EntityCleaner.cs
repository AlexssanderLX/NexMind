using System.Text.RegularExpressions;

namespace LocalAi.Api.Tools;

/// <summary>Higieniza a entidade (pessoa ou domínio) que o Alexssander pediu em linguagem natural.</summary>
public static partial class EntityCleaner
{
    [GeneratedRegex(@"^(?:(?:para|pra)\s+(?:mim|min|me|nos)\b\s*(?:de|do|da|sobre)?|por\s+favor\b\s*(?:de|do|da|sobre)?|(?:de|do|da|dos|das|sobre|em|no|na|para|pra|mim|me)\b)\s*", RegexOptions.IgnoreCase)]
    private static partial Regex ColloquialPrefix();

    private static readonly char[] Edge = ['"', '\'', '.', '?', '!', ',', ';', ':', ' '];

    /// <summary>
    /// "para mim de Alexssander Ferreira de Almeida" vira "Alexssander Ferreira de Almeida". Tira prefixos coloquiais
    /// ("para mim de", "pra mim sobre", "por favor de", "de", "sobre"...) e a pontuação das pontas. Domínios passam intactos.
    /// Só o começo é limpo: o "de" no meio de um nome ("Ferreira de Almeida") fica.
    /// </summary>
    public static string Clean(string? raw)
    {
        var text = (raw ?? "").Trim().Trim(Edge);
        for (var i = 0; i < 5; i++)
        {
            var next = ColloquialPrefix().Replace(text, "", 1).Trim();
            if (next == text) break;
            text = next;
        }
        return text.Trim(Edge);
    }
}
