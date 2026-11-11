using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace LocalAi.Api.Metrics;

public record GpuInfo(string Name, int UtilPercent, long VramUsedMb, long VramTotalMb);

/// <summary>Consumo da máquina: CPU, RAM, RAM do Ollama e GPU.</summary>
public record MachineMetrics(double CpuPercent, long RamUsedMb, long RamTotalMb, long OllamaRamMb, GpuInfo? Gpu);

/// <summary>
/// GPU NVIDIA lida direto pela NVML (nvml.dll, que já vem com o driver): é uma chamada de biblioteca,
/// bem mais barata que abrir um processo nvidia-smi (~100 ms) a cada consulta.
/// </summary>
internal static class Nvml
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Utilization { public uint Gpu, Memory; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryInfo { public ulong Total, Free, Used; }

    [DllImport("nvml.dll", EntryPoint = "nvmlInit_v2")]
    private static extern int Init();

    [DllImport("nvml.dll", EntryPoint = "nvmlDeviceGetHandleByIndex_v2")]
    private static extern int GetHandle(uint index, out IntPtr device);

    [DllImport("nvml.dll", EntryPoint = "nvmlDeviceGetName", CharSet = CharSet.Ansi)]
    private static extern int GetName(IntPtr device, StringBuilder name, uint length);

    [DllImport("nvml.dll", EntryPoint = "nvmlDeviceGetUtilizationRates")]
    private static extern int GetUtilization(IntPtr device, out Utilization u);

    [DllImport("nvml.dll", EntryPoint = "nvmlDeviceGetMemoryInfo")]
    private static extern int GetMemory(IntPtr device, out MemoryInfo m);

    private static bool _tried, _ok;
    private static IntPtr _device;
    private static string _name = "";

    /// <summary>null se a NVML não existe ou falhou (aí o chamador usa o nvidia-smi).</summary>
    public static GpuInfo? Read()
    {
        if (!_tried)
        {
            _tried = true;
            try
            {
                if (Init() == 0 && GetHandle(0, out _device) == 0)
                {
                    var sb = new StringBuilder(96);
                    GetName(_device, sb, 96);
                    _name = sb.ToString();
                    _ok = true;
                }
            }
            catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException) { }
        }
        if (!_ok) return null;
        if (GetUtilization(_device, out var u) != 0 || GetMemory(_device, out var m) != 0) return null;
        return new GpuInfo(_name, (int)u.Gpu, (long)(m.Used / 1_048_576), (long)(m.Total / 1_048_576));
    }
}

public class SystemMetrics
{
    [DllImport("kernel32.dll")]
    private static extern bool GetSystemTimes(out ulong idle, out ulong kernel, out ulong user);

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint Length, MemoryLoad;
        public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);

    // O servidor e o runner do modelo são ambos "ollama.exe". Uma única busca por nome: cada GetProcessesByName
    // percorre a lista de processos do Windows, então chamar várias vezes sai mais caro.
    private const string OllamaProcessName = "ollama";

    private readonly object _lock = new();
    private ulong _prevIdle, _prevTotal;
    private double _lastCpu;

    private MachineMetrics? _cached;
    private DateTime _cachedAt = DateTime.MinValue;

    private GpuInfo? _smiGpu; // fallback sem NVML
    private DateTime _smiAt = DateTime.MinValue;

    public async Task<MachineMetrics> ReadAsync(CancellationToken ct)
    {
        // várias abas/consultas no mesmo segundo compartilham a mesma leitura
        if (_cached is not null && (DateTime.UtcNow - _cachedAt).TotalMilliseconds < 700) return _cached;

        var mem = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        GlobalMemoryStatusEx(ref mem);
        var totalMb = (long)(mem.TotalPhys / 1_048_576);
        var usedMb = totalMb - (long)(mem.AvailPhys / 1_048_576);

        var gpu = Nvml.Read() ?? await ReadGpuViaSmiAsync(ct);
        var result = new MachineMetrics(ReadCpu(), usedMb, totalMb, ReadOllamaRamMb(), gpu);
        _cached = result;
        _cachedAt = DateTime.UtcNow;
        return result;
    }

    private double ReadCpu()
    {
        lock (_lock)
        {
            if (!GetSystemTimes(out var idle, out var kernel, out var user)) return _lastCpu;
            var total = kernel + user; // kernel já inclui o tempo ocioso
            if (_prevTotal != 0 && total > _prevTotal)
                _lastCpu = Math.Round(100.0 * (1 - (double)(idle - _prevIdle) / (total - _prevTotal)), 1);
            _prevIdle = idle;
            _prevTotal = total;
            return _lastCpu;
        }
    }

    private static long ReadOllamaRamMb()
    {
        long bytes = 0;
        foreach (var p in Process.GetProcessesByName(OllamaProcessName))
        {
            try { bytes += p.WorkingSet64; }
            catch { /* processo encerrou ou sem acesso */ }
            finally { p.Dispose(); }
        }
        return bytes / 1_048_576;
    }

    /// <summary>Plano B (sem NVML): abre o nvidia-smi, no máximo uma vez a cada 5 s.</summary>
    private async Task<GpuInfo?> ReadGpuViaSmiAsync(CancellationToken ct)
    {
        if ((DateTime.UtcNow - _smiAt).TotalSeconds < 5) return _smiGpu;
        _smiAt = DateTime.UtcNow;
        try
        {
            var psi = new ProcessStartInfo("nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits")
            { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
            using var proc = Process.Start(psi)!;
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(3));
            var line = (await proc.StandardOutput.ReadToEndAsync(cts.Token)).Split('\n')[0].Trim();
            var f = line.Split(',', StringSplitOptions.TrimEntries);
            var inv = CultureInfo.InvariantCulture;
            _smiGpu = new GpuInfo(f[0], int.Parse(f[1], inv), long.Parse(f[2], inv), long.Parse(f[3], inv));
        }
        catch
        {
            _smiGpu = null; // sem nvidia-smi / sem GPU NVIDIA
        }
        return _smiGpu;
    }
}
