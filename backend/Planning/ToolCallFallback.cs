using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LocalAi.Api.Llm;

namespace LocalAi.Api.Planning;

/// <summary>
/// Rede de segurança do ciclo de ferramentas: às vezes o modelo de 4B escreve a chamada como TEXTO ({"name": "...", "arguments": {...}},
/// com ou sem cerca ```json ou <tool_call>) em vez de usar tool_calls. Aqui o JSON é reconhecido, validado contra as ferramentas
/// REGISTRADAS nesta rodada e vira uma chamada de verdade; o JSON cru nunca chega ao usuário.
/// </summary>
public static partial class ToolCallFallback
{
    [GeneratedRegex("^\\{\\s*\"(?:name|tool_name|tool|function)\"\\s*:")]
    private static partial Regex BraceStart();

    [GeneratedRegex("^```(?:json|tool_call|tool)?\\s*\\{\\s*\"(?:name|tool_name|tool|function)\"\\s*:")]
    private static partial Regex FenceStart();

    /// <summary>Nome registrado para o que o modelo escreveu: exato, ou único pelo sufixo (browser_get_dom casa com browser__browser_get_dom).</summary>
    public static string? ResolveName(string? written, IReadOnlyCollection<string> registered)
    {
        var name = (written ?? "").Trim();
        if (name.Length == 0) return null;
        if (registered.Contains(name)) return name;
        var bySuffix = registered.Where(r => r.EndsWith("__" + name, StringComparison.Ordinal)).ToList();
        return bySuffix.Count == 1 ? bySuffix[0] : null;
    }

    /// <summary>
    /// Procura chamadas de ferramenta escritas como JSON dentro do texto. Devolve as chamadas válidas (só nomes registrados)
    /// e o texto restante, sem os blocos (nem as cercas ``` ou <tool_call> que os envolviam).
    /// </summary>
    public static List<ToolCall> Extract(string text, IReadOnlyCollection<string> registered, out string remainder)
    {
        var calls = new List<ToolCall>();
        var keep = new StringBuilder();
        var i = 0;
        while (i < text.Length)
        {
            if (text[i] != '{') { keep.Append(text[i]); i++; continue; }
            var end = BalancedEnd(text, i);
            if (end < 0) { keep.Append(text[i]); i++; continue; }
            var json = text[i..(end + 1)];
            if (TryCall(json, registered) is { } call) { calls.Add(call); i = end + 1; continue; }
            keep.Append(json);
            i = end + 1;
        }
        remainder = calls.Count == 0 ? text : StripWrappers(keep.ToString());
        return calls;
    }

    private static string StripWrappers(string text)
    {
        var t = Regex.Replace(text, @"</?tool_call>", "", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"```(?:json|tool_call|tool)?\s*```", "");
        t = Regex.Replace(t, @"^\s*```(?:json|tool_call|tool)?\s*$", "", RegexOptions.Multiline);
        t = Regex.Replace(t, @"^[\s\[\],]*$", "");
        return t.Trim();
    }

    /// <summary>Índice da chave que fecha o objeto aberto em <paramref name="start"/>, respeitando strings e escapes. -1 se não fecha.</summary>
    private static int BalancedEnd(string text, int start)
    {
        var depth = 0;
        var inString = false;
        for (var i = start; i < text.Length; i++)
        {
            var c = text[i];
            if (inString)
            {
                if (c == '\\') i++;
                else if (c == '"') inString = false;
                continue;
            }
            if (c == '"') inString = true;
            else if (c == '{') depth++;
            else if (c == '}' && --depth == 0) return i;
        }
        return -1;
    }

