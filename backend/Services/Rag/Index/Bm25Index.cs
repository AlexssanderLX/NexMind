namespace LocalAi.Api.Rag.Index;

/// <summary>BM25 em memória, sem biblioteca externa. k1 = 1.2, b = 0.75.</summary>
public sealed class Bm25Index
{
    private const double K1 = 1.2;
    private const double B = 0.75;

    private sealed class Doc
    {
        public int Index;
        public string Location = "";
        public string Content = "";
        public Dictionary<string, int> Tf = new();
        public int Length;
    }

    private readonly object _gate = new();
    private readonly Dictionary<string, List<Doc>> _docs = new();
    private readonly Dictionary<string, Dictionary<string, int>> _df = new();

    public void Add(string fileId, IReadOnlyList<RagChunk> chunks)
    {
        var docs = new List<Doc>(chunks.Count);
        var df = new Dictionary<string, int>();
        foreach (var chunk in chunks)
        {
            var tf = TermFreq(chunk.Content);
            docs.Add(new Doc { Index = chunk.Index, Location = chunk.Location, Content = chunk.Content, Tf = tf, Length = tf.Values.Sum() });
            foreach (var term in tf.Keys)
                df[term] = df.GetValueOrDefault(term) + 1;
        }
        lock (_gate)
        {
            _docs[fileId] = docs;
            _df[fileId] = df;
        }
    }

    public void Drop(string fileId)
    {
        lock (_gate)
        {
            _docs.Remove(fileId);
            _df.Remove(fileId);
        }
    }

    public List<RagSearchResult> Search(string fileId, string query, int topK = 3)
    {
        List<Doc>? docs;
        Dictionary<string, int>? df;
        lock (_gate)
        {
            if (!_docs.TryGetValue(fileId, out docs) || !_df.TryGetValue(fileId, out df))
                return new List<RagSearchResult>();
            docs = docs.ToList();
            df = new Dictionary<string, int>(df);
        }
        if (docs.Count == 0) return new List<RagSearchResult>();

        var q = Tokenize(query).Distinct().ToList();
        if (q.Count == 0) return new List<RagSearchResult>();
        var avg = docs.Average(d => d.Length);
        if (avg <= 0) avg = 1;
        var n = docs.Count;
        var ranked = new List<RagSearchResult>(docs.Count);
        foreach (var doc in docs)
        {
            double score = 0;
            foreach (var term in q)
            {
                var tf = doc.Tf.GetValueOrDefault(term);
                if (tf == 0 && term.Length >= 5 && doc.Content.Contains(term, StringComparison.OrdinalIgnoreCase)) tf = 1;
                if (tf == 0) continue;
                var docsWith = df.GetValueOrDefault(term);
                var idf = Math.Log(1 + (n - docsWith + 0.5) / (docsWith + 0.5));
                var denom = tf + K1 * (1 - B + B * doc.Length / avg);
                score += idf * (tf * (K1 + 1)) / denom;
            }
            if (score <= 0) continue;
            ranked.Add(new RagSearchResult(doc.Index, doc.Location, Snippet(doc.Content, q), score));
        }
        return ranked.OrderByDescending(r => r.Score).Take(Math.Max(1, topK)).ToList();
    }

    public static List<string> Tokenize(string text)
    {
        var tokens = new List<string>();
        var start = -1;
        for (var i = 0; i <= text.Length; i++)
        {
            var letter = i < text.Length && char.IsLetterOrDigit(text[i]);
            if (letter && start < 0) start = i;
            if (!letter && start >= 0)
            {
                if (i - start >= 2)
                {
                    var token = text[start..i].ToLowerInvariant();
                    if (token is "erro" or "error" or "errors") token = "error";
                    tokens.Add(token);
                }
                start = -1;
            }
        }
        return tokens;
    }

    private static Dictionary<string, int> TermFreq(string text)
    {
        var tf = new Dictionary<string, int>();
        foreach (var token in Tokenize(text))
            tf[token] = tf.GetValueOrDefault(token) + 1;
        return tf;
    }

    private static string Snippet(string content, List<string> query)
    {
        var lower = content.ToLowerInvariant();
        var at = -1;
        foreach (var term in query)
        {
            at = lower.IndexOf(term, StringComparison.Ordinal);
            if (at >= 0) break;
        }
        if (at < 0) at = 0;
        var from = Math.Max(0, at - 60);
        var to = Math.Min(content.Length, from + 180);
        var slice = content[from..to].Replace('\n', ' ');
        return (from > 0 ? "…" : "") + slice + (to < content.Length ? "…" : "");
    }
}
