import { useEffect, useRef, useState } from "react";
import type { MicroAppMode } from "../types";
import { WORKSPACES, workspaceOf } from "../lib/workspaces";

/**
 * Seletor compacto de workspace, na barra superior: `[ 🛡️ Security ▾ ]`. Um clique abre um menu pequeno logo abaixo com
 * Geral, Security e Dev; escolher um fecha o menu e troca de modo (a lista de conversas é a daquele modo).
 */
export default function WorkspaceSwitcher({ mode, onChange, disabled = false }: { mode: MicroAppMode; onChange: (mode: MicroAppMode) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = workspaceOf(mode);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0" data-no-core>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={disabled ? "Aguarde a resposta terminar para trocar de modo" : "Trocar de modo"}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-fg transition-colors hover:border-accent/50 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span aria-hidden>{current.icon}</span>
        <span>{current.name}</span>
        <span aria-hidden className={`text-[9px] text-mute transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <ul role="menu" aria-label="Modos do Nex" className="absolute left-0 top-full z-[60] mt-1 w-60 rounded-xl border border-white/10 bg-[#0a1424]/95 p-1 shadow-2xl backdrop-blur-xl">
          {WORKSPACES.map((w) => (
            <li key={w.mode} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={w.mode === mode}
                onClick={() => {
                  setOpen(false);
                  if (w.mode !== mode) onChange(w.mode);
                }}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-white/5 ${w.mode === mode ? "bg-accent/10" : ""}`}
              >
                <span className="text-base leading-5" aria-hidden>
                  {w.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-fg">{w.name}</span>
                  <span className="block text-[11px] leading-snug text-mute">{w.summary}</span>
                </span>
                {w.mode === mode && (
                  <span className="text-accent" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
