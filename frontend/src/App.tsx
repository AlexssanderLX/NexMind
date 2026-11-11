import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamChat } from "./api";
import MessageView from "./components/MessageView";
import ResourceBar from "./components/ResourceBar";
import SettingsPanel from "./components/SettingsPanel";
import Sidebar from "./components/Sidebar";
import type { ConversationSummary, Message, Metrics, OllamaStatus, Settings } from "./types";

const DEFAULTS: Settings = { model: "qwen3:8b", numCtx: 4096, think: "auto", system: "" };

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("settings") ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export default function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [backendDown, setBackendDown] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshList = useCallback(() => api.list().then(setConversations).catch(() => {}), []);

  useEffect(() => {
    localStorage.setItem("settings", JSON.stringify(settings));
  }, [settings]);

  // Conexão com o Ollama (a cada 5s) e consumo de recursos (a cada 2s)
  useEffect(() => {
    const poll = async () => {
      try {
        setStatus(await api.status());
        setBackendDown(false);
      } catch {
        setBackendDown(true);
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const poll = () => api.metrics().then(setMetrics).catch(() => setMetrics(null));
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function select(id: string) {
    if (streaming) return;
    setChatError(null);
    try {
      const c = await api.get(id);
      setActiveId(id);
      setMessages(c.messages);
    } catch (e) {
      setChatError(`Não foi possível abrir a conversa: ${(e as Error).message}`);
    }
  }

  async function newConversation() {
    if (streaming) return;
    setChatError(null);
    if (activeId && messages.length === 0) return; // já está numa conversa vazia
    try {
      const c = await api.create();
      setActiveId(c.id);
      setMessages([]);
      refreshList();
    } catch (e) {
      setChatError(`Não foi possível criar a conversa: ${(e as Error).message}`);
    }
  }

  async function remove(id: string) {
    await api.remove(id).catch(() => {});
    if (id === activeId) {
      setActiveId(null);
      setMessages([]);
    }
    refreshList();
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setChatError(null);

    let id = activeId;
    try {
      if (!id) {
        id = (await api.create()).id;
        setActiveId(id);
      }
    } catch (e) {
      setChatError(`Backend indisponível: ${(e as Error).message}`);
      return;
    }

    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;

    const patchLast = (fn: (m: Message) => Message) =>
      setMessages((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));

    try {
      await streamChat(
        id,
        text,
        settings,
        (ev) => {
          if (ev.type === "token") patchLast((m) => ({ ...m, content: m.content + ev.text }));
          else if (ev.type === "thinking") patchLast((m) => ({ ...m, thinking: (m.thinking ?? "") + ev.text }));
          else if (ev.type === "done") patchLast((m) => ({ ...m, stats: ev.stats }));
          else if (ev.type === "error") setChatError(ev.message);
        },
        abort.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setChatError(`Falha na conexão com o backend: ${(e as Error).message}`);
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Sincroniza com o que foi salvo no servidor (inclui parciais e a pergunta mesmo em caso de erro)
      api.get(id).then((c) => setMessages(c.messages)).catch(() => {});
      refreshList();
    }
  }

  const connected = status?.connected && !backendDown;
  const banner = backendDown
    ? "Backend não está respondendo (http://localhost:5080). Inicie com start.ps1."
    : status && !status.connected
      ? status.error
      : null;

  return (
    <div className="flex h-screen">
      <Sidebar items={conversations} activeId={activeId} onNew={newConversation} onSelect={select} onDelete={remove} />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
          <div className="flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
            <span className="text-neutral-300">
              {connected ? `Ollama ${status?.version} conectado` : "Ollama desconectado"}
            </span>
            <span className="text-neutral-600">· {settings.model} · ctx {settings.numCtx}</span>
          </div>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
          >
            {showSettings ? "Fechar configurações" : "Configurações"}
          </button>
        </header>

        {banner && <div className="border-b border-red-900 bg-red-950/60 px-4 py-2 text-sm text-red-300">{banner}</div>}
        {showSettings && <SettingsPanel settings={settings} onChange={setSettings} status={status} />}
        <ResourceBar metrics={metrics} />

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <p className="mt-20 text-center text-sm text-neutral-600">
              {status?.connected && status.models.length === 0
                ? `Nenhum modelo instalado. Rode: ollama pull ${settings.model}`
                : "Escreva uma pergunta para começar."}
            </p>
          )}
          {messages.map((m, i) => (
            <MessageView key={i} m={m} streaming={streaming && i === messages.length - 1 && m.role === "assistant"} />
          ))}
          {chatError && (
            <div className="rounded border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
              {chatError}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="flex gap-2 border-t border-neutral-800 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            placeholder="Pergunte algo… (Enter envia, Shift+Enter quebra linha)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded bg-red-700 px-4 text-sm hover:bg-red-600"
            >
              Parar
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="rounded bg-blue-600 px-4 text-sm hover:bg-blue-500 disabled:opacity-40">
              Enviar
            </button>
          )}
        </form>
      </main>
    </div>
  );
}
