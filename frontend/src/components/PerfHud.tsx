import { useEffect, useState, type RefObject } from "react";
import type { NeuralCoreHandle } from "../core/NeuralCore";
import type { CoreStats } from "../core/scene";

/** Medidor de desempenho do núcleo (FPS, tempo de quadro, custo de CPU do JavaScript). Ligado nas configurações. */
export default function PerfHud({ coreRef }: { coreRef: RefObject<NeuralCoreHandle | null> }) {
  const [s, setS] = useState<CoreStats | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setS(coreRef.current?.stats() ?? null), 500);
    return () => clearInterval(t);
  }, [coreRef]);

  if (!s) return null;
  return (
    <div
      data-no-core
      className="pointer-events-none absolute bottom-2 right-3 z-40 rounded-md border border-line bg-black/60 px-2 py-1 font-mono text-[10px] leading-4 text-mute"
    >
      <div className="text-fg">
        {s.fps.toFixed(0)} fps · quadro {s.frameMsAvg.toFixed(1)} ms (máx {s.frameMsMax.toFixed(0)}) · JS {s.jsMsAvg.toFixed(2)} ms
      </div>
      <div>
        {s.profile} · {s.particles}+{s.nodes} pts · {s.edges} conexões · dpr {s.dpr} · {s.width}×{s.height}
      </div>
      <div className="max-w-[26rem] truncate">{s.renderer}</div>
    </div>
  );
}
