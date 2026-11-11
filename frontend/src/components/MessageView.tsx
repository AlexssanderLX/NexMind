import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../types";

export default function MessageView({ m, streaming }: { m: Message; streaming?: boolean }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-panel px-4 py-2.5 text-[15px] leading-relaxed">
          {m.content}
        </div>
      </div>
    );
  }

  const thinkingNow = streaming && !m.content;
  return (
    <div className="text-[15px] leading-7">
      {m.thinking && (
        <details className="mb-3 text-sm text-mute" open={thinkingNow}>
          <summary className="cursor-pointer select-none hover:text-fg">
            {thinkingNow ? "Pensando…" : "Raciocínio"}
          </summary>
          <div className="mt-2 whitespace-pre-wrap border-l-2 border-line pl-3 leading-6">{m.thinking}</div>
        </details>
      )}

      {m.content ? (
        <div className="md break-words">
          <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
        </div>
      ) : (
        streaming && !m.thinking && <span className="text-mute">…</span>
      )}
      {streaming && m.content && <span className="inline-block h-4 w-1.5 animate-pulse bg-mute align-middle" />}

      {m.stats && (
        <div className="mt-3 text-xs text-mute">
          {m.stats.outputTokens} tokens · {m.stats.tokensPerSec} tok/s · {m.stats.totalSeconds}s
          {m.stats.loadSeconds > 1 ? ` (carregar modelo: ${m.stats.loadSeconds}s)` : ""} · prompt{" "}
          {m.stats.promptTokens} tokens
        </div>
      )}
    </div>
  );
}
