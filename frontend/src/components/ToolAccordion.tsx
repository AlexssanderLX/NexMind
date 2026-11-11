import { useState } from "react";
import type { ToolRun } from "../types";

function label(name: string) {
  if (name.startsWith("browser__")) return "Navegador";
  if (name.startsWith("arquivos__") || name === "arquivos") return "Arquivos";
  if (name === "pesquisa") return "Pesquisa";
  return "Ferramenta";
}

function short(name: string) {
  const i = name.indexOf("__");
  return i >= 0 ? name.slice(i + 2) : name;
}

export default function ToolAccordion({ tools }: { tools: ToolRun[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!tools.length) return null;
  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {tools.map((t, i) => (
        <div key={i} className="rounded-lg border border-white/10 bg-black/20 text-xs">
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-mute hover:text-fg"
          >
            <span>
              ⚡ [{label(t.name)}] {short(t.name)}
              <span className="ml-2 text-[10px] uppercase tracking-wide text-accent/80">{t.state}</span>
            </span>
            <span aria-hidden>{open === i ? "˄" : "˅"}</span>
          </button>
          {open === i && t.detail && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border-t border-white/10 px-3 py-2 text-[11px] leading-5 text-mute">
              {t.detail}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
