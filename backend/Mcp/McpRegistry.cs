using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace LocalAi.Api.Mcp;

/// <summary>Um servidor MCP de mcp_servers.json. RequiresApproval: nomes de ferramentas (ou "*"); ausente = tudo pede aprovação.</summary>
public sealed class McpServerEntry
{
    public string Command { get; set; } = "";
    public string[] Args { get; set; } = [];
    public bool Enabled { get; set; } = true;
    public string[]? RequiresApproval { get; set; }
    /// <summary>Pastas onde ferramentas que escrevem podem agir (relativas à pasta do backend ou absolutas). Leitura não é limitada por aqui.</summary>
    public string[]? WritableRoots { get; set; }
    /// <summary>Se definida, só estas ferramentas do servidor são enviadas ao modelo (menos tokens no prompt e menos confusão do modelo de 4B).</summary>
    public string[]? AllowedTools { get; set; }
    /// <summary>Trechos de caminho que nunca podem ser lidos nem escritos (chaves, credenciais, perfis de navegador...).</summary>
    public string[]? BlockedPaths { get; set; }
}

public sealed class McpServersFile
{
    public Dictionary<string, McpServerEntry> McpServers { get; set; } = new();
}

/// <summary>Ferramenta descoberta num servidor MCP, no formato que o Nex usa (e envia ao Ollama).</summary>
public sealed record NexTool(string Server, string Name, string Description, JsonElement Schema, bool RequiresApproval, bool IsWrite)
{
    /// <summary>Nome exposto ao modelo: servidor__ferramenta (evita colisão entre servidores).</summary>
    public string QualifiedName => $"{Server}__{Name}";
}

public sealed record ToolResult(bool Ok, string Text);

/// <summary>
/// Host de MCP: sobe os servidores listados em mcp_servers.json (stdio, JSON-RPC 2.0 pelo SDK oficial), descobre as
/// ferramentas e as executa com timeout. Falha de um servidor nunca derruba a API: vira erro estruturado.
/// </summary>
public sealed class McpRegistry : IAsyncDisposable
{
    public static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(30);

    private readonly string _configPath;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, McpClient> _clients = new();
    private List<NexTool>? _tools;

    public McpRegistry(string configPath) => _configPath = configPath;

    private McpServersFile LoadConfig()
    {
        try
        {
            if (!File.Exists(_configPath)) return new();
            return JsonSerializer.Deserialize<McpServersFile>(File.ReadAllText(_configPath),
                       new JsonSerializerOptions(JsonSerializerDefaults.Web) { ReadCommentHandling = JsonCommentHandling.Skip }) ?? new();
        }
        catch (Exception ex) when (ex is JsonException or IOException) { return new(); }
    }

    private static bool Matches(string[]? list, string tool) =>
        list is not null && list.Any(p => p == "*" || string.Equals(p, tool, StringComparison.OrdinalIgnoreCase));

    private async Task<McpClient> ClientAsync(string server, McpServerEntry cfg, CancellationToken ct)
    {
        if (_clients.TryGetValue(server, out var c)) return c;
        c = await McpClient.CreateAsync(new StdioClientTransport(new StdioClientTransportOptions
        {
            Name = server,
            Command = cfg.Command,
            Arguments = cfg.Args,
            EnvironmentVariables = new Dictionary<string, string?> { ["PYTHONUTF8"] = "1" },
        }), cancellationToken: ct);
        _clients[server] = c;
        return c;
    }

    private async Task DropAsync(string server)
    {
        if (_clients.Remove(server, out var c)) try { await c.DisposeAsync(); } catch { /* já caiu */ }
    }

    /// <summary>Lista as ferramentas de todos os servidores ligados (em cache; use refresh para redescobrir).</summary>
    public async Task<IReadOnlyList<NexTool>> GetToolsAsync(bool refresh, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_tools is not null && !refresh) return _tools;
            var found = new List<NexTool>();
            foreach (var (name, cfg) in LoadConfig().McpServers)
            {
                if (!cfg.Enabled || string.IsNullOrWhiteSpace(cfg.Command)) continue;
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(CallTimeout);
                try
                {
                    var client = await ClientAsync(name, cfg, cts.Token);
                    foreach (var t in await client.ListToolsAsync(cancellationToken: cts.Token))
                    {
                        if (cfg.AllowedTools is { Length: > 0 } allow && !allow.Contains(t.Name, StringComparer.OrdinalIgnoreCase)) continue;
                        var p = t.ProtocolTool;
                        // aprova se está na lista do arquivo, se o servidor marca como destrutiva, ou se o arquivo não definiu lista
                        var needs = cfg.RequiresApproval is null || Matches(cfg.RequiresApproval, t.Name)
                                    || p.Annotations?.DestructiveHint == true;
                        found.Add(new NexTool(name, t.Name, t.Description ?? "", p.InputSchema, needs, IsWrite: needs));
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
                {
                    await DropAsync(name); // servidor indisponível: segue sem ele
                }
            }
            return _tools = found;
        }
        finally { _gate.Release(); }
    }

