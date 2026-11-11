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
  /** Nome legível da ferramenta e o que ela faz (o `name` é só a chave). */
  label?: string;
  description?: string;
  status: "desligada" | "pronta" | "executando" | "erro";
  note?: string;
}

const DEMO_TOOLS: ToolItem[] = [
  { name: "scanner-de-portas", status: "pronta", note: "exemplo" },
  { name: "analisador-de-logs", status: "executando", note: "exemplo" },
  { name: "buscador-de-cve", status: "pronta", note: "exemplo" },
];

const STATUS_COLOR: Record<ToolItem["status"], string> = {
  desligada: "bg-mute",
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
  onToggleTool,
  demo,
  coreRef,
}: {
  panels: Record<PanelId, boolean>;
  onClose: (id: PanelId) => void;
  glass: boolean;
  info: ActivityInfo;
  runs: RunItem[];
  tools: ToolItem[];
  onToggleTool?: (name: string) => void;
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
            <div key={t.name} className="flex items-start gap-2 border-b border-line/60 py-2 last:border-0">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[t.status]}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-fg">{t.label ?? t.name}</div>
                {t.description && <div className="text-xs leading-snug text-mute">{t.description}</div>}
                {t.status === "executando" && <div className="text-xs text-accent">{t.note ?? "executando"}</div>}
              </div>
              {onToggleTool && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={t.status !== "desligada"}
                  aria-label={`${t.status === "desligada" ? "Ligar" : "Desligar"} ${t.label ?? t.name}`}
                  onClick={() => onToggleTool(t.name)}
                  className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    t.status === "desligada"
                      ? "border-line text-mute hover:bg-white/5 hover:text-fg"
                      : "border-accent/60 bg-accent/15 text-accent"
                  }`}
                >
                  {t.status === "desligada" ? "Ligar" : "Ligada"}
                </button>
              )}
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
