import { useEffect, useRef, useState } from "react";

/** Card de raciocínio: aberto enquanto a resposta chega, recolhido quando ela termina. */
export default function ThinkingCard({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const tokens = Math.max(1, Math.round(text.length / 4));

  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);

  useEffect(() => {
    const el = scroller.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [text, open]);

  return (
    <div className="mb-3 rounded-xl border border-white/10 bg-white/5 text-sm text-mute backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:text-fg"
      >
        <span>{streaming && open ? "💭 Raciocínio do Nex" : `💭 Raciocínio (${tokens} tokens)`}</span>
        <span aria-hidden>{open ? "˄" : "˅"}</span>
      </button>
      {open && (
        <div ref={scroller} className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-white/10 px-3 py-2 leading-6">
          {text}
        </div>
      )}
    </div>
  );
}