    private static readonly HashSet<string> PathArgNames = new(StringComparer.OrdinalIgnoreCase)
        { "path", "paths", "source", "destination", "directory", "dir", "file", "files", "filepath", "root" };

    private static void CollectPaths(JsonElement args, List<string> into)
    {
        if (args.ValueKind != JsonValueKind.Object) return;
        foreach (var prop in args.EnumerateObject())
        {
            if (!PathArgNames.Contains(prop.Name)) continue;
            if (prop.Value.ValueKind == JsonValueKind.String && prop.Value.GetString() is { } one) into.Add(one);
            else if (prop.Value.ValueKind == JsonValueKind.Array)
                foreach (var item in prop.Value.EnumerateArray())
                    if (item.ValueKind == JsonValueKind.String && item.GetString() is { } s) into.Add(s);
        }
    }

    private string Resolve(string raw) =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(_configPath)!, raw.Replace('/', '\\')));

    private static bool IsUnder(string path, string root) =>
        (path.TrimEnd('\\') + "\\").StartsWith(root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Avalia o risco de uma chamada ANTES de pedir aprovação. Nada é proibido: caminho sensível ou escrita fora da pasta de
    /// trabalho viram um AVISO com as consequências, mostrado no card de aprovação (e a chamada passa a exigir aprovação).
    /// Devolve null quando não há nada de especial a avisar.
    /// </summary>
    public string? Assess(NexTool tool, JsonElement arguments)
    {
        if (!LoadConfig().McpServers.TryGetValue(tool.Server, out var cfg)) return null;
        var paths = new List<string>();
        CollectPaths(arguments, paths);
        var notes = new List<string>();
        foreach (var raw in paths)
        {
            string full;
            try { full = Resolve(raw); } catch (Exception ex) when (ex is ArgumentException or NotSupportedException) { continue; }
            foreach (var b in cfg.BlockedPaths ?? [])
                if (full.Contains(b.Replace('/', '\\'), StringComparison.OrdinalIgnoreCase))
                {
                    notes.Add($"Área sensível ({b}): pode conter chaves, senhas ou dados pessoais. " +
                              (tool.IsWrite ? "Alterar isso pode quebrar acessos ou apagar credenciais, sem como desfazer."
                                            : "O conteúdo lido vai para o modelo e fica salvo no histórico desta conversa."));
                    break;
                }
            if (tool.IsWrite && cfg.WritableRoots is { Length: > 0 } roots && !roots.Any(r => IsUnder(full, Resolve(r))))
                notes.Add($"Fica FORA da pasta de trabalho do Nex ({roots[0]}): se o arquivo já existir, o conteúdo atual será substituído e não dá para desfazer.");
        }
        return notes.Count == 0 ? null : string.Join(" ", notes.Distinct());
    }

    /// <param name="maxChars">Teto da saída devolvida ao modelo: saída longa estoura o contexto.</param>
    public async Task<ToolResult> CallAsync(NexTool tool, JsonElement arguments, int maxChars, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (!LoadConfig().McpServers.TryGetValue(tool.Server, out var cfg))
                return new(false, $"Servidor MCP '{tool.Server}' não está mais configurado.");
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(CallTimeout);
            try
            {
                var client = await ClientAsync(tool.Server, cfg, cts.Token);
                var args = new Dictionary<string, object?>();
                if (arguments.ValueKind == JsonValueKind.Object)
                    foreach (var prop in arguments.EnumerateObject()) args[prop.Name] = prop.Value.Clone();
                var res = await client.CallToolAsync(tool.Name, args, cancellationToken: cts.Token);
                var text = string.Concat(res.Content.OfType<TextContentBlock>().Select(b => b.Text));
                if (text.Length > maxChars) text = text[..maxChars] + "\n[…saída cortada para caber no contexto: peça só um trecho (head/tail) ou busque antes]";
                return new(res.IsError != true, text.Length > 0 ? text : "(sem saída)");
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                await DropAsync(tool.Server);
                return new(false, $"A ferramenta {tool.Name} excedeu {CallTimeout.TotalSeconds:0}s e foi cancelada.");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await DropAsync(tool.Server); // processo caiu: a próxima chamada sobe outro
                return new(false, $"Falha ao executar {tool.Name}: {ex.Message}");
            }
        }
        finally { _gate.Release(); }
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var s in _clients.Keys.ToList()) await DropAsync(s);
    }
}
