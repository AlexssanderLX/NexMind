using System.Text;
using System.Text.RegularExpressions;

namespace LocalAi.Api.Rag.Digest;

/// <summary>
/// Lê texto e log em streaming e corta em blocos de até 800 caracteres, com 100 de sobreposição.
/// Cada bloco guarda o intervalo de linhas de origem (L12-L40).
/// </summary>
public static partial class TextAndLogDigest
{
    public const int MaxChars = 800;
    public const int Overlap = 100;

    [GeneratedRegex(@"\b(ERROR|WARN|FATAL)\b|\b500\b|^\s*at\s+\S+", RegexOptions.Multiline | RegexOptions.Compiled)]
    private static partial Regex LogSignal();

    [GeneratedRegex(@"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}|\d{2}/\d{2}/\d{4}[ T]\d{2}:\d{2}", RegexOptions.Compiled)]
    private static partial Regex Timestamp();

    public static async Task<(string Type, string Summary, List<RagChunk> Chunks)> ReadAsync(
        Stream stream, string fileId, string fileName, CancellationToken ct = default)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 65536, leaveOpen: true);
        var text = await reader.ReadToEndAsync(ct);
        return FromText(text, fileId, fileName);
    }

    public static (string Type, string Summary, List<RagChunk> Chunks) FromText(string text, string fileId, string fileName)
    {
        text = text.Replace("\r\n", "\n").Replace('\r', '\n');
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        var sample = text.Length > 8192 ? text[..8192] : text;
        var isLog = ext is ".log" or ".evt" || LogSignal().IsMatch(sample) || Timestamp().IsMatch(sample);
        var type = isLog ? "log" : CodeExtensions.Contains(ext) ? "code" : "text";

        var lineStarts = new List<int> { 0 };
        for (var i = 0; i < text.Length; i++)
            if (text[i] == '\n' && i + 1 <= text.Length) lineStarts.Add(i + 1);

        int LineAt(int offset)
        {
            var lo = 0;
            var hi = lineStarts.Count - 1;
            while (lo < hi)
            {
                var mid = (lo + hi + 1) / 2;
                if (lineStarts[mid] <= offset) lo = mid;
                else hi = mid - 1;
            }
            return lo + 1;
        }

        var chunks = new List<RagChunk>();
        for (var start = 0; start < text.Length && chunks.Count < 100_000;)
        {
            var len = Math.Min(MaxChars, text.Length - start);
            var end = start + len;
            if (end < text.Length)
            {
                var nl = text.LastIndexOf('\n', end - 1, len);
                if (nl > start + Overlap) end = nl + 1;
            }
            var slice = text[start..end].Trim();
            if (slice.Length > 0)
            {
                var from = LineAt(start);
                var to = LineAt(Math.Max(start, end - 1));
                chunks.Add(new RagChunk(chunks.Count, fileId, slice, from == to ? $"L{from}" : $"L{from}-L{to}", Math.Max(1, slice.Length / 4)));
            }
            if (end >= text.Length) break;
            var next = end - Overlap;
            if (next <= start) next = end;
            start = next;
        }

        var summary = SummaryOf(text, isLog);
        return (type, summary, chunks);
    }

    private static string SummaryOf(string text, bool isLog)
    {
        var errors = isLog ? CountSignals(text) : 0;
        var head = text.Trim();
        if (head.Length > 240) head = head[..240].Trim() + "…";
        head = head.Replace('\n', ' ');
        return isLog ? $"{errors} sinais de log. {head}" : head;
    }

    private static int CountSignals(string text)
    {
        var n = 0;
        foreach (var word in new[] { "ERROR", "WARN", "FATAL", "500" })
        {
            var at = 0;
            while ((at = text.IndexOf(word, at, StringComparison.Ordinal)) >= 0)
            {
                n++;
                at += word.Length;
            }
        }
        return n;
    }

    private static readonly HashSet<string> CodeExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".cs", ".ts", ".tsx", ".js", ".jsx", ".py", ".json", ".xml", ".yml", ".yaml", ".html", ".css", ".sql", ".go", ".rs", ".java"
    };
}
