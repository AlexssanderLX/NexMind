import type { ReactNode } from "react";

export type PanelAnchor = "tl" | "tr" | "bl" | "br";

const POSITION: Record<PanelAnchor, string> = {
  tl: "left-4 top-14",
  tr: "right-4 top-14",
  bl: "bottom-4 left-4",
  br: "bottom-4 right-4",
};

/**
 * Painel flutuante reutilizável (glassmorphism discreto, borda luminosa, entrada e saída animadas).
 * Hoje mostra dados do Nex; pensado para ferramentas, tarefas, logs e estado de agentes no futuro:
 * quem precisar de um painel novo só cria o conteúdo e escolhe o canto.
 * Em telas pequenas vira uma folha na base da área de conversa.
 */
export default function FloatingPanel({
  title,
  open,
  onClose,
  anchor,
  glass,
  badge,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  anchor: PanelAnchor;
  glass: boolean;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-hidden={!open}
      inert={!open}
      aria-label={title}
      data-no-core
      className={`pointer-events-auto absolute z-30 w-72 max-w-[calc(100%-2rem)] rounded-2xl border border-accent/30 p-4 transition-all duration-300 ease-out max-md:inset-x-4 max-md:bottom-4 max-md:top-auto max-md:w-auto max-md:max-w-none ${
        POSITION[anchor]
      } ${glass ? "bg-[#0a1424]/55 backdrop-blur-md" : "bg-[#0a1424]/95"} shadow-[0_0_32px_rgba(34,211,238,0.14),inset_0_1px_0_rgba(255,255,255,0.06)] ${
        open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-3 scale-95 opacity-0"
      }`}
    >
      <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {badge && (
            <span className="rounded-full border border-amber-400/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-300">
              {badge}
            </span>
          )}
        </h2>
        <button onClick={onClose} className="rounded-lg px-1.5 text-mute hover:bg-white/5 hover:text-fg" title="Fechar">
          ✕
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
