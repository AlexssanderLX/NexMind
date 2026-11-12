import { useMemo, useState } from "react";

const KEYWORDS = new Set("if else return const let var class public private async await function import export from new void string int bool for while try catch throw interface record namespace using type".split(" "));

function paint(line: string) {
  const parts: { text: string; kind: string }[] = [];
  const re = /("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\/\/.*|\/\*[\s\S]*?\*\/|\b[A-Za-z_][\w]*\b|\s+|.)/g;
  for (const m of line.matchAll(re)) {
    const text = m[0];
    const kind = text.startsWith("//") || text.startsWith("/*") ? "comment" : text.startsWith('"') || text.startsWith("'") || text.startsWith("`") ? "string" : KEYWORDS.has(text) ? "key" : "plain";
    parts.push({ text, kind });
  }
  return parts;
}

export type DevTab = { path: string; content: string; dirty: boolean };

export default function DevCodeViewer({
  tabs,
  active,
  onSelect,
  onClose,
  onChange,
  onSave,
}: {
  tabs: DevTab[];
  active: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
}) {
  const tab = tabs.find((t) => t.path === active) ?? null;
  const lines = useMemo(() => (tab ? tab.content.split("\n") : []), [tab]);
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[#0f1420]">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 px-2">
        {tabs.length === 0 && <span className="px-2 py-2 text-xs text-mute">Nenhum arquivo aberto</span>}
        {tabs.map((t) => (
          <div key={t.path} className={`flex items-center rounded-t border-b-2 ${t.path === active ? "border-accent text-fg" : "border-transparent text-mute"}`}>
            <button type="button" onClick={() => onSelect(t.path)} className="max-w-[180px] truncate px-2 py-2 text-xs" title={t.path}>
              {t.dirty ? "● " : ""}
              {t.path.split("/").pop()}
            </button>
            <button type="button" aria-label={`Fechar ${t.path}`} onClick={() => onClose(t.path)} className="pr-2 text-xs hover:text-fg">
              ×
            </button>
          </div>
        ))}
        {tab && (
          <button
            type="button"
            onClick={() => {
              onSave(tab.path);
              setSaved("salvo");
              window.setTimeout(() => setSaved(null), 1200);
            }}
            className="ml-auto shrink-0 rounded border border-accent/30 px-2 py-1 text-[11px] text-accent hover:bg-accent/10"
          >
            {saved ?? "Salvar"}
          </button>
        )}
      </div>
      {tab ? (
        <div className="flex min-h-0 flex-1 overflow-auto font-mono text-[12.5px] leading-5">
          <div className="sticky left-0 select-none border-r border-white/5 bg-[#0f1420] py-2 text-right text-mute">
            {lines.map((_, i) => (
              <div key={i} className="px-2">
                {i + 1}
              </div>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <pre className="pointer-events-none whitespace-pre px-3 py-2" aria-hidden>
              {lines.map((line, i) => (
                <div key={i}>
                  {line.length === 0 ? " " : paint(line).map((p, j) => (
                    <span key={j} className={p.kind === "comment" ? "text-emerald-600" : p.kind === "string" ? "text-amber-200" : p.kind === "key" ? "text-sky-300" : "text-fg"}>
                      {p.text}
                    </span>
                  ))}
                </div>
              ))}
            </pre>
            <textarea
              value={tab.content}
              spellCheck={false}
              aria-label={tab.path}
              onChange={(e) => onChange(tab.path, e.target.value)}
              className="absolute inset-0 resize-none bg-transparent px-3 py-2 text-transparent caret-white outline-none"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-mute">Abra um arquivo na árvore à esquerda.</div>
      )}
    </section>
  );
}
