import type { ConversationSummary } from "../types";

export default function Sidebar({
  items,
  activeId,
  connected,
  connectionLabel,
  onNew,
  onSelect,
  onDelete,
}: {
  items: ConversationSummary[];
  activeId: string | null;
  connected: boolean;
  connectionLabel: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col bg-side">
      <div className="flex items-center gap-2 px-5 pb-2 pt-5 text-lg font-semibold tracking-wide">
        <span className="text-accent">✦</span> Nex
      </div>

      <div className="px-3 py-2">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5"
        >
          <span className="text-base leading-none">+</span> Nova conversa
        </button>
      </div>

      <div className="px-5 pb-1 pt-3 text-xs font-medium text-mute">Recentes</div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {items.length === 0 && <p className="px-2 py-1 text-xs text-mute">Nenhuma conversa ainda.</p>}
        {items.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center rounded-lg px-3 py-2 text-sm ${
              c.id === activeId ? "bg-white/10" : "hover:bg-white/5"
            }`}
          >
            <button className="flex-1 truncate text-left" onClick={() => onSelect(c.id)} title={c.title}>
              {c.title}
            </button>
            <button
              className="ml-2 hidden text-mute hover:text-red-400 group-hover:block"
              onClick={() => confirm("Apagar esta conversa?") && onDelete(c.id)}
              title="Apagar"
            >
              ✕
            </button>
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-mute">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
        {connectionLabel}
      </div>
    </aside>
  );
}
