using System.Diagnostics;
using System.Text;

namespace LocalAi.Api.Rag.Digest;

/// <summary>
/// Lê png, jpg e webp e extrai texto fora da GPU.
/// Tenta o motor de OCR do Windows (Windows.Media.Ocr, via o executável nativo quando presente)
/// e, se ele não estiver acessível neste runtime, o Tesseract local. O texto passa por um filtro
/// que descarta sequências soltas típicas de ruído visual.
/// </summary>
public static class ImageOcrDigest
{
    public static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase) { ".png", ".jpg", ".jpeg", ".webp" };

    public static async Task<(string Summary, List<RagChunk> Chunks)> ReadAsync(
        Stream stream, string fileId, string fileName, CancellationToken ct = default)
    {
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct);
        var bytes = buffer.ToArray();
        var raw = await RecognizeAsync(bytes, fileName, ct);
        var clean = Sanitize(raw);
        if (clean.Length == 0)
        {
            var note = "Imagem recebida. O OCR não devolveu texto legível.";
            return (note, new List<RagChunk> { new(0, fileId, note, "imagem", 8) });
        }
        var (type, summary, chunks) = TextAndLogDigest.FromText(clean, fileId, fileName);
        _ = type;
        return ("OCR. " + summary, chunks);
    }

    /// <summary>Remove linhas em que a maior parte dos símbolos está solta (artefato de compressão ou fundo).</summary>
    public static string Sanitize(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var kept = new List<string>();
        foreach (var line in raw.Replace("\r\n", "\n").Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.Length < 2) continue;
            var letters = 0;
            var isolated = 0;
            var tokens = trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            foreach (var token in tokens)
            {
                var word = token.Count(char.IsLetterOrDigit);
                if (word == 0) continue;
                if (token.Length == 1 && !char.IsDigit(token[0])) { isolated++; continue; }
                if (word * 2 < token.Length) { isolated++; continue; }
                letters += word;
            }
            if (letters < 2) continue;
            if (isolated > tokens.Length / 2) continue;
            kept.Add(trimmed);
        }
        return string.Join('\n', kept);
    }

    private static async Task<string> RecognizeAsync(byte[] bytes, string fileName, CancellationToken ct)
    {
        var ext = Path.GetExtension(fileName);
        var dir = Path.Combine(Path.GetTempPath(), "nex-ocr-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var image = Path.Combine(dir, "page" + (ext.Length > 0 ? ext : ".png"));
        try
        {
            await File.WriteAllBytesAsync(image, bytes, ct);
            var windows = await RunWindowsOcrAsync(image, ct);
            if (!string.IsNullOrWhiteSpace(windows)) return windows;
            return await RunTesseractAsync(image, dir, ct);
        }
        finally
        {
            try { Directory.Delete(dir, recursive: true); } catch (IOException) { }
        }
    }

    /// <summary>
    /// Windows.Media.Ocr via o runtime do Windows (PowerShell carrega a projeção WinRT que o net10.0 não referencia).
    /// Sem rede e sem GPU. Se a projeção não existir nesta máquina, devolve vazio e o Tesseract entra.
    /// </summary>
    private static async Task<string> RunWindowsOcrAsync(string imagePath, CancellationToken ct)
    {
        var script = """
            $ErrorActionPreference = 'Stop'
            Add-Type -AssemblyName System.Runtime.WindowsRuntime
            $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
            $null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
            $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
            $path = $args[0]
            $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
            function Await($op, $type) {
              $m = $asTask.MakeGenericMethod($type)
              $task = $m.Invoke($null, @($op))
              $task.Wait()
              return $task.Result
            }
            $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
            $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
            $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
            if ($null -eq $engine) { return }
            $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
            $result.Text
            """;
        return await RunAsync("powershell", $"-NoProfile -NonInteractive -Command {Quote(script)} {Quote(imagePath)}", ct);
    }

    private static async Task<string> RunTesseractAsync(string imagePath, string dir, CancellationToken ct)
    {
        var exe = Which("tesseract");
        if (exe is null) return "";
        var output = Path.Combine(dir, "out");
        var err = await RunAsync(exe, $"{Quote(imagePath)} {Quote(output)} -l por+eng --psm 6", ct);
        var txt = output + ".txt";
        if (!File.Exists(txt)) return err;
        return await File.ReadAllTextAsync(txt, ct);
    }

    private static string? Which(string name)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var folder in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = Path.Combine(folder, name + ".exe");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static async Task<string> RunAsync(string file, string args, CancellationToken ct)
    {
        try
        {
            using var proc = new Process();
            proc.StartInfo = new ProcessStartInfo
            {
                FileName = file,
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8
            };
            if (!proc.Start()) return "";
            var read = proc.StandardOutput.ReadToEndAsync(ct);
            await proc.WaitForExitAsync(ct);
            var text = await read;
            return proc.ExitCode == 0 ? text : "";
        }
        catch (Exception)
        {
            return "";
        }
    }

    private static string Quote(string value) => "\"" + value.Replace("\"", "\\\"") + "\"";
}
