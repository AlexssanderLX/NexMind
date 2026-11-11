import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamChat } from "./api";
import Background from "./components/Background";
import MessageView from "./components/MessageView";
import MetricsModal, { loadColor, loadPercent } from "./components/MetricsModal";
import NexStage from "./components/NexStage";
import SettingsModal from "./components/SettingsModal";
import Sidebar from "./components/Sidebar";
import { useNexCore } from "./hooks/useNexCore";
import { usePolling } from "./hooks/usePolling";
import { useVoice } from "./hooks/useVoice";
import { createTokenBuffer } from "./lib/tokenBuffer";
import type { ConversationSummary, Message, Metrics, OllamaStatus, Settings, VoiceSettings, VoiceStatus, VoiceTimings } from "./types";

const VOICE_DEFAULTS: VoiceSettings = {
  enabled: false,
  mode: "auto",
  vadSilenceMs: 900,
  vadSensitivity: 0.06,
  speechRate: 1.15,
  sttEngine: "faster-whisper",
  ttsEngine: "piper",
  ttsVoice: "",
  inputDeviceId: "",
};

function loadVoice(): VoiceSettings {
  try {
    return { ...VOICE_DEFAULTS, ...JSON.parse(localStorage.getItem("voice-settings") ?? "{}") };
  } catch {
    return VOICE_DEFAULTS;
  }
}

