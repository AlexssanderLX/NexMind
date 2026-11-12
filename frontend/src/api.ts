import type { Conversation, ConversationSummary, Metrics, OllamaStatus, Settings, StreamEvent, VoiceStatus } from "./types";

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
  /** Histórico do micro-chat de um especialista de Security e as notas dele. */
  subagent: (conversationId: string, agent: string) =>
    req<{ agent: string; messages: { role: "user" | "assistant"; content: string }[]; notes: string }>(
      `/api/conversations/${conversationId}/security/${agent}`,
    ),
  rename: (id: string, title: string) =>
    req<{ id: string; title: string }>(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  voiceStatus: () => req<VoiceStatus>("/api/voice/status"),
  /** Resposta do usuário a uma ferramenta que pede aprovação (Autorizar/Rejeitar). */
  approve: (id: string, approve: boolean) =>
    req<void>(`/api/approvals/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve }) }),
  /** Lê um arquivo (PDF, DOCX, md, texto, código...) no backend e devolve o texto, cortado em maxChars. */
  readFile: async (file: File, maxChars: number) => {
    const body = new FormData();
    body.append("file", file);
    const r = await fetch(`/api/files/read?maxChars=${maxChars}`, { method: "POST", body });
    if (!r.ok) {
      const t = await r.json().catch(() => null);
      throw new Error(t?.detail ?? t?.title ?? `${r.status} ${r.statusText}`);
    }
    return (await r.json()) as { name: string; text: string; chars: number; truncated: boolean };
  },
};

/** Envia a mensagem e entrega os eventos NDJSON conforme chegam. */
export async function streamChat(
  id: string,
  content: string,
  model: string,
  s: Settings,
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
  search = false,
  tools = false,
  browser = false,
  desktop = false,
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
      search,
      tools,
      browser,
      desktop,
    }),
    signal,
  });
  await readNdjson(res, onEvent);
}

/** Lê uma resposta NDJSON (uma linha de JSON por evento) e entrega cada evento. */
async function readNdjson(res: Response, onEvent: (e: StreamEvent) => void) {
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

/** Micro-chat de um subagente de Security: o mesmo modelo local, com o prompt focado na especialidade dele. */
export async function streamSubagent(
  conversationId: string,
  agent: string,
  content: string,
  model: string,
  numCtx: number,
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch(`/api/conversations/${conversationId}/security/${agent}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, model, numCtx }),
    signal,
  });
  await readNdjson(res, onEvent);
}
