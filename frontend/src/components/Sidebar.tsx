import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConversationSummary } from "../types";

const PanelIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16" />
  </svg>
);

const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export default function Sidebar({
  items,
  activeId,
  connected,
  connectionLabel,
  collapsed,
  onToggle,
  onNew,
  onSelect,
  onDelete,
  onRename,
  onSettings,
}: {
  onSettings: () => void;
  onRename: (id: string, title: string) => void;
  items: ConversationSummary[];
  activeId: string | null;
  connected: boolean;
  connectionLabel: string;
  collapsed: boolean;
  onToggle: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const dot = <span className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-emerald-400" : "bg-red-500"}`} />;

  // Renomear: lápis ou duplo clique no nome. Enter ou sair do campo salva; Esc cancela.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  const [draft, setDraft] = useState("");
  // Apagar: confirmação que diz o que some junto com a conversa
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);

  function startRename(c: ConversationSummary) {
    editingRef.current = c.id;
    setEditingId(c.id);
    setDraft(c.title);
  }

  function finishRename(c: ConversationSummary, save: boolean) {
    if (editingRef.current !== c.id) return; // já foi salvo ou cancelado (Enter/Esc seguidos do blur)
    editingRef.current = null;
    setEditingId(null);
    const title = draft.trim();
    if (save && title && title !== c.title) onRename(c.id, title);
  }

  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPendingDelete(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  return (
    <aside
      className={`relative z-10 flex shrink-0 flex-col overflow-hidden border-r border-accent/15 bg-gradient-to-b from-[#0f1c33] to-[#091020] transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-72"
      }`}
    >
      {collapsed ? (
        <div className="flex h-full flex-col items-center py-4">
          <button onClick={onToggle} title="Expandir barra lateral" className="rounded-lg p-2 text-mute hover:bg-white/5 hover:text-fg">
            <PanelIcon />
          </button>
          <button onClick={onNew} title="Nova conversa" className="mt-2 rounded-lg p-2 text-xl leading-none text-mute hover:bg-white/5 hover:text-accent">
            +
          </button>
          <div className="flex-1" />
          <button onClick={onSettings} title="Configurações" className="mb-2 rounded-lg p-2 text-mute hover:bg-white/5 hover:text-accent">
            <GearIcon />
          </button>
          <span title={connectionLabel} className="pb-1">
            {dot}
          </span>
        </div>
      ) : (
        <div className="flex h-full w-72 flex-col">
          <div className="flex items-center justify-between px-5 pb-2 pt-5">
            <div className="flex items-center gap-2 text-lg font-semibold tracking-wide">
              <span className="text-accent">✦</span> Nex
            </div>
            <button onClick={onToggle} title="Minimizar barra lateral" className="rounded-lg p-1.5 text-mute hover:bg-white/5 hover:text-fg">
              <PanelIcon />
            </button>
          </div>

          <div className="px-3 py-2">
            <button
              onClick={onNew}
              className="flex w-full items-center gap-3 rounded-lg border border-accent/20 px-3 py-2 text-sm hover:border-accent/50 hover:bg-accent/10"
            >
              <span className="text-base leading-none text-accent">+</span> Nova conversa
            </button>
          </div>

          <div className="px-5 pb-1 pt-3 text-xs font-medium text-mute">Recentes</div>
          <nav className="flex-1 overflow-y-auto px-3 pb-3">
            {items.length === 0 && <p className="px-2 py-1 text-xs text-mute">Nenhuma conversa ainda.</p>}
            {items.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center rounded-lg px-3 py-2 text-sm ${
                  c.id === activeId ? "bg-accent/10 text-accent" : "hover:bg-white/5"
                }`}
              >
                {editingId === c.id ? (
                  <input
                    autoFocus
                    value={draft}
                    maxLength={80}
                    aria-label="Novo nome da conversa"
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishRename(c, true);
                      if (e.key === "Escape") finishRename(c, false);
                    }}
                    onBlur={() => finishRename(c, true)}
                    className="min-w-0 flex-1 rounded border border-accent/40 bg-black/30 px-2 py-0.5 text-sm text-fg outline-none focus:border-accent"
                  />
                ) : (
                  <button
                    className="flex-1 truncate text-left"
                    onClick={() => onSelect(c.id)}
                    onDoubleClick={() => startRename(c)}
                    title={`${c.title} (duplo clique para renomear)`}
                  >
                    {c.title}
                  </button>
                )}
                {editingId !== c.id && (
                  <>
                    <button className="ml-2 hidden text-mute hover:text-accent group-hover:block" onClick={() => startRename(c)} title="Renomear">
                      ✎
                    </button>
                    <button className="ml-2 hidden text-mute hover:text-red-400 group-hover:block" onClick={() => setPendingDelete(c)} title="Apagar">
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
          </nav>

          <div className="border-t border-line px-3 pt-2">
            <button
              onClick={onSettings}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-mute hover:bg-white/5 hover:text-fg"
            >
              <GearIcon /> Configurações
            </button>
          </div>
          <div className="flex items-center gap-2 px-5 py-3 text-xs text-mute">
            {dot}
            {connectionLabel}
          </div>
        </div>
      )}

      {pendingDelete &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && setPendingDelete(null)}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="apagar-titulo"
              className="w-full max-w-md rounded-xl border border-red-400/30 bg-[#0f1c33] p-5 shadow-2xl"
            >
              <h2 id="apagar-titulo" className="text-base font-semibold">
                Apagar esta conversa?
              </h2>
              <p className="mt-1 truncate text-sm text-accent" title={pendingDelete.title}>
                {pendingDelete.title}
              </p>
              <p className="mt-3 text-sm">
                Isso apaga <strong>todos os dados registrados nela</strong>, e não só as mensagens:
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-mute">
                <li>o histórico das mensagens;</li>
                <li>o objetivo da conversa e os fatos comprovados;</li>
                <li>o caderno do Nex (hipóteses, planos e anotações).</li>
              </ul>
              <p className="mt-3 text-sm font-medium text-red-300">Não tem como desfazer.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  autoFocus
                  onClick={() => setPendingDelete(null)}
                  className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-white/5"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    onDelete(pendingDelete.id);
                    setPendingDelete(null);
                  }}
                  className="rounded-lg bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
                >
                  Apagar tudo
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </aside>
  );
}
