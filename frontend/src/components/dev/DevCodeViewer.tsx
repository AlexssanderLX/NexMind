import { useMemo, useRef, useState } from "react";
import NeuralCore from "../../core/NeuralCore";
import type { NexCore } from "../../hooks/useNexCore";
import { DEV_MODEL } from "../../lib/devPrompt";

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

/** Tela de boas-vindas (nenhum arquivo aberto): o Núcleo Orbital do Nex, a marca "Nex Dev" e o modelo em uso. */
export function DevWelcome({ core, model }: { core: NexCore; model: string }) {
  const hitRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={hitRef} className="relative flex flex-1 items-center justify-center overflow-hidden" data-dev-welcome>
      {core.enabled ? (
        <NeuralCore
          ref={core.coreRef}
          enabled
          profile={core.profile}
          state={core.state}
          palette={core.palette}
          follow={core.follow}
          presence="hero"
          getLevel={core.getLevel}
          hitRef={hitRef}
          onSphereClick={core.onSphereClick}
          onUnavailable={core.onUnavailable}
        />
      ) : (
        // sem WebGL: um orbe de CSS com o mesmo brilho neon
        <div aria-hidden className="absolute h-56 w-56 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffffff,#67e8f9_25%,#7c3aed_65%,#2e1065)] opacity-80 shadow-[0_0_80px_rgba(34,211,238,0.35)]" />
      )}
      <div className="pointer-events-none relative z-10 mt-72 flex flex-col items-center px-6 text-center">
        <h2 className="text-2xl font-semibold tracking-wide text-fg drop-shadow-[0_0_14px_rgba(34,211,238,0.5)]">Nex Dev</h2>
        <p className="mt-2 max-w-sm text-sm text-mute">Selecione um arquivo na árvore à esquerda para editar com o agente.</p>
        <span className="mt-3 rounded-full border border-accent/30 bg-black/30 px-3 py-1 font-mono text-[11px] text-accent">{model}</span>
      </div>
    </div>
  );
}

export default function DevCodeViewer({
  core,
  model = DEV_MODEL,
  tabs,
  active,
  onSelect,
  onClose,
  onChange,
  onSave,
  onSelection,
}: {
  core: NexCore;
  model?: string;
  tabs: DevTab[];
  active: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onSelection?: (text: string, start: number, end: number) => void;
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
          <div className="relative min-w-max self-start">
            <pre className="pointer-events-none select-none whitespace-pre px-3 py-2 font-mono text-[12.5px] leading-5" aria-hidden>
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
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
                  e.currentTarget.setSelectionRange(0, e.currentTarget.value.length);
                }
              }}
              onSelect={(e) => {
                const el = e.currentTarget;
                const text = el.value.slice(el.selectionStart, el.selectionEnd);
                if (!text) return;
                const start = el.value.slice(0, el.selectionStart).split("\n").length;
                const end = el.value.slice(0, el.selectionEnd).split("\n").length;
                onSelection?.(text, start, end);
              }}
              className="absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre bg-transparent px-3 py-2 font-mono text-[12.5px] leading-5 text-transparent caret-white outline-none"
            />
          </div>
        </div>
      ) : (
        <DevWelcome core={core} model={model} />
      )}
    </section>
  );
}
