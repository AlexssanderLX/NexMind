import type { Conversation, ConversationSummary, Metrics, OllamaStatus, Settings, StreamEvent } from "./types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.status === 204 ? (undefined as T) : r.json();
}

export const api = {
  status: () => req<OllamaStatus>("/api/status"),
  metrics: () => req<Metrics>("/api/metrics"),
  list: () => req<ConversationSummary[]>("/api/conversations"),
  create: () => req<Conversation>("/api/conversations", { method: "POST" }),
  get: (id: string) => req<Conversation>(`/api/conversations/${id}`),
  remove: (id: string) => req<void>(`/api/conversations/${id}`, { method: "DELETE" }),
};

/** Envia a mensagem e entrega os eventos NDJSON conforme chegam. */
export async function streamChat(
  id: string,
  content: string,
  model: string,
  s: Settings,
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch(`/api/conversations/${id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      model,
      numCtx: s.numCtx,
      think: null, // quem decide é o modelo escolhido (instruct não pensa; o de raciocínio sempre pensa)
      system: s.system.trim() || null,
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Backend respondeu ${res.status}: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as StreamEvent);
    }
  }
}
