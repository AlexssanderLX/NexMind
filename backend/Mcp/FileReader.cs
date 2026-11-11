using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace LocalAi.Api.Mcp;

public sealed class McpServerConfig
{
    public string Command { get; set; } = "";
    public string[] Args { get; set; } = [];
}

public sealed record FileText(string Name, string Text, int Chars, bool Truncated);

/// <summary>
/// Lê arquivos enviados pelo usuário usando o MCP pronto "markitdown" (PDF, DOCX, PPTX, XLSX, HTML, texto...).
/// O arquivo vai para uma pasta temporária, o MCP converte para Markdown e o temporário é apagado.
/// </summary>
public sealed class FileReader
{
    private readonly McpServerConfig _cfg;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private McpClient? _mcp;
    private readonly string _tmp;
    private static readonly HashSet<string> Plain = new(StringComparer.OrdinalIgnoreCase)
        { ".txt", ".md", ".markdown", ".log", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env" };

    public FileReader(McpServerConfig cfg, string dataDir)
    {
        _cfg = cfg;
        _tmp = Path.Combine(dataDir, "uploads");
    }

    public const long MaxBytes = 25 * 1024 * 1024;

    public async Task<FileText> ReadAsync(IFormFile file, int maxChars, CancellationToken ct)
    {
        var name = Path.GetFileName(file.FileName);
        var ext = Path.GetExtension(name);
        string text;

        if (Plain.Contains(ext) || IsCodeOrText(ext))
        {
            // texto puro não precisa de conversão
            using var sr = new StreamReader(file.OpenReadStream(), System.Text.Encoding.UTF8, true);
            text = await sr.ReadToEndAsync(ct);
        }
        else
        {
            Directory.CreateDirectory(_tmp);
            var path = Path.Combine(_tmp, $"{Guid.NewGuid():N}{ext}");
            try
            {
                await using (var fs = File.Create(path)) await file.CopyToAsync(fs, ct);
                text = await ConvertAsync(new Uri(path).AbsoluteUri, ct);
            }
            finally { try { File.Delete(path); } catch { /* limpeza best-effort */ } }
        }

        text = text.Replace("\r\n", "\n").Trim('﻿', '\n', ' ');
        var truncated = text.Length > maxChars;
        if (truncated) text = text[..maxChars];
        return new FileText(name, text, text.Length, truncated);
    }

    /// <summary>Chama a ferramenta convert_to_markdown do MCP (SDK oficial), subindo o servidor sob demanda.</summary>
    private async Task<string> ConvertAsync(string uri, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(90));
            try
            {
                _mcp ??= await McpClient.CreateAsync(new StdioClientTransport(new StdioClientTransportOptions
                {
                    Name = "markitdown",
                    Command = _cfg.Command,
                    Arguments = _cfg.Args,
                    EnvironmentVariables = new Dictionary<string, string?> { ["PYTHONUTF8"] = "1" },
                }), cancellationToken: cts.Token);
                var res = await _mcp.CallToolAsync("convert_to_markdown",
                    new Dictionary<string, object?> { ["uri"] = uri }, cancellationToken: cts.Token);
                var text = string.Concat(res.Content.OfType<TextContentBlock>().Select(b => b.Text));
                if (res.IsError == true) throw new InvalidOperationException(text.Length > 0 ? text : "Erro ao converter.");
                return text;
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                await ResetAsync();
                throw new TimeoutException("O servidor MCP demorou demais.");
            }
            catch (Exception ex) when (ex is not OperationCanceledException and not InvalidOperationException)
            {
                await ResetAsync(); // servidor caiu: a próxima chamada sobe um novo
                throw new InvalidOperationException(ex.Message, ex);
            }
        }
        finally { _gate.Release(); }
    }

    private async Task ResetAsync()
    {
        var c = _mcp; _mcp = null;
        if (c is not null) try { await c.DisposeAsync(); } catch { /* já caiu */ }
    }

    // extensões de código/texto comuns: lidas direto
    private static bool IsCodeOrText(string ext) => ext.ToLowerInvariant() is
        ".cs" or ".py" or ".js" or ".ts" or ".tsx" or ".jsx" or ".java" or ".go" or ".rs" or ".c" or ".h" or ".cpp"
        or ".hpp" or ".php" or ".rb" or ".sh" or ".ps1" or ".bat" or ".sql" or ".css" or ".scss" or ".xml" or ".csv"
        or ".tsv" or ".vue" or ".svelte" or ".kt" or ".swift" or ".lua" or ".r" or ".tf" or ".dockerfile" or ".gitignore";
}
