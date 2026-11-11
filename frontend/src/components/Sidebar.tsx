import type { ConversationSummary } from "../types";

export default function Sidebar({
  items,
  activeId,
  onNew,
  onSelect,
  onDelete,
}: {
  items: ConversationSummary[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full rounded border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
        >
          + Nova conversa
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {items.length === 0 && <p className="px-2 text-xs text-neutral-600">Nenhuma conversa ainda.</p>}
        {items.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center rounded px-2 py-2 text-sm ${
              c.id === activeId ? "bg-neutral-800" : "hover:bg-neutral-900"
            }`}
          >
            <button className="flex-1 truncate text-left" onClick={() => onSelect(c.id)} title={c.title}>
              {c.title}
            </button>
            <button
              className="ml-2 hidden text-neutral-500 hover:text-red-400 group-hover:block"
              onClick={() => confirm("Apagar esta conversa?") && onDelete(c.id)}
              title="Apagar"
            >
              ✕
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}
