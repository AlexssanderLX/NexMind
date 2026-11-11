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

export type Settings = {
  model: string;
  numCtx: number;
  think: "auto" | "on" | "off";
  system: string;
};

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "done"; stats: ChatStats | null }
  | { type: "error"; message: string };