    private static ToolCall? TryCall(string json, IReadOnlyCollection<string> registered)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            // {"function": {"name": "...", "arguments": {...}}}
            if (root.TryGetProperty("function", out var fn) && fn.ValueKind == JsonValueKind.Object) root = fn;
            string? written = null;
            foreach (var key in new[] { "name", "tool_name", "tool", "function" })
                if (root.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String) { written = v.GetString(); break; }
            var name = ResolveName(written, registered);
            if (name is null) return null;
            JsonElement args = default;
            var found = false;
            foreach (var key in new[] { "arguments", "parameters", "args", "input" })
                if (root.TryGetProperty(key, out args)) { found = true; break; }
            if (!found) return new ToolCall(name, JsonDocument.Parse("{}").RootElement.Clone());
            if (args.ValueKind == JsonValueKind.String)
            {
                // alguns modelos mandam os argumentos como texto JSON
                try { return new ToolCall(name, JsonDocument.Parse(args.GetString() ?? "{}").RootElement.Clone()); }
                catch (JsonException) { return null; }
            }
            return args.ValueKind == JsonValueKind.Object ? new ToolCall(name, args.Clone()) : null;
        }
        catch (JsonException) { return null; }
    }

    private enum Verdict { Yes, No, Undecided }

    private static Verdict Classify(string fromMarker)
    {
        if (fromMarker.StartsWith("<tool_call>", StringComparison.OrdinalIgnoreCase)) return Verdict.Yes;
        if (fromMarker.StartsWith('{'))
        {
            if (BraceStart().IsMatch(fromMarker)) return Verdict.Yes;
            return fromMarker.Length < 24 ? Verdict.Undecided : Verdict.No;
        }
        if (fromMarker.StartsWith("```"))
        {
            if (FenceStart().IsMatch(fromMarker)) return Verdict.Yes;
            return fromMarker.Length < 34 ? Verdict.Undecided : Verdict.No;
        }
        return Verdict.No;
    }

    private static int NextMarker(string text, int from)
    {
        var best = -1;
        foreach (var marker in new[] { "{", "```", "<tool_call>" })
        {
            var idx = text.IndexOf(marker, from, StringComparison.OrdinalIgnoreCase);
            if (idx >= 0 && (best < 0 || idx < best)) best = idx;
        }
        return best;
    }

    /// <summary>
    /// Filtro do stream de uma rodada. <see cref="Push"/> devolve o texto que já pode ir ao usuário; um bloco que parece chamada de
    /// ferramenta fica retido até o fim da resposta, quando <see cref="Finish"/> decide: vira chamada (e some do texto) ou é devolvido como texto.
    /// Sem ferramentas registradas o filtro não retém nada.
    /// </summary>
    public sealed class Sniffer(IReadOnlyCollection<string> registered)
    {
        private readonly StringBuilder _pending = new();
        private bool _holding;

        public string Push(string chunk)
        {
            if (registered.Count == 0 || string.IsNullOrEmpty(chunk)) return chunk ?? "";
            _pending.Append(chunk);
            var emit = new StringBuilder();
            while (_pending.Length > 0 && !_holding)
            {
                var text = _pending.ToString();
                var i = NextMarker(text, 0);
                if (i < 0)
                {
                    // um pedaço de marcador no fim ("`", "``", "<tool") pode ser o começo de um bloco: espera o próximo trecho
                    var keep = PartialMarkerLength(text);
                    emit.Append(text, 0, text.Length - keep);
                    _pending.Remove(0, text.Length - keep);
                    break;
                }
                emit.Append(text, 0, i);
                _pending.Remove(0, i);
                var verdict = Classify(_pending.ToString());
                if (verdict == Verdict.Undecided) break;
                if (verdict == Verdict.Yes) { _holding = true; break; }
                // não é chamada: libera o primeiro caractere do marcador e segue procurando
                emit.Append(_pending[0]);
                _pending.Remove(0, 1);
            }
            return emit.ToString();
        }

        private static int PartialMarkerLength(string text)
        {
            foreach (var marker in new[] { "```", "<tool_call>" })
                for (var len = Math.Min(marker.Length - 1, text.Length); len > 0; len--)
                    if (text.EndsWith(marker[..len], StringComparison.OrdinalIgnoreCase)) return len;
            return 0;
        }

        /// <param name="alreadyHasCalls">O Ollama já devolveu tool_calls de verdade: o JSON retido é duplicata e some.</param>
        /// <returns>Texto restante a emitir e as chamadas reconhecidas no texto.</returns>
        public (string Text, List<ToolCall> Calls) Finish(bool alreadyHasCalls)
        {
            var held = _pending.ToString();
            _pending.Clear();
            _holding = false;
            if (held.Length == 0) return ("", []);
            var calls = Extract(held, registered, out var rest);
            if (calls.Count == 0) return (held, []); // era só texto parecido com JSON: devolve como estava
            return (rest, alreadyHasCalls ? [] : calls);
        }
    }
}
