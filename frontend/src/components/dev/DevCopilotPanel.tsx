import { useEffect, useRef, useState } from "react";
import { api, streamChat } from "../../api";
import type { Settings } from "../../types";
import { DEV_DOMAIN_PROMPT, DEV_MODEL, type DevDrawerKey } from "../../lib/devPrompt";

type Line = { role: "user" | "assistant"; content: string };

export default function DevCopilotPanel({
  settings,
  workspace,
  drawers,
  conversationId,
  selection,
}: {
  settings: Settings;
  workspace: string | null;
  drawers: Record<DevDrawerKey, string>;
  conversationId: string | null;
  selection: { text: string; start: number; end: number } | null;
}) {
  const [messages, setMessages] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    try {
      let chatId = conversationId;
      if (!chatId) {
        chatId = (await api.create("dev")).id;
        localStorage.setItem("nexDevConversation", chatId);
      } else {
        try { await api.get(chatId); }
        catch {
          chatId = (await api.create("dev")).id;
          localStorage.setItem("nexDevConversation", chatId);
        }
      }
      const memory = await api.metrics().catch(() => null);
      const ram = memory ? memory.machine.ramUsedMb / Math.max(1, memory.machine.ramTotalMb) : 0;
      const notes = (Object.entries(drawers) as [DevDrawerKey, string][])
        .filter(([, v]) => v.trim())
        .map(([k, v]) => `${k}:\n${v.slice(0, 1200)}`)
        .join("\n\n");
      const system = [
        settings.system.trim(),
        DEV_DOMAIN_PROMPT,
        workspace ? `Pasta aberta: ${workspace}` : "Nenhuma pasta aberta ainda.",
        notes ? `Gavetas do projeto:\n${notes}` : "",
        ram > 0.75 ? "A memória da máquina passou de 75%. Resuma e grave as decisões na gaveta de Arquitetura antes de continuar." : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const ctrl = new AbortController();
      await streamChat(chatId, text, DEV_MODEL, { ...settings, system }, (e) => {
        if (e.type === "token") {
          setMessages((m) => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + e.text };
            return copy;
          });
        }
        if (e.type === "error") setError(e.message);
        if (e.type === "approval") void api.approve(e.id, false);
      }, ctrl.signal, false, false, false, false, selection ?? undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no copilot.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex h-full w-full flex-col border-l border-white/5 bg-[#0b0f19]">
      <div className="border-b border-white/10 px-3 py-2">
        <p className="text-[11px] uppercase tracking-wide text-mute">Nex</p>
        <p className="truncate text-xs text-fg" title={DEV_MODEL}>
          {DEV_MODEL}
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3 text-sm">
        {messages.length === 0 && <p className="text-mute">Pergunte sobre o código da pasta aberta. O arquivo inteiro não entra no prompt.</p>}
        {messages.map((m, i) => (
          <p key={i} className={m.role === "user" ? "text-accent" : "whitespace-pre-wrap text-fg"}>
            {m.content || (busy && i === messages.length - 1 ? "…" : "")}
          </p>
        ))}
        <div ref={bottom} />
      </div>
      {error && <p className="px-3 text-[11px] text-red-300">{error}</p>}
      <form
        className="flex gap-2 border-t border-white/10 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte sobre o projeto"
          aria-label="Mensagem para o Nex Dev"
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy || !input.trim()} className="rounded bg-accent px-3 text-sm font-medium text-bg disabled:opacity-40">
          ↑
        </button>
      </form>
    </aside>
  );
}
