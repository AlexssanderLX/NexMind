using System.Diagnostics;
using System.Text;
using System.Speech.Synthesis;
using System.Text.Json;

namespace LocalAi.Api.Voice;

public sealed class VoiceOptions
{
    public string Python { get; set; } = "python";
    /// <summary>Modelo do faster-whisper (base cabe bem na CPU desta máquina).</summary>
    public string WhisperModel { get; set; } = "base";
    public string PiperExe { get; set; } = "";
    public string PiperModel { get; set; } = "";
}

public sealed record VoiceEngineInfo(string Id, string Kind, bool Available, string Detail);

public sealed class VoiceEngine : IDisposable
{
    private readonly VoiceOptions _opt;
    private readonly string _sttScript;
    private readonly ILogger<VoiceEngine> _log;
    private readonly SemaphoreSlim _sttGate = new(1, 1);
    private Process? _stt;
    private readonly object _sttLock = new();

    public VoiceEngine(IConfiguration config, IWebHostEnvironment env, ILogger<VoiceEngine> log)
    {
        _opt = config.GetSection("Voice").Get<VoiceOptions>() ?? new VoiceOptions();
        // o Piper e a voz ficam fora do git: se o caminho configurado não existe nesta pasta, usa o da pasta comum (%LOCALAPPDATA%\nex\voice)
        (_opt.PiperExe, _opt.PiperModel) = VoiceAssets.Resolve(env.ContentRootPath, _opt.PiperExe, _opt.PiperModel);
        _sttScript = Path.Combine(env.ContentRootPath, "voice", "stt.py");
        _log = log;
    }

    public VoiceOptions Options => _opt;

    public IReadOnlyList<VoiceEngineInfo> List()
    {
        var list = new List<VoiceEngineInfo>
        {
            new("faster-whisper", "stt", File.Exists(_sttScript),
                File.Exists(_sttScript)
                    ? $"script local, modelo '{_opt.WhisperModel}' na CPU (int8). Requer pip install -r backend/voice/requirements.txt"
                    : "script stt.py ausente"),
            new("sapi", "tts", OperatingSystem.IsWindows(),
                OperatingSystem.IsWindows() ? "voz do Windows (System.Speech), sem download" : "somente Windows"),
            new("piper", "tts", PiperReady(),
                PiperReady() ? _opt.PiperModel : "Piper não encontrado. " + VoiceAssets.SetupHint),
        };
        return list;
    }

    public IReadOnlyList<string> WindowsVoices()
    {
        if (!OperatingSystem.IsWindows()) return [];
        using var synth = new SpeechSynthesizer();
        return synth.GetInstalledVoices()
            .Where(v => v.Enabled)
            .Select(v => v.VoiceInfo.Name)
            .ToList();
    }

    private bool PiperReady() =>
        !string.IsNullOrWhiteSpace(_opt.PiperExe) && File.Exists(_opt.PiperExe)
        && !string.IsNullOrWhiteSpace(_opt.PiperModel) && File.Exists(_opt.PiperModel);

    public async Task<(string Text, int Ms)> TranscribeAsync(string wavPath, CancellationToken ct)
    {
        if (!File.Exists(_sttScript))
            throw new InvalidOperationException("Reconhecimento local indisponível: backend/voice/stt.py não encontrado.");

        await _sttGate.WaitAsync(ct);
        try
        {
            var proc = EnsureStt();
            await proc.StandardInput.WriteLineAsync(wavPath.AsMemory(), ct);
            await proc.StandardInput.FlushAsync(ct);
            var line = await proc.StandardOutput.ReadLineAsync(ct);
            if (line is null)
            {
                StopStt();
                throw new InvalidOperationException("O reconhecimento encerrou no meio da transcrição.");
            }
            using var doc = JsonDocument.Parse(line);
            if (doc.RootElement.TryGetProperty("error", out var err))
                throw new InvalidOperationException(err.GetString() ?? "Falha no reconhecimento de fala.");
            var text = doc.RootElement.TryGetProperty("text", out var t) ? t.GetString() ?? "" : "";
            var ms = doc.RootElement.TryGetProperty("ms", out var m) ? m.GetInt32() : 0;
            return (text, ms);
        }
        finally
        {
            _sttGate.Release();
        }
    }

