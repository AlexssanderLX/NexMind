export type ChatStats = {
  promptTokens: number;
  outputTokens: number;
  tokensPerSec: number;
  totalSeconds: number;
  loadSeconds: number;
};

export type ToolRun = {
  name: string;
  state: string;
  detail?: string;
  /** Resumo de uma linha dos argumentos, para a barra de telemetria ao vivo (ex.: "url=https://…"). */
  brief?: string;
};

/** Micro App ativo na barra lateral: conversa geral ou o modo de segurança (OWASP Workbench). */
export type MicroAppMode = "general" | "security" | "dev";

export type Message = {
  role: "user" | "assistant";
  content: string;
  thinking?: string | null;
  stats?: ChatStats | null;
  model?: string | null;
  tools?: ToolRun[];
};

export type Conversation = { id: string; title: string; model?: string | null; messages: Message[] };
export type ConversationSummary = { id: string; title: string; updatedAt: string };

export type OllamaStatus = {
  connected: boolean;
  baseUrl: string;
  version: string | null;
  error: string | null;
  models: { name: string; sizeMb: number }[];
};

export type Metrics = {
  machine: {
    cpuPercent: number;
    ramUsedMb: number;
    ramTotalMb: number;
    ollamaRamMb: number;
    gpu: { name: string; utilPercent: number; vramUsedMb: number; vramTotalMb: number } | null;
  };
  loadedModel: { name: string; sizeMb: number; vramMb: number; contextLength: number | null } | null;
};

/** Dois modelos: um rápido para conversar e um que raciocina, usado quando o botão Raciocínio está ligado. */
export type Settings = {
  chatModel: string;
  reasoningModel: string;
  numCtx: number;
  system: string;
};

export type VoiceSettings = {
  enabled: boolean;
  mode: "auto" | "manual";
  vadSilenceMs: number;
  vadSensitivity: number;
  speechRate: number;
  sttEngine: string;
  ttsEngine: string;
  ttsVoice: string;
  inputDeviceId: string;
};

export type VoiceTimings = {
  sttMs: number | null;
  firstTokenMs: number | null;
  firstAudioMs: number | null;
  totalMs: number | null;
};

export type VoiceStatus = {
  engines: { id: string; kind: string; available: boolean; detail: string }[];
  voices: string[];
  whisperModel: string;
};

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; state: string; query?: string }
  | { type: "mcp"; name: string; state: string; detail?: string; brief?: string }
  | { type: "approval"; id: string; tool: string; server: string; name: string; args: unknown; write?: boolean; warning?: string | null }
  | { type: "done"; stats: ChatStats | null }
  | { type: "error"; message: string };
