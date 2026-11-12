import { useEffect, useRef, useState } from "react";
import type { ToolRun } from "../types";
import { collapsedLine, pillState, toolLabel, toolShort, type PillState } from "../lib/taskSummary";

const SHELL: Record<PillState, string> = {
  running: "border-accent/40 bg-accent/10 text-fg",
  ok: "border-white/10 bg-white/5 text-mute hover:text-fg",
  warn: "border-amber-400/50 bg-amber-400/10 text-amber-200",
  error: "border-red-400/60 bg-red-500/10 text-red-200",
};

const CHIP: Record<string, string> = {
  concluida: "text-emerald-300",
  executando: "text-accent",
  carregando: "text-accent",
  falhou: "text-red-300",
  recusada: "text-amber-300",
};

/**
 * Pílula de tarefa: UMA linha, logo abaixo do texto do Nex. Junta o que antes eram dois blocos (ferramentas e raciocínio).
 * - Durante a resposta mostra o passo ao vivo ("⚡ [Navegador] lendo a página… · 💭 Planejando…").
 * - Depois de terminar fica recolhida ("⚡ 1 página lida · 💭 Raciocínio (140 tokens)") e só abre com clique.
 * - Se uma ferramenta falhar, ganha destaque vermelho ("⚠️ Falha na ação · Inspecionar erro"); aberta, mostra o erro daquela execução.
 */
export default function TaskThinkingPill({ tools, thinking, live }: { tools: ToolRun[]; thinking?: string | null; live: boolean }) {
  const [open, setOpen] = useState(false);
  // linhas abertas ou fechadas à mão; sem escolha, só as que falharam já vêm abertas (o erro é o que o usuário quer ver)
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  const reasoning = useRef<HTMLDivElement>(null);
  const text = thinking ?? "";
  const state = pillState(tools, live);

  useEffect(() => {
    const el = reasoning.current;
    if (el && open && live) el.scrollTop = el.scrollHeight;
  }, [text, open, live]);

  return (
    <div className="mt-3 text-xs" data-task-pill data-state={state}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-left transition-colors ${SHELL[state]}`}
      >
        {state === "running" && <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
        <span className="truncate">{collapsedLine(tools, text, live)}</span>
        <span aria-hidden className="shrink-0 opacity-70">
          {open ? "˄" : "˅"}
        </span>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-white/10 bg-black/25 backdrop-blur-md">
          {tools.length > 0 && (
            <ul className="divide-y divide-white/5">
              {tools.map((t, i) => {
                const failed = t.state === "falhou";
                const expanded = toggled[i] ?? failed;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => setToggled((o) => ({ ...o, [i]: !expanded }))}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-mute hover:text-fg"
                    >
                      <span className="truncate">
                        ⚡ [{toolLabel(t.name)}] {toolShort(t.name)}
                        {t.brief && <span className="ml-2 text-[11px] opacity-70">{t.brief}</span>}
                        <span className={`ml-2 text-[10px] uppercase tracking-wide ${CHIP[t.state] ?? "text-mute"}`}>{t.state}</span>
                      </span>
                      <span aria-hidden>{expanded ? "˄" : "˅"}</span>
                    </button>
                    {expanded && t.detail && (
                      <pre
                        className={`max-h-48 overflow-auto whitespace-pre-wrap break-all border-t border-white/5 px-3 py-2 text-[11px] leading-5 ${
                          failed ? "text-red-200" : "text-mute"
                        }`}
                      >
                        {t.detail}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {text.trim() && (
            <div className={tools.length > 0 ? "border-t border-white/10" : ""}>
              <div className="px-3 pt-2 text-[10px] uppercase tracking-wide text-mute/70">Raciocínio</div>
              <div ref={reasoning} className="max-h-48 overflow-y-auto whitespace-pre-wrap px-3 pb-2 leading-6 text-mute">
                {text}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
