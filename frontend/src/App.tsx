import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamChat } from "./api";
import Background from "./components/Background";
import MessageView from "./components/MessageView";
import MetricsModal, { loadColor, loadPercent } from "./components/MetricsModal";
import NexStage from "./components/NexStage";
import SettingsPanel from "./components/SettingsPanel";
import Sidebar from "./components/Sidebar";
import { useNexCore } from "./hooks/useNexCore";
import { usePolling } from "./hooks/usePolling";
import { createTokenBuffer } from "./lib/tokenBuffer";
import type { ConversationSummary, Message, Metrics, OllamaStatus, Settings } from "./types";

const DEFAULTS: Settings = {
  chatModel: "qwen3:4b-instruct",
  reasoningModel: "qwen3:4b",
  numCtx: 4096,
  system: "",
};

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem("settings") ?? "{}");
    // só as chaves atuais: configurações antigas (model/think) são ignoradas
    return {
      chatModel: saved.chatModel ?? DEFAULTS.chatModel,
      reasoningModel: saved.reasoningModel ?? DEFAULTS.reasoningModel,
      numCtx: saved.numCtx ?? DEFAULTS.numCtx,
      system: saved.system ?? DEFAULTS.system,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Preferências de interface (sidebar, animação) guardadas no navegador. */
const flag = {
  get(key: string, fallback: boolean) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === "1";
    } catch {
      return fallback;
    }
  },
  set(key: string, value: boolean) {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch {
      /* sem armazenamento: tudo bem */
    }
  },
};

