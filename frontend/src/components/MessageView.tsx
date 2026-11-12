import { memo } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Message } from "../types";
import TaskThinkingPill from "./TaskThinkingPill";

/** O Qwen às vezes usa \( \) e \[ \] em vez de $ $ e $$ $$; o remark-math só entende os cifrões. */
function normalizeMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`);
}

/** memo: só a mensagem que está chegando re-renderiza; as anteriores (e o markdown delas) ficam como estão. */
function MessageView({ m, streaming }: { m: Message; streaming?: boolean }) {
  if (m.role === "user") {
    // arquivos anexados vêm entre [[ARQUIVO nome]] … [[/ARQUIVO]]: mostra só um chip, não o texto inteiro
    const files: { name: string; chars: number }[] = [];
    const body = m.content
      .replace(/\[\[ARQUIVO ([^\]]*)\]\]\n([\s\S]*?)\n\[\[\/ARQUIVO\]\]\n*/g, (_, name: string, t: string) => {
        files.push({ name, chars: t.length });
        return "";
      })
      .trim();
    return (
      <div className="flex flex-col items-end gap-1.5" data-no-core data-color-card>
        {files.map((f, i) => (
          <div key={i} className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs">
            📎 {f.name} <span className="text-mute">· {f.chars} caracteres</span>
          </div>
        ))}
        {body && (
          <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-panel px-4 py-2.5 text-[15px] leading-relaxed">
            {body}
          </div>
        )}
      </div>
    );
  }

  const hasPill = (m.tools?.length ?? 0) > 0 || !!m.thinking;
  const live = !!streaming && !m.stats;

  // Action-first: o texto do Nex vem PRIMEIRO; a pílula de tarefa (ferramentas + raciocínio) fica logo abaixo, numa linha.
  return (
    <div className="text-[15px] leading-7" data-no-core data-color-card>
      {m.content ? (
        <div className="md break-words">
          <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}>
            {normalizeMath(m.content)}
          </Markdown>
        </div>
      ) : (
        streaming && !hasPill && <span className="text-mute">…</span>
      )}
      {streaming && m.content && <span className="inline-block h-4 w-1.5 animate-pulse bg-mute align-middle" />}

      {hasPill && <TaskThinkingPill tools={m.tools ?? []} thinking={m.thinking} live={live} />}

      {m.stats && (
        <div className="mt-3 text-xs text-mute">
          {m.model ? `${m.model} · ` : ""}
          {m.stats.outputTokens} tokens · {m.stats.tokensPerSec} tok/s · {m.stats.totalSeconds}s
          {m.stats.loadSeconds > 1 ? ` (carregar modelo: ${m.stats.loadSeconds}s)` : ""} · prompt{" "}
          {m.stats.promptTokens} tokens
        </div>
      )}
    </div>
  );
}

export default memo(MessageView);
