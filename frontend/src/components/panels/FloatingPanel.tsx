import { useRef, type ReactNode } from "react";

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
  open,
  onToggle,
  pos,
  bounds,
  onMove,
  onMoveEnd,
  mobile,
  glass,
  badge,
  children,
}: {
  title: string;
  icon: ReactNode;
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
  children: ReactNode;
}) {
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const clamp = (x: number, y: number, w: number): PanelPos => ({
    x: Math.max(0, Math.min(x, Math.max(0, bounds.w - w))),
    y: Math.max(0, Math.min(y, Math.max(0, bounds.h - 44))),
  });

  /** Arrasto por ponteiro; um toque/clique sem movimento conta como clique (`onClick`). */
  const dragProps = (onClick?: () => void, w = 44) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      onMove(clamp(d.ox + dx, d.oy + dy, w));
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.moved) onMoveEnd();
      else onClick?.();
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  });

  // painel aberto: não passa da borda direita (a bolinha continua no ponto salvo)
  const shown = clamp(pos.x, pos.y, PANEL_W);

  if (!open) {
    return (
      <div className="pointer-events-auto absolute z-30" style={{ left: pos.x, top: pos.y }} data-no-core>
        <button
          type="button"
          aria-label={`Abrir ${title}`}
          title={title}
          {...dragProps(onToggle)}
          className={`flex h-11 w-11 touch-none select-none items-center justify-center rounded-full border border-accent/40 text-accent shadow-[0_0_18px_rgba(34,211,238,0.16)] transition-colors hover:border-accent/80 hover:bg-accent/10 ${
            glass ? "bg-[#0a1424]/60 backdrop-blur-md" : "bg-[#0a1424]/95"
          }`}
        >
          {icon}
        </button>
      </div>
    );
  }

  return (
    <section
      aria-label={title}
      data-no-core
      className={`pointer-events-auto absolute z-30 w-72 max-w-[calc(100%-2rem)] rounded-2xl border border-accent/30 p-4 max-md:inset-x-4 max-md:bottom-4 max-md:top-auto max-md:w-auto max-md:max-w-none ${
        glass ? "bg-[#0a1424]/55 backdrop-blur-md" : "bg-[#0a1424]/95"
      } shadow-[0_0_32px_rgba(34,211,238,0.14),inset_0_1px_0_rgba(255,255,255,0.06)]`}
      style={mobile ? undefined : { left: shown.x, top: shown.y }}
    >
      <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
      <header
        className={`mb-3 flex touch-none select-none items-center justify-between gap-2 ${mobile ? "" : "cursor-grab active:cursor-grabbing"}`}
        {...(mobile ? {} : dragProps(undefined, PANEL_W))}
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
          title="Recolher em bolinha"
          aria-label={`Recolher ${title}`}
        >
          –
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