export default function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => flag.get("sidebarCollapsed", false));
  const [bgAnim, setBgAnim] = useState(() => flag.get("bgAnim", true));
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [backendDown, setBackendDown] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [reasoning, setReasoning] = useState(false);
  const activeModel = reasoning ? settings.reasoningModel : settings.chatModel;
  const modelMissing = !!status?.connected && !status.models.some((m) => m.name === activeModel);
  const nex = useNexCore({ streaming, bgAnim });

  const refreshList = useCallback(() => api.list().then(setConversations).catch(() => {}), []);

  useEffect(() => {
    localStorage.setItem("settings", JSON.stringify(settings));
  }, [settings]);

  // Conexão com o Ollama (a cada 10 s) e consumo (10 s só para a cor da bolinha; 1,5 s com o modal aberto).
  // As consultas pausam com a aba escondida.
  usePolling(async () => {
    try {
      setStatus(await api.status());
      setBackendDown(false);
    } catch {
      setBackendDown(true);
    }
  }, 10_000);

  usePolling(() => api.metrics().then(setMetrics).catch(() => setMetrics(null)), showMetrics ? 1_500 : 10_000);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function toggleSidebar() {
    setSidebarCollapsed((c) => {
      flag.set("sidebarCollapsed", !c);
      return !c;
    });
  }

  function changeBgAnim(v: boolean) {
    setBgAnim(v);
    flag.set("bgAnim", v);
  }

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

    // tokens em lotes (ver lib/tokenBuffer): re-renderizar a cada token é o maior custo do streaming
    const buffer = createTokenBuffer((c, t) => {
      patchLast((m) => ({ ...m, content: m.content + c, thinking: t ? (m.thinking ?? "") + t : m.thinking }));
      nex.pulse(0.25); // o núcleo reage a cada lote de tokens
    });

    let failed = false;
    let firstEvent = true;
    try {
      await streamChat(
        id,
        text,
        activeModel,
        settings,
        (ev) => {
          if (firstEvent) {
            firstEvent = false;
            refreshList(); // a conversa já está salva com título: mostra na sidebar logo
          }
          if (ev.type === "token") buffer.push("content", ev.text);
          else if (ev.type === "thinking") buffer.push("thinking", ev.text);
          else if (ev.type === "done") {
            buffer.flush();
            patchLast((m) => ({ ...m, stats: ev.stats }));
          } else if (ev.type === "error") {
            failed = true;
            buffer.flush();
            setChatError(ev.message);
          }
        },
        abort.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        failed = true;
        setChatError(`Falha na conexão com o backend: ${(e as Error).message}`);
      }
    } finally {
      buffer.flush(); // parada/queda: entrega o que já chegou
      setStreaming(false);
      if (failed) nex.flash("error");
      else if (!abort.signal.aborted) nex.flash("success"); // parada pelo usuário não é sucesso nem erro
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
  const load = loadPercent(metrics);
  // execuções recentes: respostas desta conversa com as estatísticas reais devolvidas pelo Ollama
  const runs = messages
    .filter((m) => m.role === "assistant" && m.stats)
    .slice(-5)
    .reverse()
    .map((m) => ({
      model: m.model ?? "modelo",
      tokens: m.stats!.outputTokens,
      tokPerSec: m.stats!.tokensPerSec,
      seconds: m.stats!.totalSeconds,
    }));

  return (
    <div className="relative flex h-full">
      {/* fundo 2D: só como plano B se o WebGL do núcleo não estiver disponível */}
      {nex.fallback && <Background enabled={bgAnim} active={streaming} />}

      <Sidebar
        items={conversations}
        activeId={activeId}
        connected={connected}
        connectionLabel={
          backendDown ? "Backend desconectado" : connected ? `Ollama ${status?.version} conectado` : "Ollama desconectado"
        }
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        onNew={newConversation}
        onSelect={select}
        onDelete={remove}
      />

      {/* sem z-index aqui: um z-index criaria um contexto de empilhamento isolado e o canvas do núcleo (mix-blend-mode: screen) não conseguiria se misturar com o fundo da página */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-6 py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="truncate text-sm font-medium">{title}</h1>
            <span className="shrink-0 text-xs text-mute max-sm:hidden">
              {activeModel} · ctx {settings.numCtx}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setShowSettings((s) => !s)}
              className="rounded-lg px-3 py-1.5 text-xs text-mute hover:bg-white/5 hover:text-fg"
            >
              {showSettings ? "Fechar configurações" : "Configurações"}
            </button>
            <button
              onClick={() => setShowMetrics(true)}
              title="Consumo do sistema"
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-accent/30 bg-panel/80 text-accent hover:border-accent hover:bg-accent/10"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h4l3-8 4 16 3-8h4" />
              </svg>
              <span
                className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-[#070d1a] ${
                  metrics ? loadColor(load) : "bg-mute"
                }`}
              />
            </button>
          </div>
        </header>

        {banner && <div className="border-y border-red-900/60 bg-red-950/70 px-6 py-2 text-sm text-red-300">{banner}</div>}
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            status={status}
            bgAnim={bgAnim}
            onBgAnim={changeBgAnim}
            core={nex.settingsProps}
          />
        )}

        <NexStage
          core={nex}
          empty={messages.length === 0}
          streaming={streaming}
          hero={
            <>
              <h2 className="text-2xl font-medium">Como posso ajudar?</h2>
              <p className="mt-2 text-sm text-mute">
                {status?.connected && status.models.length === 0
                  ? `Nenhum modelo instalado. Rode: ollama pull ${activeModel}`
                  : nex.micOn
                    ? "Estou ouvindo: o núcleo reage ao seu microfone."
                    : "Escreva uma pergunta abaixo ou clique no núcleo para mudar a cor."}
              </p>
            </>
          }
          info={{ mode: reasoning ? "Raciocínio" : "Conversa", model: activeModel, connected }}
          runs={runs}
          tools={[]}
        >
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.map((m, i) => (
              <MessageView key={i} m={m} streaming={streaming && i === messages.length - 1 && m.role === "assistant"} />
            ))}
            {chatError && (
              <div className="rounded-xl border border-red-900/60 bg-red-950/70 px-4 py-3 text-sm text-red-300">
                {chatError}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </NexStage>

        <div className="px-6 pb-4">
          <form
            className="mx-auto max-w-3xl rounded-2xl border border-accent/20 bg-panel/90 p-3 shadow-lg shadow-black/30 focus-within:border-accent/50"
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={reasoning}
                  onClick={() => setReasoning((r) => !r)}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    reasoning
                      ? "border-accent/60 bg-accent/15 text-accent"
                      : "border-line text-mute hover:bg-white/5 hover:text-fg"
                  }`}
                  title={reasoning ? "Raciocínio ligado: usa o modelo que pensa (mais lento)" : "Ligar raciocínio"}
                >
                  ✦ Raciocínio
                </button>
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="rounded-lg px-2 py-1 text-xs text-mute hover:bg-white/5 hover:text-fg"
                  title="Abrir configurações"
                >
                  {activeModel}
                </button>
              </div>
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
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-lg font-semibold text-bg hover:opacity-90 disabled:opacity-30"
                  title="Enviar"
                >
                  ↑
                </button>
              )}
            </div>
          </form>
          {modelMissing ? (
            <p className="mt-2 text-center text-[11px] text-red-400">
              O modelo "{activeModel}" não está instalado. Rode: ollama pull {activeModel}
            </p>
          ) : (
            <p className="mt-2 text-center text-[11px] text-mute">Nex roda localmente no seu computador, via Ollama.</p>
          )}
        </div>
      </main>

      {showMetrics && <MetricsModal metrics={metrics} onClose={() => setShowMetrics(false)} />}
    </div>
  );
}
