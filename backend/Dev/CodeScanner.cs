using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LocalAi.Api.Dev;

/// <summary>Radiografia curta do projeto real. No máximo 1500 caracteres.</summary>
public static class CodeScanner
{
    private static readonly HashSet<string> Skip = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", "node_modules", "bin", "obj", ".vs", "dist"
    };

    public static string Scan(string root)
    {
        if (!Directory.Exists(root)) return "";
        var sb = new StringBuilder();
        var deps = Dependencies(root);
        if (deps.Length > 0) sb.AppendLine("Dependências: " + deps);
        var types = new List<string>();
        var routes = new List<string>();
        var files = 0;
        foreach (var file in Directory.EnumerateFiles(root, "*.*", SearchOption.AllDirectories))
        {
            if (files >= 60) break;
            var rel = Path.GetRelativePath(root, file);
            if (rel.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Any(Skip.Contains)) continue;
            var ext = Path.GetExtension(file);
            if (ext is not ".cs" and not ".ts" and not ".tsx" and not ".js" and not ".py") continue;
            files++;
            string text;
            try
            {
                if (new FileInfo(file).Length > 200_000) continue;
                text = File.ReadAllText(file);
            }
            catch (IOException) { continue; }
            var shortRel = rel.Replace('\\', '/');
            foreach (Match m in Regex.Matches(text, @"\b(?:public\s+)?(?:class|interface|record)\s+([A-Za-z_][A-Za-z0-9_]*)"))
            {
                if (types.Count < 24) types.Add(m.Groups[1].Value);
            }
            foreach (Match m in Regex.Matches(text, @"\[(Http(?:Get|Post|Put|Delete))(?:\(\s*""([^""]*)""\s*\))?\]"))
            {
                if (routes.Count < 16) routes.Add($"{m.Groups[1].Value} {m.Groups[2].Value} ({shortRel})");
            }
            foreach (Match m in Regex.Matches(text, @"\b(?:app|router)\.(get|post|put|delete)\(\s*['""]([^'""]+)"))
            {
                if (routes.Count < 16) routes.Add($"{m.Groups[1].Value.ToUpperInvariant()} {m.Groups[2].Value} ({shortRel})");
            }
            if (Regex.IsMatch(text, @"class\s+\w+Controller") && types.Count < 24)
                types.Add("controller:" + shortRel);
        }
        if (types.Count > 0) sb.AppendLine("Tipos: " + string.Join(", ", types.Distinct()));
        if (routes.Count > 0) sb.AppendLine("Rotas: " + string.Join("; ", routes.Distinct()));
        var textOut = sb.ToString().Trim();
        return textOut.Length <= 1500 ? textOut : textOut[..1500];
    }

    private static string Dependencies(string root)
    {
        var parts = new List<string>();
        var csproj = Directory.EnumerateFiles(root, "*.csproj", SearchOption.TopDirectoryOnly).FirstOrDefault();
        if (csproj is not null)
        {
            var names = Regex.Matches(File.ReadAllText(csproj), @"PackageReference\s+Include=""([^""]+)""")
                .Select(m => m.Groups[1].Value).Take(8);
            parts.AddRange(names);
        }
        var pkg = Path.Combine(root, "package.json");
        if (File.Exists(pkg))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(pkg));
                if (doc.RootElement.TryGetProperty("dependencies", out var deps))
                    parts.AddRange(deps.EnumerateObject().Take(8).Select(p => p.Name));
            }
            catch (JsonException) { }
        }
        var req = Path.Combine(root, "requirements.txt");
        if (File.Exists(req))
            parts.AddRange(File.ReadLines(req).Select(l => l.Trim()).Where(l => l.Length > 0 && !l.StartsWith('#')).Take(6));
        return string.Join(", ", parts.Distinct().Take(12));
    }
}
