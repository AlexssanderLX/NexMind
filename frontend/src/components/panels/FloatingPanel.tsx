import { useEffect, useRef, useState, type ReactNode } from "react";
import { clampWindow } from "../../lib/geometry";
import { ORB_SIZE } from "./Orb";

export interface PanelPos {
  x: number;
  y: number;
}

const PANEL_W = 288; // w-72

/**
 * Painel flutuante reutilizável (glassmorphism discreto, borda luminosa).
 * Fechado, vira uma bolinha com ícone; clicar nela abre o painel exatamente no lugar dela. Tanto a bolinha quanto o
 * cabeçalho do painel podem ser arrastados para qualquer ponto da área (a posição fica salva).
 * Em telas pequenas, aberto vira uma folha na base da área de conversa.
 */
export default function FloatingPanel({
  title,
  icon,
  orb,
  open,
  onToggle,
  pos,
  bounds,
  onMove,
  onMoveEnd,
  mobile,
  glass,
  badge,
  width = PANEL_W,
  closeGlyph = "–",
  closeTitle,
  zIndex,
  onFocus,
  children,
}: {
  title: string;
  icon: ReactNode;
  /** desenho da bolinha quando o painel está recolhido */
  orb: ReactNode;
  open: boolean;
  onToggle: () => void;
  pos: PanelPos;
  /** tamanho da área em que os painéis podem ficar */
  bounds: { w: number; h: number };
  onMove: (p: PanelPos) => void;
  onMoveEnd: () => void;
  mobile: boolean;
  glass: boolean;
  badge?: string;
  /** largura do painel aberto (padrão 288). Janelas de conversa usam mais. */
  width?: number;
  /** glifo do botão do cabeçalho: "–" recolhe em bolinha; janelas sem bolinha usam "✕". */
  closeGlyph?: string;
  closeTitle?: string;
  /** várias janelas abertas ao mesmo tempo: a da frente tem o z-index maior */
  zIndex?: number;
  /** chamado ao tocar na janela (para trazê-la para a frente) */
  onFocus?: () => void;
  children: ReactNode;
}) {
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);

  // O painel aberto é medido de verdade: o limite de tela tem de reservar a ALTURA e a LARGURA dele, não as de uma bolinha.
  useEffect(() => {
    if (!open) {
      setMeasured(null);
      return;
    }
    const el = sectionRef.current;
    if (!el) return;
    const read = () => setMeasured({ w: el.offsetWidth, h: el.offsetHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const orbSize = { w: ORB_SIZE, h: ORB_SIZE };
  const panelSize = { w: measured?.w ?? width, h: measured?.h ?? ORB_SIZE };
  // onde cada um aparece de fato (inteiro dentro da área, mesmo se a janela encolher depois de salvo o ponto)
  const orbShown = clampWindow(pos, bounds, orbSize);
  const shown = clampWindow(pos, bounds, panelSize);

  /** Arrasto por ponteiro; um toque/clique sem movimento conta como clique (`onClick`). Parte do ponto onde o elemento APARECE. */
  const dragProps = (onClick: (() => void) | undefined, size: { w: number; h: number }, origin: PanelPos) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { sx: e.clientX, sy: e.clientY, ox: origin.x, oy: origin.y, moved: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      if (!d.moved) setDragging(true);
      d.moved = true;
      onMove(clampWindow({ x: d.ox + dx, y: d.oy + dy }, bounds, size));
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      setDragging(false);
      if (!d) return;
      if (d.moved) onMoveEnd();
      else onClick?.();
    },
    onPointerCancel: () => {
      drag.current = null;
      setDragging(false);
    },
  });

  if (!open) {
    return (
      <div className="pointer-events-auto absolute z-30" style={{ left: orbShown.x, top: orbShown.y }} data-no-core>
        <button
          type="button"
          aria-label={`Abrir ${title}`}
          title={title}
          {...dragProps(onToggle, orbSize, orbShown)}
          style={{ width: ORB_SIZE, height: ORB_SIZE }}
          className={`orb-btn group relative touch-none select-none rounded-full ${dragging ? "dragging" : ""}`}
        >
          {orb}
          <span className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-accent opacity-0 transition-opacity group-hover:opacity-100">
            {title}
          </span>
        </button>
      </div>
    );
  }

  return (
    <section
      ref={sectionRef}
      aria-label={title}
      onPointerDownCapture={onFocus}
      data-no-core
      className={`pointer-events-auto absolute z-30 w-72 max-w-[calc(100%-2rem)] rounded-2xl border border-accent/30 p-4 max-md:inset-x-4 max-md:bottom-4 max-md:top-auto max-md:w-auto max-md:max-w-none ${
        glass ? "bg-[#0a1424]/55 backdrop-blur-md" : "bg-[#0a1424]/95"
      } shadow-[0_0_32px_rgba(34,211,238,0.14),inset_0_1px_0_rgba(255,255,255,0.06)]`}
      style={mobile ? { zIndex } : { left: shown.x, top: shown.y, width, zIndex }}
    >
      <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
      <header
        className={`mb-3 flex touch-none select-none items-center justify-between gap-2 ${mobile ? "" : "cursor-grab active:cursor-grabbing"}`}
        {...(mobile ? {} : dragProps(undefined, panelSize, shown))}
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-accent">{icon}</span>
          {title}
          {badge && (
            <span className="rounded-full border border-amber-400/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-300">
              {badge}
            </span>
          )}
        </h2>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggle}
          className="rounded-lg px-2 text-mute hover:bg-white/5 hover:text-fg"
          title={closeTitle ?? "Recolher em bolinha"}
          aria-label={closeTitle ? `${closeTitle} ${title}` : `Recolher ${title}`}
        >
          {closeGlyph}
        </button>
      </header>
      <div className="text-xs">{children}</div>
    </section>
  );
}

export function PanelRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-mute">{label}</span>
      <span className="text-right text-fg">{value}</span>
    </div>
  );
}
