import type { Metrics } from "../types";

function Meter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  const p = Math.max(0, Math.min(100, percent));
  const color = p > 85 ? "bg-red-500" : p > 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="min-w-[120px] flex-1">
      <div className="flex justify-between text-[11px] text-mute">
        <span>{label}</span>
        <span>{detail}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

const gb = (mb: number) => (mb / 1024).toFixed(1);

export default function ResourceBar({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return <div className="border-b border-line px-6 py-2 text-[11px] text-mute">Consumo: aguardando backend…</div>;
  const { machine: m, loadedModel: lm } = metrics;
  const gpu = m.gpu;
  const gpuPct = lm && lm.sizeMb > 0 ? Math.round((lm.vramMb / lm.sizeMb) * 100) : null;

  return (
    <div className="border-b border-line px-6 py-2">
      <div className="flex flex-wrap gap-5">
        <Meter label="CPU" percent={m.cpuPercent} detail={`${m.cpuPercent.toFixed(0)}%`} />
        <Meter label="RAM" percent={(m.ramUsedMb / m.ramTotalMb) * 100} detail={`${gb(m.ramUsedMb)} / ${gb(m.ramTotalMb)} GB`} />
        {gpu ? (
          <>
            <Meter label="GPU" percent={gpu.utilPercent} detail={`${gpu.utilPercent}%`} />
            <Meter label="VRAM" percent={(gpu.vramUsedMb / gpu.vramTotalMb) * 100} detail={`${gb(gpu.vramUsedMb)} / ${gb(gpu.vramTotalMb)} GB`} />
          </>
        ) : (
          <span className="self-center text-[11px] text-mute">GPU NVIDIA não detectada (nvidia-smi)</span>
        )}
      </div>
      <div className="mt-1.5 text-[11px] text-mute">
        Ollama usa {gb(m.ollamaRamMb)} GB de RAM
        {lm
          ? ` · modelo carregado: ${lm.name} (${gb(lm.sizeMb)} GB, ${gpuPct}% na GPU${
              gpuPct !== null && gpuPct < 100 ? ", resto na CPU/RAM" : ""
            }${lm.contextLength ? `, ctx ${lm.contextLength}` : ""})`
          : " · nenhum modelo carregado"}
      </div>
    </div>
  );
}
