import type { Message } from "../types";

export default function MessageView({ m, streaming }: { m: Message; streaming?: boolean }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 ${isUser ? "bg-blue-600/80" : "bg-neutral-900"}`}>
        {m.thinking && (
          <details className="mb-2 text-xs text-neutral-400" open={streaming && !m.content}>
            <summary className="cursor-pointer">Raciocínio</summary>
            <div className="mt-1 whitespace-pre-wrap border-l border-neutral-700 pl-2">{m.thinking}</div>
          </details>
        )}
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {m.content || (streaming && !m.thinking ? <span className="text-neutral-500">…</span> : "")}
          {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-neutral-400 align-middle" />}
        </div>
        {m.stats && (
          <div className="mt-2 text-[11px] text-neutral-500">
            {m.stats.outputTokens} tokens · {m.stats.tokensPerSec} tok/s · {m.stats.totalSeconds}s total
            {m.stats.loadSeconds > 1 ? ` (carregar modelo: ${m.stats.loadSeconds}s)` : ""} · prompt {m.stats.promptTokens} tokens
          </div>
        )}
      </div>
    </div>
  );
}
