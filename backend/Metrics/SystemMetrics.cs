using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

namespace LocalAi.Api.Metrics;

public record GpuInfo(string Name, int UtilPercent, long VramUsedMb, long VramTotalMb);

/// <summary>Consumo da máquina: CPU, RAM, RAM do Ollama e GPU (via nvidia-smi, se existir).</summary>
public record MachineMetrics(double CpuPercent, long RamUsedMb, long RamTotalMb, long OllamaRamMb, GpuInfo? Gpu);

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

    private readonly object _lock = new();
    private ulong _prevIdle, _prevTotal;
    private double _lastCpu;
    private DateTime _lastCpuAt = DateTime.MinValue;

    private GpuInfo? _gpu;
    private DateTime _gpuAt = DateTime.MinValue;

    public async Task<MachineMetrics> ReadAsync(CancellationToken ct)
    {
        var mem = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        GlobalMemoryStatusEx(ref mem);
        var totalMb = (long)(mem.TotalPhys / 1_048_576);
        var usedMb = totalMb - (long)(mem.AvailPhys / 1_048_576);

        return new MachineMetrics(ReadCpu(), usedMb, totalMb, ReadOllamaRamMb(), await ReadGpuAsync(ct));
    }

    private double ReadCpu()
    {
        lock (_lock)
        {
            if ((DateTime.UtcNow - _lastCpuAt).TotalMilliseconds < 500) return _lastCpu;
            if (!GetSystemTimes(out var idle, out var kernel, out var user)) return _lastCpu;
            var total = kernel + user; // kernel já inclui o tempo ocioso
            if (_prevTotal != 0 && total > _prevTotal)
                _lastCpu = Math.Round(100.0 * (1 - (double)(idle - _prevIdle) / (total - _prevTotal)), 1);
            _prevIdle = idle;
            _prevTotal = total;
            _lastCpuAt = DateTime.UtcNow;
            return _lastCpu;
        }
    }

    private static long ReadOllamaRamMb()
    {
        long bytes = 0;
        foreach (var p in Process.GetProcesses())
        {
            try { if (p.ProcessName.StartsWith("ollama", StringComparison.OrdinalIgnoreCase)) bytes += p.WorkingSet64; }
            catch { /* processo encerrou ou sem acesso */ }
            finally { p.Dispose(); }
        }
        return bytes / 1_048_576;
    }

    private async Task<GpuInfo?> ReadGpuAsync(CancellationToken ct)
    {
        if ((DateTime.UtcNow - _gpuAt).TotalMilliseconds < 1000) return _gpu;
        _gpuAt = DateTime.UtcNow;
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
            _gpu = new GpuInfo(f[0], int.Parse(f[1], inv), long.Parse(f[2], inv), long.Parse(f[3], inv));
        }
        catch
        {
            _gpu = null; // sem nvidia-smi / sem GPU NVIDIA
        }
        return _gpu;
    }
}
