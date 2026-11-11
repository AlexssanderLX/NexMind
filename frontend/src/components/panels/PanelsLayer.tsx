import { useEffect, useState, type RefObject } from "react";
import type { NeuralCoreHandle } from "../../core/NeuralCore";
import type { CoreStats } from "../../core/scene";
import type { PanelId } from "../../hooks/useNexCore";
import FloatingPanel, { PanelRow } from "./FloatingPanel";

export interface ActivityInfo {
  stateLabel: string;
  mode: string;
  model: string;
  connected: boolean;
  micOn: boolean;
  profileLabel: string;
}

/** Uma resposta gerada nesta conversa (dados reais: vêm das estatísticas que o Ollama devolve). */
export interface RunItem {
  model: string;
  tokens: number;
  tokPerSec: number;
  seconds: number;
}

/** Contrato para o futuro painel de ferramentas (MCPs, skills): hoje nenhuma ferramenta está conectada. */
export interface ToolItem {
  name: string;
  status: "pronta" | "executando" | "erro";
  note?: string;
}

const DEMO_TOOLS: ToolItem[] = [
  { name: "scanner-de-portas", status: "pronta", note: "exemplo" },
  { name: "analisador-de-logs", status: "executando", note: "exemplo" },
  { name: "buscador-de-cve", status: "pronta", note: "exemplo" },
];

const STATUS_COLOR: Record<ToolItem["status"], string> = {
  pronta: "bg-emerald-400",
  executando: "bg-accent animate-pulse",
  erro: "bg-red-500",
};

function Empty({ children }: { children: string }) {
  return <p className="py-1 leading-relaxed text-mute">{children}</p>;
}

function ActivityBody({ info, coreRef }: { info: ActivityInfo; coreRef: RefObject<NeuralCoreHandle | null> }) {
  const [stats, setStats] = useState<CoreStats | null>(null);
  useEffect(() => {
    const read = () => setStats(coreRef.current?.stats() ?? null);
    read();
    const t = window.setInterval(read, 1000);
    return () => clearInterval(t);
  }, [coreRef]);

  return (
    <>
      <PanelRow label="Estado" value={info.stateLabel} />
      <PanelRow label="Modo" value={info.mode} />
      <PanelRow label="Modelo" value={info.model} />
      <PanelRow label="Ollama" value={info.connected ? "conectado" : "desconectado"} />
      <PanelRow label="Microfone" value={info.micOn ? "ouvindo" : "desligado"} />
      <PanelRow label="Gráficos" value={info.profileLabel} />
      <PanelRow label="Quadros" value={stats && stats.fps > 0 ? `${stats.fps.toFixed(0)} fps` : "—"} />
    </>
  );
}

export default function PanelsLayer({
  panels,
  onClose,
  glass,
  info,
  runs,
  tools,
  demo,
  coreRef,
}: {
  panels: Record<PanelId, boolean>;
  onClose: (id: PanelId) => void;
  glass: boolean;
  info: ActivityInfo;
  runs: RunItem[];
  tools: ToolItem[];
  demo: boolean;
  coreRef: RefObject<NeuralCoreHandle | null>;
}) {
  const shownTools = tools.length > 0 ? tools : demo ? DEMO_TOOLS : [];
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <FloatingPanel title="Atividade do Nex" anchor="tl" glass={glass} open={panels.activity} onClose={() => onClose("activity")}>
        <ActivityBody info={info} coreRef={coreRef} />
      </FloatingPanel>

      <FloatingPanel
        title="Ferramentas disponíveis"
        anchor="tr"
        glass={glass}
        open={panels.tools}
        onClose={() => onClose("tools")}
        badge={tools.length === 0 && demo ? "exemplo" : undefined}
      >
        {shownTools.length === 0 ? (
          <Empty>Nenhuma ferramenta conectada ainda. MCPs e skills aparecerão aqui quando forem integrados.</Empty>
        ) : (
          shownTools.map((t) => (
            <div key={t.name} className="flex items-center gap-2 py-1">
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[t.status]}`} />
              <span className="flex-1 truncate text-fg">{t.name}</span>
              <span className="text-mute">{t.status}</span>
            </div>
          ))
        )}
      </FloatingPanel>

      <FloatingPanel title="Execuções recentes" anchor="bl" glass={glass} open={panels.runs} onClose={() => onClose("runs")}>
        {runs.length === 0 ? (
          <Empty>Nenhuma resposta nesta conversa ainda.</Empty>
        ) : (
          runs.map((r, i) => (
            <div key={i} className="border-b border-line/60 py-1.5 last:border-0">
              <div className="truncate text-fg">{r.model}</div>
              <div className="text-mute">
                {r.tokens} tokens · {r.tokPerSec} tok/s · {r.seconds}s
              </div>
            </div>
          ))
        )}
      </FloatingPanel>
    </div>
  );
}
