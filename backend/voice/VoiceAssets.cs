namespace LocalAi.Api.Voice;

/// <summary>
/// Onde estão o Piper (voz) e o modelo da voz. Esses arquivos são pesados (~100 MB) e ficam fora do git, então NÃO existem
/// em cada pasta de trabalho (develop, branches, testes). A pasta comum a todas é %LOCALAPPDATA%\nex\voice, a mesma que o
/// motor já usa como área de trabalho do Piper (o Piper não abre caminhos com acento, e a pasta do projeto tem "ç" e "ã").
/// Ordem de busca: o caminho configurado em appsettings.json; se não existir, a pasta comum.
/// A fala e o reconhecimento rodam na CPU: nada aqui toca a GPU (a VRAM é do Qwen).
/// </summary>
public static class VoiceAssets
{
    /// <summary>A variável de ambiente NEX_VOICE_HOME troca a pasta comum (para testes ou para mudar o local dos arquivos).</summary>
    public static string LocalRoot =>
        Environment.GetEnvironmentVariable("NEX_VOICE_HOME") is { Length: > 0 } custom
            ? custom
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "nex", "voice");

    public const string SetupHint = "Rode scripts/setup-voice-assets.ps1 para instalar o Piper e a voz, ou use a voz do Windows (sapi).";

    /// <summary>Devolve os caminhos do Piper e do modelo a usar (os configurados, ou os da pasta comum se os configurados não existem).</summary>
    public static (string Exe, string Model) Resolve(string contentRoot, string? configuredExe, string? configuredModel, string? localRoot = null)
    {
        var root = localRoot ?? LocalRoot;
        var exe = Absolute(contentRoot, configuredExe);
        var model = Absolute(contentRoot, configuredModel);

        if (!File.Exists(exe))
        {
            var shared = Path.Combine(root, "piper", "piper.exe");
            if (File.Exists(shared)) exe = shared;
        }
        if (!File.Exists(model))
        {
            var name = string.IsNullOrWhiteSpace(configuredModel) ? "" : Path.GetFileName(configuredModel.Replace('/', Path.DirectorySeparatorChar));
            if (name.Length > 0)
            {
                var shared = Path.Combine(root, "models", name);
                if (File.Exists(shared)) model = shared;
            }
        }
        return (exe, model);
    }

    private static string Absolute(string contentRoot, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        return Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(contentRoot, path));
    }
}
