import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, streamSubagent } from "../api";
import { splitAttachments, type AgentId } from "../lib/securityAgents";

type Msg = { role: "user" | "assistant"; content: string; note?: string };
type Attachment = { name: string; text: string; truncated: boolean };

const MAX_ATTACH_CHARS = 12_000;

/**
 * Micro-chat de UM especialista: histórico exclusivo dele, um campo de texto e o clipe de arquivo. Sem áudio e sem botões extras:
 * a interface é mínima de propósito, para a conversa andar rápido. Usa o mesmo modelo local do Nex (mesma porta), com o prompt
 * focado só na especialidade (o backend monta o prompt; aqui só vai o texto).
 */
export default function SubagentChat({
  agent,
  conversationId,
  ensureConversation,
  model,
  ceiling,
}: {
  agent: { id: AgentId; name: string };
  conversationId: string | null;
  ensureConversation: () => Promise<string>;
  model: string;
  ceiling: number;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // histórico do especialista: vem do servidor (fica salvo na pasta da conversa) ao abrir ou ao trocar de especialista/conversa
  useEffect(() => {
    setMessages([]);
    setError(null);
    if (!conversationId) return;
    let cancelled = false;
    api
      .subagent(conversationId, agent.id)
      .then((h) => !cancelled && setMessages(h.messages.map((m) => ({ role: m.role, content: m.content }))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId, agent.id]);

  // fechar a janela (ou trocar de especialista) interrompe a resposta em andamento
  useEffect(() => () => abortRef.current?.abort(), [agent.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function attach(files: FileList | null) {
    if (!files?.length) return;
    setAttaching(true);
    setError(null);
    try {
      const picked = Array.from(files);
      const budget = Math.round(MAX_ATTACH_CHARS / picked.length);
      const read = await Promise.all(
        picked.map(async (f) => {
          const r = await api.readFile(f, budget);
          return { name: r.name, text: r.text, truncated: r.truncated };
        }),
      );
      setAttachments((a) => [...a, ...read]);
    } catch (e) {
      setError(`Não consegui ler o arquivo: ${(e as Error).message}`);
    } finally {
      setAttaching(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send() {
    const typed = input.trim();
    if ((!typed && attachments.length === 0) || streaming) return;
    const text =
      attachments.map((f) => `[[ARQUIVO ${f.name}]]\n${f.text}${f.truncated ? "\n[…arquivo cortado]" : ""}\n[[/ARQUIVO]]\n\n`).join("") +
      (typed || "Analise o arquivo anexado dentro da sua especialidade.");
    setInput("");
    setAttachments([]);
    setError(null);

    let id: string;
    try {
      id = conversationId ?? (await ensureConversation());
    } catch (e) {
      setError(`Backend indisponível: ${(e as Error).message}`);
      return;
    }

    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;
    const patchLast = (fn: (m: Msg) => Msg) => setMessages((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));
    try {
      await streamSubagent(
        id,
        agent.id,
        text,
        model,
        ceiling,
        (ev) => {
          if (ev.type === "token") patchLast((m) => ({ ...m, content: m.content + ev.text }));
          else if (ev.type === "mcp" && ev.name === "note_write" && ev.state === "concluida") patchLast((m) => ({ ...m, note: "📝 nota registrada" }));
          else if (ev.type === "mcp" && ev.name === "note_write" && ev.state === "falhou") patchLast((m) => ({ ...m, note: "⚠️ não consegui registrar a nota" }));
          else if (ev.type === "error") setError(ev.message);
        },
        abort.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(`Falha na conexão com o backend: ${(e as Error).message}`);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="h-72 space-y-3 overflow-y-auto rounded-lg border border-white/10 bg-black/25 p-2.5 text-[13px] leading-6" data-subagent-messages>
        {messages.length === 0 && (
          <p className="text-mute">
            Fale com o {agent.name}. Ele só trata da especialidade dele e anota as descobertas na pasta desta conversa.
          </p>
        )}
        {messages.map((m, i) => {
          if (m.role === "user") {
            const { files, body } = splitAttachments(m.content);
            return (
              <div key={i} className="flex flex-col items-end gap-1">
                {files.map((f, j) => (
                  <span key={j} className="rounded-lg border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px]">
                    📎 {f.name}
                  </span>
                ))}
                {body && <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-xl bg-panel px-3 py-1.5">{body}</div>}
              </div>
            );
          }
          return (
            <div key={i}>
              {m.content ? (
                <div className="md break-words">
                  <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                </div>
              ) : (
                streaming && i === messages.length - 1 && <span className="text-mute">…</span>
              )}
              {m.note && <div className="mt-1 text-[11px] text-emerald-300">{m.note}</div>}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {error && <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">{error}</p>}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {attachments.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px]">
              📎 {f.name}
              <button type="button" aria-label={`Remover ${f.name}`} className="text-mute hover:text-fg" onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => void attach(e.target.files)} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={attaching || streaming}
          title="Anexar trecho de código JS, requisição HTTP salva ou HTML"
          aria-label="Anexar arquivo"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-mute hover:border-accent/50 hover:text-accent disabled:opacity-40"
        >
          📎
        </button>
        <textarea
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={`Pergunte ao ${agent.name.split(" ")[0]}…`}
          aria-label={`Mensagem para o ${agent.name}`}
          className="max-h-24 min-h-9 w-full resize-none rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[13px] outline-none placeholder:text-mute focus:border-accent/50"
        />
        <button
          type="submit"
          disabled={streaming || (!input.trim() && attachments.length === 0)}
          aria-label="Enviar"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-bg hover:opacity-90 disabled:opacity-40"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
