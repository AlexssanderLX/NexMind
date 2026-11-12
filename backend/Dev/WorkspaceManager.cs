using System.Diagnostics;
using System.Text;

namespace LocalAi.Api.Dev;

public sealed record DevNode(string Name, string Path, bool Directory, List<DevNode> Children);

/// <summary>
/// A pasta de engenharia aberta nesta sessão. Todo caminho de leitura, escrita e comando
/// é resolvido por baixo dela: nada sai da raiz.
/// </summary>
public sealed class WorkspaceManager
{
    private static readonly HashSet<string> SkipDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", "node_modules", "bin", "obj", ".vs"
    };

    private static readonly Dictionary<string, (string File, string Args)> Commands = new(StringComparer.OrdinalIgnoreCase)
    {
        ["dotnet build"] = ("dotnet", "build"),
        ["dotnet test"] = ("dotnet", "test"),
        ["npm test"] = ("npm", "test"),
        ["git status"] = ("git", "status --short"),
    };

    private readonly object _gate = new();
    private string? _root;

    public string? Root { get { lock (_gate) return _root; } }

    public string Open(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("Informe o caminho da pasta.");
        var full = Path.GetFullPath(path.Trim());
        if (!Directory.Exists(full)) throw new InvalidOperationException("Essa pasta não existe.");
        lock (_gate) _root = full;
        return full;
    }

    public List<DevNode> Tree()
    {
        var root = Require();
        var ignore = LoadIgnore(root);
        return Walk(root, root, ignore, 0);
    }

    public string Read(string relative)
    {
        var full = Resolve(relative);
        if (!File.Exists(full)) throw new InvalidOperationException("Arquivo não encontrado.");
        var info = new FileInfo(full);
        if (info.Length > 1_000_000) throw new InvalidOperationException("Arquivo grande demais para o editor (limite de 1 MB).");
        var text = File.ReadAllText(full);
        if (text.Contains('\0')) throw new InvalidOperationException("Esse arquivo não é texto.");
        return text;
    }

    public int Write(string relative, string content)
    {
        var full = Resolve(relative);
        var parent = Path.GetDirectoryName(full);
        if (parent is null || !Directory.Exists(parent)) throw new InvalidOperationException("A pasta desse arquivo não existe.");
        if (content.Length > 1_000_000) throw new InvalidOperationException("Conteúdo grande demais.");
        File.WriteAllText(full, content);
        return content.Length;
    }

    public async Task<(int Exit, string Output)> RunAsync(string command, CancellationToken ct)
    {
        if (!Commands.TryGetValue(command.Trim(), out var spec))
            throw new InvalidOperationException("Comando não permitido. Use dotnet build, dotnet test, npm test ou git status.");
        var root = Require();
        var file = spec.File == "npm" && OperatingSystem.IsWindows() ? "npm.cmd" : spec.File;
        using var proc = new Process();
        proc.StartInfo = new ProcessStartInfo
        {
            FileName = file,
            Arguments = spec.Args,
            WorkingDirectory = root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        if (!proc.Start()) throw new InvalidOperationException("Não foi possível iniciar o comando.");
        var stdout = proc.StandardOutput.ReadToEndAsync(ct);
        var stderr = proc.StandardError.ReadToEndAsync(ct);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(90));
        try { await proc.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException)
        {
            try { proc.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw new InvalidOperationException("O comando passou de 90 segundos e foi interrompido.");
        }
        var output = (await stdout) + (await stderr);
        if (output.Length > 80_000) output = output[..80_000] + "\n… saída cortada";
        return (proc.ExitCode, output);
    }

    private string Require()
    {
        lock (_gate)
        {
            if (string.IsNullOrEmpty(_root) || !Directory.Exists(_root))
                throw new InvalidOperationException("Nenhuma pasta aberta.");
            return _root;
        }
    }

    private string Resolve(string relative)
    {
        var root = Require();
        if (string.IsNullOrWhiteSpace(relative)) throw new InvalidOperationException("Informe o arquivo.");
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        var prefix = root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) && !string.Equals(full, root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Caminho fora da pasta aberta.");
        return full;
    }

    private static HashSet<string> LoadIgnore(string root)
    {
        var set = new HashSet<string>(SkipDirs, StringComparer.OrdinalIgnoreCase);
        var file = Path.Combine(root, ".gitignore");
        if (!File.Exists(file)) return set;
        foreach (var raw in File.ReadLines(file))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            if (line.StartsWith('!')) continue;
            line = line.TrimStart('/');
            if (line.Contains('*') || line.Contains('/') && !line.EndsWith('/')) continue;
            set.Add(line.TrimEnd('/'));
        }
        return set;
    }

    private static List<DevNode> Walk(string root, string dir, HashSet<string> ignore, int depth)
    {
        var nodes = new List<DevNode>();
        if (depth > 8 || nodes.Count > 2000) return nodes;
        IEnumerable<string> entries;
        try { entries = Directory.EnumerateFileSystemEntries(dir); }
        catch (IOException) { return nodes; }
        catch (UnauthorizedAccessException) { return nodes; }
        foreach (var entry in entries.OrderBy(e => e, StringComparer.OrdinalIgnoreCase))
        {
            var name = Path.GetFileName(entry);
            if (ignore.Contains(name)) continue;
            var rel = Path.GetRelativePath(root, entry).Replace('\\', '/');
            if (Directory.Exists(entry))
                nodes.Add(new DevNode(name, rel, true, Walk(root, entry, ignore, depth + 1)));
            else
                nodes.Add(new DevNode(name, rel, false, new List<DevNode>()));
            if (nodes.Count >= 2000) break;
        }
        return nodes;
    }
}
