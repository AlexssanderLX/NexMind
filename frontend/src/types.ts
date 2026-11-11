export type ChatStats = {
  promptTokens: number;
  outputTokens: number;
  tokensPerSec: number;
  totalSeconds: number;
  loadSeconds: number;
};

export type Message = {
  role: "user" | "assistant";
  content: string;
  thinking?: string | null;
  stats?: ChatStats | null;
  model?: string | null;
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

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "done"; stats: ChatStats | null }
  | { type: "error"; message: string };
