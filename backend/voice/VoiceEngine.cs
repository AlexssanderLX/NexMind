using System.Diagnostics;
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

public sealed class VoiceEngine
{
    private readonly VoiceOptions _opt;
    private readonly string _sttScript;
    private readonly ILogger<VoiceEngine> _log;

    public VoiceEngine(IConfiguration config, IWebHostEnvironment env, ILogger<VoiceEngine> log)
    {
        _opt = config.GetSection("Voice").Get<VoiceOptions>() ?? new VoiceOptions();
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
                PiperReady() ? _opt.PiperModel : "defina Voice:PiperExe e Voice:PiperModel em appsettings.json"),
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

        var psi = new ProcessStartInfo
        {
            FileName = _opt.Python,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        psi.ArgumentList.Add(_sttScript);
        psi.ArgumentList.Add(wavPath);
        psi.ArgumentList.Add(_opt.WhisperModel);

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Não foi possível iniciar o Python.");
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        if (proc.ExitCode != 0)
        {
            var msg = TryError(stdout) ?? (string.IsNullOrWhiteSpace(stderr) ? stdout : stderr);
            _log.LogWarning("STT falhou ({Code}): {Msg}", proc.ExitCode, msg);
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(msg)
                ? "Falha no reconhecimento de fala."
                : msg.Trim());
        }

        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(stdout) ? "{}" : stdout);
        var text = doc.RootElement.TryGetProperty("text", out var t) ? t.GetString() ?? "" : "";
        var ms = doc.RootElement.TryGetProperty("ms", out var m) ? m.GetInt32() : 0;
        return (text, ms);
    }

    public async Task<(byte[] Wav, int Ms, string Engine)> SpeakAsync(string text, string engine, string? voice, double rate, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        if (engine == "piper")
        {
            if (!PiperReady())
                throw new InvalidOperationException("Piper não configurado. Use a voz do Windows (sapi) ou defina Voice:PiperExe e Voice:PiperModel.");
            var wav = await SpeakPiperAsync(text, rate, ct);
            return (wav, (int)sw.ElapsedMilliseconds, "piper");
        }

        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException("Síntese sapi só existe no Windows. Configure o Piper para outro sistema.");
        var bytes = SpeakSapi(text, voice, rate);
        return (bytes, (int)sw.ElapsedMilliseconds, "sapi");
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

    private async Task<byte[]> SpeakPiperAsync(string text, double rate, CancellationToken ct)
    {
        var outFile = Path.Combine(Path.GetTempPath(), "nex-tts-" + Guid.NewGuid().ToString("n") + ".wav");
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = _opt.PiperExe,
                RedirectStandardInput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("--model");
            psi.ArgumentList.Add(_opt.PiperModel);
            psi.ArgumentList.Add("--output_file");
            psi.ArgumentList.Add(outFile);
            var lengthScale = rate <= 0.1 ? 1.0 : 1.0 / rate;
            psi.ArgumentList.Add("--length_scale");
            psi.ArgumentList.Add(lengthScale.ToString(System.Globalization.CultureInfo.InvariantCulture));

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
