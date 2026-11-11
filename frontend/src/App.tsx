import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamChat } from "./api";
import MessageView from "./components/MessageView";
import ResourceBar from "./components/ResourceBar";
import SettingsPanel from "./components/SettingsPanel";
import Sidebar from "./components/Sidebar";
import type { ConversationSummary, Message, Metrics, OllamaStatus, Settings } from "./types";

const DEFAULTS: Settings = { model: "qwen3:4b", numCtx: 4096, think: "auto", system: "" };

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
  const modelChecked = useRef(false);

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

  // Na primeira conexão: se o modelo salvo não está instalado, usa o primeiro instalado.
  useEffect(() => {
    if (modelChecked.current || !status?.connected || status.models.length === 0) return;
    modelChecked.current = true;
    if (!status.models.some((m) => m.name === settings.model))
      setSettings((s) => ({ ...s, model: status.models[0].name }));
  }, [status, settings.model]);

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

    let firstEvent = true;
    try {
      await streamChat(
        id,
        text,
        settings,
        (ev) => {
          if (firstEvent) {
            firstEvent = false;
            refreshList(); // a conversa já está salva com título: mostra na sidebar logo
          }
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

  const connected = !!status?.connected && !backendDown;
  const banner = backendDown
    ? "O backend não está respondendo (http://localhost:5080). Inicie com start.ps1."
    : status && !status.connected
      ? status.error
      : null;
  const title = conversations.find((c) => c.id === activeId)?.title ?? "Nova conversa";

  return (
    <div className="flex h-full">
      <Sidebar
        items={conversations}
        activeId={activeId}
        connected={connected}
        connectionLabel={
          backendDown ? "Backend desconectado" : connected ? `Ollama ${status?.version} conectado` : "Ollama desconectado"
        }
        onNew={newConversation}
        onSelect={select}
        onDelete={remove}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <header className="flex items-center justify-between px-6 py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="truncate text-sm font-medium">{title}</h1>
            <span className="shrink-0 text-xs text-mute">
              {settings.model} · ctx {settings.numCtx}
            </span>
          </div>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="rounded-lg px-3 py-1.5 text-xs text-mute hover:bg-white/5 hover:text-fg"
          >
            {showSettings ? "Fechar configurações" : "Configurações"}
          </button>
        </header>

        {banner && <div className="border-y border-red-900/60 bg-red-950/50 px-6 py-2 text-sm text-red-300">{banner}</div>}
        {showSettings && <SettingsPanel settings={settings} onChange={setSettings} status={status} />}
        <ResourceBar metrics={metrics} />

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 0 && (
              <div className="mt-24 text-center">
                <div className="text-4xl text-accent">✦</div>
                <h2 className="mt-4 text-2xl font-medium">Como posso ajudar?</h2>
                <p className="mt-2 text-sm text-mute">
                  {status?.connected && status.models.length === 0
                    ? `Nenhum modelo instalado. Rode: ollama pull ${settings.model}`
                    : "Escreva uma pergunta abaixo para começar."}
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <MessageView key={i} m={m} streaming={streaming && i === messages.length - 1 && m.role === "assistant"} />
            ))}
            {chatError && (
              <div className="rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">
                {chatError}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="px-6 pb-4">
          <form
            className="mx-auto max-w-3xl rounded-2xl border border-line bg-panel p-3 shadow-lg shadow-black/20"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              className="block max-h-48 min-h-[48px] w-full resize-none bg-transparent px-2 py-1 text-[15px] outline-none placeholder:text-mute"
              placeholder="Converse com o Nex…"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="mt-1 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="rounded-lg px-2 py-1 text-xs text-mute hover:bg-white/5 hover:text-fg"
                title="Abrir configurações"
              >
                {settings.model}
              </button>
              {streaming ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg text-bg hover:opacity-90"
                  title="Parar"
                >
                  ■
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-lg font-semibold text-white hover:opacity-90 disabled:opacity-30"
                  title="Enviar"
                >
                  ↑
                </button>
              )}
            </div>
          </form>
          <p className="mt-2 text-center text-[11px] text-mute">Nex roda localmente no seu computador, via Ollama.</p>
        </div>
      </main>
    </div>
  );
}
