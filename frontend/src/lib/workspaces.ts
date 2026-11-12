// Os workspaces (modos) do Nex: cada um tem as próprias conversas. Funções puras, com testes em frontend/tests.
import type { ConversationSummary, MicroAppMode } from "../types";

export const WORKSPACES: { mode: MicroAppMode; icon: string; name: string; summary: string }[] = [
  { mode: "general", icon: "🌐", name: "Geral", summary: "assistente do dia a dia" },
  { mode: "security", icon: "🛡️", name: "Security", summary: "pentest, WSTG e gavetas" },
  { mode: "dev", icon: "💻", name: "Dev", summary: "projetos, código e VS Code layout" },
];

export function workspaceOf(mode: MicroAppMode) {
  return WORKSPACES.find((w) => w.mode === mode) ?? WORKSPACES[0];
}

/** Modo salvo/recebido; qualquer valor desconhecido vira "general". */
export function parseMode(value: unknown): MicroAppMode {
  return value === "security" || value === "dev" ? value : "general";
}

/** Só as conversas do modo ativo (conversa antiga, sem o campo, é do Geral). */
export function filterByMode(items: ConversationSummary[], mode: MicroAppMode): ConversationSummary[] {
  return items.filter((c) => parseMode(c.mode) === mode);
}
