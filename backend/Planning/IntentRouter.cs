using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace LocalAi.Api.Planning;

/// <summary>Quais ferramentas esta mensagem pede. Tudo começa DESLIGADO: só a intenção da frase (ou um interruptor do usuário) liga.</summary>
public sealed record ToolIntent(bool Files, bool Browser, bool Desktop, bool Notebook, bool Rag)
{
    public bool AnyMcp => Files || Browser || Desktop;
    public bool Any => AnyMcp || Notebook || Rag;

    /// <summary>Nomes para mostrar no planejamento ("Navegador, Caderno"), ou "nenhuma".</summary>
    public string Describe()
    {
        var names = new List<string>();
        if (Browser) names.Add("Navegador");
        if (Files) names.Add("Arquivos");
        if (Desktop) names.Add("Computador");
        if (Notebook) names.Add("Caderno");
        if (Rag) names.Add("Arquivos da conversa");
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
    [GeneratedRegex(@"https?://|\bwww\.|\bnavegador\b|\babas?\b|\bsites?\b|\bpaginas?\b|\bgithub\b|\bgmail\b|\blinkedin\b|\burl\b|\bchrome\b|\bendpoints?\b|\brecon\b|\bformularios?\b|\bdom\b")]
    private static partial Regex BrowserWords();

    // Pesquisa na web liga pela frase, sem interruptor: "pesquise na internet", "busque no google", "notícias de hoje".
    [GeneratedRegex(@"\b(pesquis(a|e|ar)|busc(a|ar)|busque|procur(a|e|ar))\b.{0,40}\b(na (web|internet)|no google|online)\b|\bpesquisa na web\b|\bnoticias\b|\bna internet\b")]
    private static partial Regex SearchWords();

    /// <summary>A frase pede uma pesquisa na web? O texto dos anexos não conta.</summary>
    public static bool WantsSearch(string userText) =>
        SearchWords().IsMatch(Normalize(Regex.Replace(userText ?? "", @"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]", " ")));

    [GeneratedRegex(@"\barquivos?\b|\bpastas?\b|\bdiretorios?\b|\bdiretorio\b|\.(cs|ts|tsx|js|json|md|txt|py|ps1|yaml|yml|csv|pdf|docx|html|css)\b|\b[a-z]:[\\/]")]
    private static partial Regex FileWords();

    [GeneratedRegex(@"\bcomputador\b|\bjanelas?\b|\bcalculadora\b|\bbloco de notas\b|\bnotepad\b|\baplicativos?\b|\bprogramas? aberto\b|\bmouse\b|\bteclado\b")]
    private static partial Regex DesktopWords();

    [GeneratedRegex(@"\banot(e|a|ar|ado|ou|amos)\b|\bcaderno\b|\bscratchpad\b|\bhipoteses?\b|\blembr(e|ar|a)\b|\bmemoria\b|\bo que (eu|voce|a gente|nos) (anotou|anotamos|combinamos)\b")]
    private static partial Regex NotebookWords();

    // Micro-RAG: a frase aponta para um arquivo já indexado na conversa, não para um caminho do PC.
    [GeneratedRegex(@"\bno logs?\b|\bnos logs?\b|\bno arquivos?\b|\bnos arquivos?\b|\bno prints?\b|\bprocure no documento\b|\bno documentos?\b|\bnos documentos?\b")]
    private static partial Regex RagWords();

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
    /// <param name="hasRagFiles">A conversa já tem arquivo fatiado no Micro-RAG.</param>
    public static ToolIntent Route(string userText, bool forceFiles, bool forceBrowser, bool forceDesktop, bool hasNotes, bool hasRagFiles = false)
    {
        // o texto dos anexos não conta: um PDF que cita "site" não é um pedido de navegador
        var plain = Normalize(Regex.Replace(userText ?? "", @"\[\[ARQUIVO [^\]]*\]\][\s\S]*?\[\[/ARQUIVO\]\]", " "));
        return new ToolIntent(
            Files: forceFiles || FileWords().IsMatch(plain),
            Browser: forceBrowser || BrowserWords().IsMatch(plain),
            Desktop: forceDesktop || DesktopWords().IsMatch(plain),
            Notebook: NotebookWords().IsMatch(plain) || hasNotes,
            Rag: hasRagFiles || RagWords().IsMatch(plain));
    }
}
