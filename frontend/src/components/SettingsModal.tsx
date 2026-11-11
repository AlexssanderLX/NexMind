import { useEffect, useState } from "react";
import SettingsPanel, { type SettingsPanelProps, type SettingsTab } from "./SettingsPanel";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "modelos", label: "Modelos" },
  { id: "nucleo", label: "Núcleo" },
  { id: "voz", label: "Voz" },
];

/** Janela pequena de configurações (abre pela barra lateral). Não ocupa a tela: tem altura máxima e rola por dentro. */
export default function SettingsModal({ onClose, ...panel }: Omit<SettingsPanelProps, "tab"> & { onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>("modelos");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Configurações"
    >
      <div
        className="flex max-h-[min(80vh,520px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-accent/20 bg-side shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-sm font-semibold">Configurações</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-mute hover:bg-white/5 hover:text-fg" title="Fechar (Esc)">
            ✕
          </button>
        </header>
        <nav className="flex gap-1 border-b border-line px-4 pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-lg px-3 py-1 text-xs transition-colors ${
                tab === t.id ? "bg-accent/15 text-accent" : "text-mute hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="overflow-y-auto px-5 py-4">
          <SettingsPanel tab={tab} {...panel} />
        </div>
      </div>
    </div>
  );
}
