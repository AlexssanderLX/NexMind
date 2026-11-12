import { useEffect, useRef, useState } from "react";
import { SECURITY_AGENTS, cascadePos, closeWindow, openWindow, windowZ, type AgentId } from "../lib/securityAgents";
import FloatingPanel, { type PanelPos } from "./panels/FloatingPanel";
import SubagentChat from "./SubagentChat";

const FAB_KEY = "nexAgentFabPos";
const WINDOW_W = 380;
const WINDOW_H = 460; // estimativa para a posição inicial; o FloatingPanel mede a janela de verdade

/** O botão do robô: um anel luminoso girando com o 🤖 no centro (mesma linguagem das bolinhas dos painéis). */
export function RobotOrb() {
  return (
    <>
      <svg viewBox="0 0 100 100" className="text-accent" aria-hidden>
        <defs>
          <radialGradient id="orbRobotGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
            <stop offset="0.45" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="47" fill="url(#orbRobotGlow)" className="orb-pulse" opacity="0.7" />
        <circle cx="50" cy="50" r="36" fill="#06101d" fillOpacity="0.8" stroke="currentColor" strokeOpacity="0.8" strokeWidth="2" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="2 6" className="orb-spin orb-spin-slow" />
        <circle cx="50" cy="8" r="2.8" fill="currentColor" className="orb-spin orb-spin-slow" />
      </svg>
      <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[30px] leading-none">
        🤖
      </span>
    </>
  );
}

/** Menu dos 5 especialistas (aparece ao clicar no robô). Os que já têm janela aberta ficam marcados; clicar neles traz a janela para a frente. */
export function AgentMenu({ open, onPick }: { open: AgentId[]; onPick: (id: AgentId) => void }) {
  return (
    <ul role="menu" aria-label="Subagentes de Security" className="space-y-0.5">
      {SECURITY_AGENTS.map((a) => {
        const isOpen = open.includes(a.id);
        return (
          <li key={a.id} role="none">
            <button
              type="button"
              role="menuitem"
              data-open={isOpen ? "true" : undefined}
              onClick={() => onPick(a.id)}
              className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/5 ${isOpen ? "bg-accent/10" : ""}`}
            >
              <span className="text-lg leading-5" aria-hidden>
                {a.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-fg">{a.name}</span>
                <span className="block text-[11px] leading-snug text-mute">{a.summary}</span>
              </span>
              {isOpen && <span className="shrink-0 rounded-full border border-accent/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-accent">aberto</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Camada do modo Security: o botão do robô (arrastável) e as janelas de micro-chat dos subagentes.
 * - Clicar no robô abre o menu flutuante dos 5 especialistas; arrastar move o botão (a posição fica salva).
 * - Cada especialista abre na SUA janela, na mesma tela: dá para ter várias abertas ao mesmo tempo, cada uma com a conversa
 *   e a posição dela, arrastar uma sem mexer nas outras e falar com cada subagente separadamente. Tocar numa janela a traz para a frente.
 * - Nenhum painel sai da tela: o limite considera o tamanho real de cada um (inclusive nos cantos).
 * Usa a base do FloatingPanel (arrasto, vidro, borda luminosa), a mesma dos painéis do Nex.
 */
export default function SecurityAgentsLayer({
  conversationId,
  ensureConversation,
  model,
  ceiling,
  glass = true,
}: {
  conversationId: string | null;
  ensureConversation: () => Promise<string>;
  model: string;
  ceiling: number;
  glass?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ w: 0, h: 0 });
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const [menuOpen, setMenuOpen] = useState(false);
  // pilha das janelas abertas: a última está na frente
  const [order, setOrder] = useState<AgentId[]>([]);
  const [winPos, setWinPos] = useState<Partial<Record<AgentId, PanelPos>>>({});
  const [fabPos, setFabPos] = useState<PanelPos | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FAB_KEY) ?? "null");
      return saved && typeof saved.x === "number" && typeof saved.y === "number" ? saved : null;
    } catch {
      return null;
    }
  });
  const fabRef = useRef(fabPos);
  fabRef.current = fabPos;

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

  const fabAt: PanelPos = fabPos ?? { x: Math.max(16, bounds.w - 100), y: Math.max(56, bounds.h - 330) };

  function pick(id: AgentId) {
    if (!order.includes(id)) {
      // primeira vez: abre em cascata, uma pouco deslocada da anterior
      setWinPos((p) => ({ ...p, [id]: cascadePos(order.length, bounds, { w: WINDOW_W, h: WINDOW_H }) }));
    }
    setOrder((o) => openWindow(o, id));
    setMenuOpen(false);
  }

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-30" data-security-layer>
      {bounds.w > 0 && (
        <>
          <FloatingPanel
            title="Subagentes de Security"
            icon={<span aria-hidden>🤖</span>}
            orb={<RobotOrb />}
            open={menuOpen}
            onToggle={() => setMenuOpen((v) => !v)}
            pos={fabAt}
            bounds={bounds}
            onMove={setFabPos}
            onMoveEnd={() => {
              try {
                localStorage.setItem(FAB_KEY, JSON.stringify(fabRef.current));
              } catch {
                /* sem armazenamento: a posição vale só nesta sessão */
              }
            }}
            mobile={mobile}
            glass={glass}
            zIndex={90}
          >
            <AgentMenu open={order} onPick={pick} />
          </FloatingPanel>

          {/* ordem FIXA no DOM (a do catálogo); quem está na frente é decidido pelo z-index. Reordenar elementos no meio de um arrasto soltaria o ponteiro. */}
          {SECURITY_AGENTS.filter((a) => order.includes(a.id)).map((agent) => {
            const id = agent.id;
            return (
              <FloatingPanel
                key={id}
                title={agent.name}
                icon={<span aria-hidden>{agent.emoji}</span>}
                orb={null}
                open
                onToggle={() => setOrder((o) => closeWindow(o, id))}
                pos={winPos[id] ?? cascadePos(0, bounds, { w: WINDOW_W, h: WINDOW_H })}
                bounds={bounds}
                onMove={(p) => setWinPos((all) => ({ ...all, [id]: p }))}
                onMoveEnd={() => {}}
                mobile={mobile}
                glass={glass}
                width={WINDOW_W}
                closeGlyph="✕"
                closeTitle="Fechar"
                zIndex={windowZ(order, id)}
                onFocus={() => setOrder((o) => (o[o.length - 1] === id ? o : openWindow(o, id)))}
              >
                <SubagentChat agent={agent} conversationId={conversationId} ensureConversation={ensureConversation} model={model} ceiling={ceiling} />
              </FloatingPanel>
            );
          })}
        </>
      )}
    </div>
  );
}