    private Process EnsureStt()
    {
        lock (_sttLock)
        {
            if (_stt is { HasExited: false }) return _stt;
            var psi = new ProcessStartInfo
            {
                FileName = _opt.Python,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            psi.Environment["PYTHONUTF8"] = "1";
            psi.ArgumentList.Add(_sttScript);
            psi.ArgumentList.Add("--serve");
            psi.ArgumentList.Add(_opt.WhisperModel);
            var proc = Process.Start(psi) ?? throw new InvalidOperationException("Não foi possível iniciar o Python.");
            _ = Task.Run(async () =>
            {
                try
                {
                    var err = await proc.StandardError.ReadToEndAsync();
                    if (!string.IsNullOrWhiteSpace(err)) _log.LogWarning("STT: {Err}", err.Trim());
                }
                catch { /* processo já encerrou */ }
            });
            var ready = proc.StandardOutput.ReadLine();
            if (ready is null || !ready.Contains("\"ready\"", StringComparison.Ordinal))
            {
                var msg = TryError(ready ?? "") ?? "O reconhecimento não ficou pronto.";
                try { proc.Kill(entireProcessTree: true); } catch { /* já saiu */ }
                throw new InvalidOperationException(msg);
            }
            _stt = proc;
            return proc;
        }
    }

    private void StopStt()
    {
        lock (_sttLock)
        {
            try { _stt?.Kill(entireProcessTree: true); } catch { /* já saiu */ }
            _stt = null;
        }
    }

    public void Dispose()
    {
        StopStt();
        _sttGate.Dispose();
    }

    public async Task<(byte[] Wav, int Ms, string Engine)> SpeakAsync(string text, string engine, string? voice, double rate, CancellationToken ct)
    {
        text = StripForSpeech(text);
        var sw = Stopwatch.StartNew();
        if (engine == "piper")
        {
            if (!PiperReady())
                throw new InvalidOperationException("Piper não encontrado. " + VoiceAssets.SetupHint);
            var wav = await SpeakPiperAsync(text, rate, ct);
            return (wav, (int)sw.ElapsedMilliseconds, "piper");
        }

        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException("Síntese sapi só existe no Windows. Configure o Piper para outro sistema.");
        var bytes = SpeakSapi(text, voice, rate);
        return (bytes, (int)sw.ElapsedMilliseconds, "sapi");
    }

    private static string StripForSpeech(string text)
    {
        var sb = new StringBuilder(text.Length);
        foreach (var rune in text.EnumerateRunes())
        {
            var v = rune.Value;
            if (v is >= 0x1F300 and <= 0x1FAFF or >= 0x2600 and <= 0x27BF or 0xFE0F or 0x200D) continue;
            sb.Append(rune.ToString());
        }
        return sb.ToString();
    }

    private static byte[] SpeakSapi(string text, string? voice, double rate)
    {
        using var synth = new SpeechSynthesizer();
        if (!string.IsNullOrWhiteSpace(voice))
        {
            try { synth.SelectVoice(voice); }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
            {
                /* voz pedida ausente: segue com a padrão do Windows */
            }
        }
        // System.Speech usa -10..10. 1.0 = 0.
        synth.Rate = Math.Clamp((int)Math.Round((rate - 1.0) * 6), -10, 10);
        using var ms = new MemoryStream();
        synth.SetOutputToWaveStream(ms);
        synth.Speak(text);
        return ms.ToArray();
    }

    /// <summary>
    /// O espeak do Piper não abre caminhos com acento. Copia o executável e a voz para %LOCALAPPDATA%\nex\voice.
    /// </summary>
    private (string Exe, string Model) PiperAsciiPaths()
    {
        if (_opt.PiperExe.All(c => c < 128) && _opt.PiperModel.All(c => c < 128))
            return (_opt.PiperExe, _opt.PiperModel);
        var root = VoiceAssets.LocalRoot;
        var exeDir = Path.Combine(root, "piper");
        var exe = Path.Combine(exeDir, "piper.exe");
        var model = Path.Combine(root, "models", Path.GetFileName(_opt.PiperModel));
        if (!File.Exists(exe))
        {
            Directory.CreateDirectory(exeDir);
            foreach (var file in Directory.GetFiles(Path.GetDirectoryName(_opt.PiperExe)!, "*", SearchOption.AllDirectories))
            {
                var rel = Path.GetRelativePath(Path.GetDirectoryName(_opt.PiperExe)!, file);
                var dest = Path.Combine(exeDir, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                File.Copy(file, dest, overwrite: true);
            }
        }
        if (!File.Exists(model))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(model)!);
            File.Copy(_opt.PiperModel, model, overwrite: true);
            var json = _opt.PiperModel + ".json";
            if (File.Exists(json)) File.Copy(json, model + ".json", overwrite: true);
        }
        return (exe, model);
    }

    private async Task<byte[]> SpeakPiperAsync(string text, double rate, CancellationToken ct)
    {
        var (exe, model) = PiperAsciiPaths();
        var outFile = Path.Combine(Path.GetTempPath(), "nex-tts-" + Guid.NewGuid().ToString("n") + ".wav");
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = exe,
                WorkingDirectory = Path.GetDirectoryName(exe) ?? "",
                RedirectStandardInput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("--model");
            psi.ArgumentList.Add(model);
            psi.ArgumentList.Add("--output_file");
            psi.ArgumentList.Add(outFile);
            // 0.8 deixa a voz do Piper mais perto de uma fala natural. 1.0 soava arrastada.
            var lengthScale = rate <= 0.1 ? 0.8 : 0.8 / rate;
            psi.ArgumentList.Add("--length_scale");
            psi.ArgumentList.Add(lengthScale.ToString(System.Globalization.CultureInfo.InvariantCulture));
            psi.ArgumentList.Add("--sentence_silence");
            psi.ArgumentList.Add("0.05");

            using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Não foi possível iniciar o Piper.");
            await proc.StandardInput.WriteAsync(text.AsMemory(), ct);
            proc.StandardInput.Close();
            var err = await proc.StandardError.ReadToEndAsync(ct);
            await proc.WaitForExitAsync(ct);
            if (proc.ExitCode != 0 || !File.Exists(outFile))
                throw new InvalidOperationException(string.IsNullOrWhiteSpace(err) ? "Piper não gerou áudio." : err.Trim());
            return await File.ReadAllBytesAsync(outFile, ct);
        }
        finally
        {
            try { if (File.Exists(outFile)) File.Delete(outFile); } catch { /* temporário */ }
        }
    }

    private static string? TryError(string stdout)
    {
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            return doc.RootElement.TryGetProperty("error", out var e) ? e.GetString() : null;
        }
        catch { return null; }
    }
}
