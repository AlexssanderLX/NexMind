import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { NeuralCoreHandle } from "../../core/NeuralCore";
import type { CoreStats } from "../../core/scene";
import type { PanelId } from "../../hooks/useNexCore";
import FloatingPanel, { PanelRow, type PanelPos } from "./FloatingPanel";
import Orb from "./Orb";

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

const ICON_PROPS = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const ICONS: Record<PanelId, ReactNode> = {
  activity: (
    <svg {...ICON_PROPS}>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  ),
  tools: (
    <svg {...ICON_PROPS}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
    </svg>
  ),
  runs: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
};

const POS_KEY = "nexPanelPos";
type Positions = Record<PanelId, PanelPos>;

function defaultPositions(w: number, h: number): Positions {
  return {
    activity: { x: 16, y: 56 },
    tools: { x: Math.max(16, w - 288 - 16), y: 56 },
    runs: { x: 16, y: Math.max(56, h - 210) },
  };
}

/** Lista compacta: nome + toggle. A descrição fica recolhida (clique no nome) e há busca quando são muitas. */
function ToolsBody({ tools, onToggle }: { tools: ToolItem[]; onToggle?: (name: string) => void }) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const list = needle
    ? tools.filter((t) => `${t.label ?? ""} ${t.name} ${t.description ?? ""}`.toLowerCase().includes(needle))
    : tools;

  return (
    <>
      {tools.length > 6 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Buscar entre ${tools.length} ferramentas…`}
          className="mb-2 w-full rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-mute focus:border-accent/50"
        />
      )}
      <div className="max-h-72 overflow-y-auto pr-1">
        {list.length === 0 && <Empty>Nenhuma ferramenta encontrada.</Empty>}
        {list.map((t) => {
          const on = t.status !== "desligada";
          const open = expanded === t.name;
          return (
            <div key={t.name} className="border-b border-line/60 last:border-0">
              <div className="flex items-center gap-2 py-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[t.status]}`} />
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : t.name)}
                  title="Ver descrição"
                  className="min-w-0 flex-1 truncate text-left text-fg hover:text-accent"
                >
                  {t.label ?? t.name}
                </button>
                {onToggle && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${on ? "Desligar" : "Ligar"} ${t.label ?? t.name}`}
                    onClick={() => onToggle(t.name)}
                    className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
                      on ? "border-accent/60 bg-accent/30" : "border-line bg-white/5"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${on ? "left-[18px] bg-accent" : "left-0.5 bg-mute"}`}
                    />
                  </button>
                )}
              </div>
              {/* monitor da task: o que a ferramenta faz agora, ao vivo (o ponto pulsa enquanto executa) */}
              {t.note && (
                <p
                  data-task-state={t.status}
                  aria-live="polite"
                  className={`pb-1.5 pl-4 text-[11px] leading-snug ${t.status === "executando" ? "text-accent" : "text-mute"}`}
                >
                  {t.label ?? t.name}: {t.note}
                </p>
              )}
              {open && <p className="pb-2 pl-4 leading-snug text-mute">{t.description ?? "Sem descrição."}</p>}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function PanelsLayer({
  panels,
  onToggle,
  glass,
  info,
  runs,
  tools,
  onToggleTool,
  demo,
  coreRef,
}: {
  panels: Record<PanelId, boolean>;
  onToggle: (id: PanelId) => void;
  glass: boolean;
  info: ActivityInfo;
  runs: RunItem[];
  tools: ToolItem[];
  onToggleTool?: (name: string) => void;
  demo: boolean;
  coreRef: RefObject<NeuralCoreHandle | null>;
}) {
  const shownTools = tools.length > 0 ? tools : demo ? DEMO_TOOLS : [];
  const rootRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ w: 0, h: 0 });
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const [pos, setPos] = useState<Partial<Positions>>(() => {
    try {
      return JSON.parse(localStorage.getItem(POS_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const read = () => setBounds({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    const mq = window.matchMedia("(max-width: 767px)");
    const onMq = () => setMobile(mq.matches);
    mq.addEventListener("change", onMq);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, []);

  const base = defaultPositions(bounds.w, bounds.h);
  const at = (id: PanelId): PanelPos => pos[id] ?? base[id];
  const common = (id: PanelId) => ({
    open: panels[id],
    onToggle: () => onToggle(id),
    pos: at(id),
    bounds,
    onMove: (p: PanelPos) => setPos((all) => ({ ...all, [id]: p })),
    onMoveEnd: () => {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(posRef.current));
      } catch {
        /* sem armazenamento: a posição vale só nesta sessão */
      }
    },
    mobile,
    glass,
    icon: ICONS[id],
    orb: <Orb kind={id} />,
  });

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-30">
      {bounds.w > 0 && (
        <>
          <FloatingPanel title="Atividade do Nex" {...common("activity")}>
            <ActivityBody info={info} coreRef={coreRef} />
          </FloatingPanel>

          <FloatingPanel
            title="Ferramentas"
            {...common("tools")}
            badge={tools.length === 0 && demo ? "exemplo" : undefined}
          >
            {shownTools.length === 0 ? (
              <Empty>Nenhuma ferramenta conectada ainda.</Empty>
            ) : (
              <ToolsBody tools={shownTools} onToggle={onToggleTool} />
            )}
          </FloatingPanel>

          <FloatingPanel title="Execuções recentes" {...common("runs")}>
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
        </>
      )}
    </div>
  );
}
