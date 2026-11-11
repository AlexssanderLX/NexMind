import { useEffect } from "react";
import type { Metrics } from "../types";

const gb = (mb: number) => (mb / 1024).toFixed(1);

/** Maior uso entre CPU, RAM, GPU e VRAM (0-100): decide a cor da bolinha. */
export function loadPercent(m: Metrics | null): number {
  if (!m) return 0;
  const { cpuPercent, ramUsedMb, ramTotalMb, gpu } = m.machine;
  return Math.max(
    cpuPercent,
    (ramUsedMb / ramTotalMb) * 100,
    gpu?.utilPercent ?? 0,
    gpu ? (gpu.vramUsedMb / gpu.vramTotalMb) * 100 : 0,
  );
}

export const loadColor = (p: number) => (p > 85 ? "bg-red-500" : p > 60 ? "bg-amber-400" : "bg-emerald-400");

function Meter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-mute">{label}</span>
        <span className="tabular-nums">{detail}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${loadColor(p)} transition-all duration-500`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

export default function MetricsModal({ metrics, onClose }: { metrics: Metrics | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const m = metrics?.machine;
  const lm = metrics?.loadedModel;
  const gpuPct = lm && lm.sizeMb > 0 ? Math.round((lm.vramMb / lm.sizeMb) * 100) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Consumo do sistema"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-accent/20 bg-side p-6 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold">Consumo do sistema</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-mute hover:bg-white/5 hover:text-fg" title="Fechar (Esc)">
            ✕
          </button>
        </div>

        {!m ? (
          <p className="text-sm text-mute">Aguardando o backend…</p>
        ) : (
          <div className="space-y-4">
            <Meter label="CPU" percent={m.cpuPercent} detail={`${m.cpuPercent.toFixed(0)}%`} />
            <Meter
              label="RAM"
              percent={(m.ramUsedMb / m.ramTotalMb) * 100}
              detail={`${gb(m.ramUsedMb)} / ${gb(m.ramTotalMb)} GB`}
            />
            {m.gpu ? (
              <>
                <Meter label={`GPU · ${m.gpu.name}`} percent={m.gpu.utilPercent} detail={`${m.gpu.utilPercent}%`} />
                <Meter
                  label="VRAM"
                  percent={(m.gpu.vramUsedMb / m.gpu.vramTotalMb) * 100}
                  detail={`${gb(m.gpu.vramUsedMb)} / ${gb(m.gpu.vramTotalMb)} GB`}
                />
              </>
            ) : (
              <p className="text-sm text-mute">GPU NVIDIA não detectada (nvidia-smi).</p>
            )}

            <div className="space-y-1 border-t border-line pt-4 text-sm text-mute">
              <div className="flex justify-between">
                <span>RAM usada pelo Ollama</span>
                <span className="text-fg">{gb(m.ollamaRamMb)} GB</span>
              </div>
              <div className="flex justify-between">
                <span>Modelo carregado</span>
                <span className="text-fg">{lm ? lm.name : "nenhum"}</span>
              </div>
              {lm && (
                <div className="flex justify-between">
                  <span>No modelo: GPU / contexto</span>
                  <span className="text-fg">
                    {gpuPct}% na GPU{lm.contextLength ? ` · ctx ${lm.contextLength}` : ""}
                  </span>
                </div>
              )}
              {lm && gpuPct !== null && gpuPct < 100 && (
                <p className="pt-1 text-xs text-amber-400">Parte do modelo roda na CPU/RAM, o que deixa as respostas mais lentas.</p>
              )}
            </div>
          </div>
        )}
        <p className="mt-5 text-[11px] text-mute">Atualiza a cada 1,5 s enquanto esta janela estiver aberta.</p>
      </div>
    </div>
  );
}
