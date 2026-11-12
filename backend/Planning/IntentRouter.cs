using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace LocalAi.Api.Planning;

/// <summary>Quais ferramentas esta mensagem pede. Tudo começa DESLIGADO: só a intenção da frase (ou um interruptor do usuário) liga.</summary>
public sealed record ToolIntent(bool Files, bool Browser, bool Desktop, bool Notebook)
{
    public bool AnyMcp => Files || Browser || Desktop;
    public bool Any => AnyMcp || Notebook;

    /// <summary>Nomes para mostrar no planejamento ("Navegador, Caderno"), ou "nenhuma".</summary>
    public string Describe()
    {
        var names = new List<string>();
        if (Browser) names.Add("Navegador");
        if (Files) names.Add("Arquivos");
        if (Desktop) names.Add("Computador");
        if (Notebook) names.Add("Caderno");
        return names.Count == 0 ? "nenhuma" : string.Join(", ", names);
    }
}

/// <summary>
/// Decide, pela frase, quais ferramentas injetar no prompt. Cada ferramenta injetada custa tokens (as descrições pesam
/// de 300 a 800 caracteres cada) e contexto, e o Qwen3 4B só fica a ~41 tok/s com tudo na GPU, então conversa direta
/// ("Bom dia Nex") não leva nenhuma. Funções puras: sem relógio, sem rede.
/// </summary>
public static partial class IntentRouter
{
    // Palavras inteiras, sem acento e em minúsculas (o texto é normalizado antes). \b evita casar "aba" dentro de "abacaxi".
    [GeneratedRegex(@"https?://|\bwww\.|\bnavegador\b|\babas?\b|\bsites?\b|\bpaginas?\b|\bgithub\b|\bgmail\b|\blinkedin\b|\burl\b|\bchrome\b")]
    private static partial Regex BrowserWords();

    [GeneratedRegex(@"\barquivos?\b|\bpastas?\b|\bdiretorios?\b|\bdiretorio\b|\.(cs|ts|tsx|js|json|md|txt|py|ps1|yaml|yml|csv|pdf|docx|html|css)\b|\b[a-z]:[\\/]")]
    private static partial Regex FileWords();

    [GeneratedRegex(@"\bcomputador\b|\bjanelas?\b|\bcalculadora\b|\bbloco de notas\b|\bnotepad\b|\baplicativos?\b|\bprogramas? aberto\b|\bmouse\b|\bteclado\b")]
    private static partial Regex DesktopWords();

    [GeneratedRegex(@"\banot(e|a|ar|ado|ou|amos)\b|\bcaderno\b|\bscratchpad\b|\bhipoteses?\b|\blembr(e|ar|a)\b|\bmemoria\b|\bo que (eu|voce|a gente|nos) (anotou|anotamos|combinamos)\b")]
    private static partial Regex NotebookWords();

    public static string Normalize(string text)
    {
        var decomposed = (text ?? "").ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }

    /// <param name="forceFiles">Interruptor "Arquivos do Nex" ligado pelo usuário.</param>
    /// <param name="forceBrowser">Interruptor "Navegador" ligado pelo usuário.</param>
    /// <param name="forceDesktop">Interruptor "Computador" ligado pelo usuário.</param>
    /// <param name="hasNotes">O caderno desta conversa já tem notas: o Nex precisa poder lê-las.</param>
    public static ToolIntent Route(string userText, bool forceFiles, bool forceBrowser, bool forceDesktop, bool hasNotes)
    {
        // o texto dos anexos não conta: um PDF que cita "site" não é um pedido de navegador
        var plain = Normalize(Regex.Replace(userText ?? "", @"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]", " "));
        return new ToolIntent(
            Files: forceFiles || FileWords().IsMatch(plain),
            Browser: forceBrowser || BrowserWords().IsMatch(plain),
            Desktop: forceDesktop || DesktopWords().IsMatch(plain),
            Notebook: NotebookWords().IsMatch(plain) || hasNotes);
    }
}