const DEFAULTS: Settings = {
  chatModel: "qwen3:4b-instruct",
  reasoningModel: "qwen3:4b",
  numCtx: 32768,
  system: "",
};

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem("settings") ?? "{}");
    // só as chaves atuais: configurações antigas (model/think) são ignoradas
    return {
      chatModel: saved.chatModel ?? DEFAULTS.chatModel,
      reasoningModel: saved.reasoningModel ?? DEFAULTS.reasoningModel,
      numCtx: saved.numCtx && saved.numCtx !== 4096 ? saved.numCtx : DEFAULTS.numCtx,
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
  const [attachments, setAttachments] = useState<{ name: string; text: string; chars: number; truncated: boolean }[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [reasoning, setReasoning] = useState(false);
  const [searchOn, setSearchOn] = useState(() => localStorage.getItem("nexSearch") === "1");
  const [mcpOn, setMcpOn] = useState(() => localStorage.getItem("nexMcp") === "1");
  const [mcpState, setMcpState] = useState<"pronta" | "executando">("pronta");
  const [browserOn, setBrowserOn] = useState(() => localStorage.getItem("nexBrowser") === "1");
  const [browserState, setBrowserState] = useState<"pronta" | "executando">("pronta");
  const [approval, setApproval] = useState<{ id: string; tool: string; args: unknown; write?: boolean; warning?: string | null } | null>(null);
  const [searchState, setSearchState] = useState<"desligada" | "pronta" | "executando">("desligada");
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(loadVoice);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [timings, setTimings] = useState<VoiceTimings | null>(null);
  const sendRef = useRef<(text?: string, fromVoice?: boolean, heardAt?: number) => void>(() => {});

  const voice = useVoice({
    settings: voiceSettings,
    busy: streaming,
    onUtterance: (text, heardAt, spoken) => sendRef.current(text, spoken, heardAt),
    onInterrupt: () => abortRef.current?.abort(),
    onError: (message) => setVoiceNote(message),
  });

  useEffect(() => {
    localStorage.setItem("voice-settings", JSON.stringify(voiceSettings));
  }, [voiceSettings]);

  useEffect(() => {
    api.voiceStatus().then(setVoiceStatus).catch(() => setVoiceStatus(null));
  }, [showSettings]);
  const activeModel = reasoning ? settings.reasoningModel : settings.chatModel;
  const modelMissing = !!status?.connected && !status.models.some((m) => m.name === activeModel);
  const nex = useNexCore({
    streaming,
    bgAnim,
    mic: { active: voice.phase === "listening", toggle: () => {} },
  });

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

  // Rolagem: a conversa só acompanha a resposta enquanto você está no fim. Se você sobe para ler, ela para de te puxar;
  // ao voltar ao fim (ou ao enviar uma mensagem / trocar de conversa) ela volta a acompanhar.
  const stickRef = useRef(true);
  useEffect(() => {
    const box = bottomRef.current?.closest<HTMLElement>(".overflow-y-auto");
    if (!box) return;
    const onScroll = () => {
      stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    stickRef.current = true;
  }, [activeId]);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ block: "end" });
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

  async function rename(id: string, title: string) {
    try {
      const done = await api.rename(id, title);
      // atualiza na hora (o título do topo também), e confirma com a lista do servidor
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, title: done.title } : c)));
    } catch (e) {
      setChatError(`Não foi possível renomear: ${(e as Error).message}`);
    }
    refreshList();
  }

  async function send(textOverride?: string, fromVoice = false, heardAt = performance.now()) {
    const typed = (textOverride ?? input).trim();
    const files = textOverride ? [] : attachments; // anexos só vão em mensagens digitadas
    if ((!typed && files.length === 0) || streaming) return;
    // o arquivo vai junto da pergunta, entre marcadores que a tela usa para mostrar só o "chip" do anexo
    const text =
      files.map((f) => `[[ARQUIVO ${f.name}]]\n${f.text}${f.truncated ? "\n[…arquivo cortado]" : ""}\n[[/ARQUIVO]]\n\n`).join("") +
      (typed || "Leia o arquivo anexado e faça um resumo.");
    if (files.length) setAttachments([]);
    setChatError(null);
    setVoiceNote(null);
    voice.interrupt();

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

    if (!textOverride) setInput("");
    else setInput("");
    stickRef.current = true; // você mandou uma mensagem: volta a acompanhar a resposta
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
    let reply = "";
    let firstTokenMs: number | null = null;
    const speakBack = fromVoice && voiceSettings.enabled;
    let speechBuf = "";
    const takeSentences = () => {
      if (!speakBack) return;
      for (;;) {
        const m = speechBuf.match(/^([\s\S]*?[.!?])(?:\s+|$)/);
        if (!m) break;
        voice.enqueueSentence(m[1]);
        speechBuf = speechBuf.slice(m[0].length);
      }
      if (speechBuf.length > 180) {
        const cut = speechBuf.lastIndexOf(" ", 180);
        const at = cut > 40 ? cut : 180;
        voice.enqueueSentence(speechBuf.slice(0, at));
        speechBuf = speechBuf.slice(at);
      }
    };
    if (speakBack) voice.armSpeech();
    // Contexto sob medida: o de 32 mil joga parte do modelo na CPU (3x mais lento). Usa o menor que cabe na conversa
    // (+ espaço para a resposta) e só sobe quando o texto realmente precisa; Configurações fica como limite máximo.
    const neededTokens = Math.ceil((messages.reduce((n, m) => n + m.content.length, 0) + text.length) / 3) + 1500 + (mcpOn ? 3500 : 0); // ferramentas: descrições + resultados
    const ctxNow = [4096, 8192, 16384, 32768].find((c) => c >= neededTokens && c <= settings.numCtx) ?? settings.numCtx;
    try {
      await streamChat(
        id,
        text,
        activeModel,
        { ...settings, numCtx: Math.min(ctxNow, settings.numCtx) },
        (ev) => {
          if (firstEvent) {
            firstEvent = false;
            refreshList(); // a conversa já está salva com título: mostra na sidebar logo
          }
          if (ev.type === "token") {
            if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - heardAt);
            reply += ev.text;
            speechBuf += ev.text;
            takeSentences();
            buffer.push("content", ev.text);
          }
          else if (ev.type === "thinking") buffer.push("thinking", ev.text);
          else if (ev.type === "tool")
            setSearchState(ev.state === "executando" || ev.state === "filtrando" ? "executando" : "pronta");
          else if (ev.type === "mcp") {
            const busy = ev.state === "carregando" || ev.state === "executando";
            if (String(ev.name).startsWith("browser__") || (browserOn && !mcpOn)) setBrowserState(busy ? "executando" : "pronta");
            else setMcpState(busy ? "executando" : "pronta");
          }
          else if (ev.type === "approval") setApproval({ id: ev.id, tool: ev.tool, args: ev.args, write: ev.write, warning: ev.warning });
          else if (ev.type === "done") {
            buffer.flush();
            setApproval(null);
            patchLast((m) => ({ ...m, stats: ev.stats }));
          } else if (ev.type === "error") {
            failed = true;
            buffer.flush();
            setChatError(ev.message);
          }
        },
        abort.signal,
        searchOn,
        mcpOn,
        browserOn,
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
      if (speakBack && reply.trim() && !abort.signal.aborted) {
        if (speechBuf.trim()) voice.enqueueSentence(speechBuf);
        const firstAudioMs = voice.finishSpeech();
        setTimings({
          sttMs: null,
          firstTokenMs,
          firstAudioMs,
          totalMs: firstAudioMs === null ? null : Math.round(performance.now() - heardAt),
        });
      } else if (speakBack) voice.interrupt();
      // Sincroniza com o que foi salvo no servidor (inclui parciais e a pergunta mesmo em caso de erro)
      api.get(id).then((c) => setMessages(c.messages)).catch(() => {});
      refreshList();
    }
  }
  sendRef.current = send;

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
        onRename={rename}
        onSettings={() => setShowSettings(true)}
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
          tools={[
            {
              name: "pesquisa",
              label: "Pesquisa na web",
              description: "Busca na internet quando a pergunta precisa de fatos atuais, com um filtro antes da busca.",
              status: !searchOn ? "desligada" : searchState === "executando" ? "executando" : "pronta",
              note: !searchOn ? "desligada" : searchState === "executando" ? "pesquisando" : "ligada",
            },
            {
              name: "browser",
              label: "Navegador",
              description: "Abre o Chromium na sua tela, move o cursor e pesquisa. O clique pede a sua aprovação.",
              status: !browserOn ? "desligada" : browserState === "executando" ? "executando" : "pronta",
              note: !browserOn ? "desligada" : browserState === "executando" ? "navegando" : "ligada",
            },
            {
              name: "mcp",
              label: "Arquivos do Nex",
              description: "Lê arquivos de qualquer pasta do PC e cria ou edita arquivos. Criar, editar e áreas sensíveis pedem a sua aprovação, com aviso das consequências. O tamanho das leituras é limitado pelo contexto.",
              status: !mcpOn ? "desligada" : mcpState === "executando" ? "executando" : "pronta",
              note: !mcpOn ? "desligada" : mcpState === "executando" ? "executando" : "ligada",
            },
          ]}
          onToggleTool={(name) => {
            if (name === "browser") {
              setBrowserOn((on) => {
                const next = !on;
                localStorage.setItem("nexBrowser", next ? "1" : "0");
                if (!next) setBrowserState("pronta");
                return next;
              });
              return;
            }
            if (name === "mcp") {
              setMcpOn((on) => {
                localStorage.setItem("nexMcp", on ? "0" : "1");
                return !on;
              });
              return;
            }
            if (name !== "pesquisa") return;
            setSearchOn((on) => {
              const next = !on;
              localStorage.setItem("nexSearch", next ? "1" : "0");
              setSearchState(next ? "pronta" : "desligada");
              return next;
            });
          }}
        >
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.map((m, i) => (
              <MessageView key={i} m={m} streaming={streaming && i === messages.length - 1 && m.role === "assistant"} />
            ))}
            {approval && (
              <div className="rounded-xl border border-accent/50 bg-panel px-4 py-3 text-sm" data-no-core>
                <div className="font-medium">O Nex quer executar <code>{approval.tool}</code></div>
                <p className="mt-1 text-xs text-mute">
                  {approval.write
                    ? "Isto cria ou altera arquivos no seu computador. Se o arquivo já existir, o conteúdo atual é substituído."
                    : "Isto lê um arquivo ou pasta. O conteúdo lido vai para o modelo e fica salvo no histórico desta conversa."}
                </p>
                {approval.warning && (
                  <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
                    ⚠ {approval.warning}
                  </p>
                )}
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-2 text-xs text-mute">
                  {JSON.stringify(approval.args, null, 2)}
                </pre>
                <div className="mt-3 flex gap-2">
                  {([true, false] as const).map((ok) => (
                    <button
                      key={String(ok)}
                      type="button"
                      onClick={() => {
                        const id = approval.id;
                        setApproval(null);
                        void api.approve(id, ok).catch(() => setChatError("Não consegui enviar a resposta de aprovação."));
                      }}
                      className={ok ? "rounded-lg bg-accent px-3 py-1.5 font-medium text-bg hover:opacity-90" : "rounded-lg border border-line px-3 py-1.5 text-mute hover:bg-white/5 hover:text-fg"}
                    >
                      {ok ? "Autorizar" : "Rejeitar"}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
            {(attachments.length > 0 || attaching) && (
              <div className="mb-1 flex flex-wrap gap-1.5 px-1">
                {attachments.map((a, i) => (
                  <span key={i} className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1 text-xs">
                    📎 {a.name} <span className="text-mute">{a.truncated ? "cortado · " : ""}{a.chars} caract.</span>
                    <button type="button" className="text-mute hover:text-fg" title="Remover"
                      onClick={() => setAttachments((l) => l.filter((_, j) => j !== i))}>✕</button>
                  </span>
                ))}
                {attaching && <span className="px-2 py-1 text-xs text-mute">Lendo arquivo…</span>}
              </div>
            )}
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
              <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={async (e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (!picked.length) return;
                  setAttaching(true);
                  setChatError(null);
                  // metade do contexto, em caracteres (~3 por token), fica para o arquivo; o resto é pergunta e resposta
                  // arquivo grande deixa tudo lento (prompt longo + contexto grande): limite de ~12 mil caracteres no total
                  const budget = Math.round(Math.min(12000, settings.numCtx * 1.5) / picked.length);
                  for (const f of picked) {
                    try {
                      const r = await api.readFile(f, budget);
                      setAttachments((l) => [...l, r]);
                    } catch (err) {
                      setChatError(`Não li "${f.name}": ${(err as Error).message}`);
                    }
                  }
                  setAttaching(false);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={attaching}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-mute transition-colors hover:bg-white/5 hover:text-fg disabled:opacity-40"
                title="Anexar arquivo (PDF, DOCX, md, texto, código…)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setVoiceSettings((s) => ({ ...s, enabled: true }));
                  void voice.dictate();
                }}
                aria-pressed={voice.phase === "listening" && !voice.conversation}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                  voice.phase === "listening" && !voice.conversation
                    ? "border-red-500/60 bg-red-500/15 text-red-300"
                    : "border-line text-mute hover:bg-white/5 hover:text-fg"
                }`}
                title="Microfone: uma frase, enviada como texto"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setVoiceSettings((s) => ({ ...s, enabled: true }));
                  void voice.toggleConversation();
                }}
                aria-pressed={voice.conversation}
                className={`flex h-8 items-center rounded-lg border px-2.5 text-xs transition-colors ${
                  voice.conversation
                    ? "border-accent/60 bg-accent/15 text-accent"
                    : "border-line text-mute hover:bg-white/5 hover:text-fg"
                }`}
                title={voice.conversation ? "Desligar o chat de voz" : "Ligar o chat de voz"}
              >
                Chat de voz
              </button>
              {streaming ? (
                <button
                  type="button"
                  onClick={() => {
                    voice.interrupt();
                    abortRef.current?.abort();
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg text-bg hover:opacity-90"
                  title="Parar"
                >
                  ■
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() && attachments.length === 0}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-lg font-semibold text-bg hover:opacity-90 disabled:opacity-30"
                  title="Enviar"
                >
                  ↑
                </button>
              )}
              </div>
            </div>
          </form>
          {modelMissing ? (
            <p className="mt-2 text-center text-[11px] text-red-400">
              O modelo "{activeModel}" não está instalado. Rode: ollama pull {activeModel}
            </p>
          ) : (
            <p className="mt-2 text-center text-[11px] text-mute">
              Nex roda localmente no seu computador, via Ollama.
              {voice.partial ? ` Ouvi: ${voice.partial}` : ""}
              {voiceNote ? ` ${voiceNote}` : ""}
              {timings
                ? ` Voz: 1º token ${timings.firstTokenMs ?? "—"} ms, 1º áudio ${timings.firstAudioMs ?? "—"} ms, total ${timings.totalMs ?? "—"} ms.`
                : ""}
            </p>
          )}
        </div>
      </main>

      {showMetrics && <MetricsModal metrics={metrics} onClose={() => setShowMetrics(false)} />}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          settings={settings}
          onChange={setSettings}
          status={status}
          bgAnim={bgAnim}
          onBgAnim={changeBgAnim}
          core={nex.settingsProps}
          voice={voiceSettings}
          onVoice={setVoiceSettings}
          voiceStatus={voiceStatus}
          devices={voice.devices}
        />
      )}
    </div>
  );
}
