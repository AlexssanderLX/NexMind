// Texto e estado da pílula de tarefa (ferramentas + raciocínio numa linha). Funções puras, com testes em frontend/tests.
import type { ToolRun } from "../types";

export type PillState = "running" | "ok" | "warn" | "error";

export function toolLabel(name: string): string {
  if (name.startsWith("browser__")) return "Navegador";
  if (name.startsWith("arquivos__") || name === "arquivos") return "Arquivos";
  if (name.startsWith("desktop__")) return "Computador";
  if (name === "topic_read" || name === "topic_write") return "Caderno";
  if (name === "pesquisa") return "Pesquisa";
  return "Ferramenta";
}

export function toolShort(name: string): string {
  const i = name.indexOf("__");
  return i >= 0 ? name.slice(i + 2) : name;
}

/** Verbo no gerúndio para a barra de telemetria ao vivo ("lendo a página"). */
export function toolVerb(name: string): string {
  const s = toolShort(name);
  const table: [string, string][] = [
    ["get_dom", "lendo a página"],
    ["navigate", "abrindo a página"],
    ["reuse_tab", "trocando a aba"],
    ["browser_tabs", "listando as abas"],
    ["browser_click", "clicando"],
    ["browser_type", "digitando"],
    ["read_text_file", "lendo o arquivo"],
    ["write_file", "gravando o arquivo"],
    ["edit_file", "editando o arquivo"],
    ["list_directory", "listando a pasta"],
    ["search_files", "procurando arquivos"],
    ["get_file_info", "consultando o arquivo"],
    ["topic_write", "anotando no caderno"],
    ["topic_read", "lendo o caderno"],
    ["desktop_list_windows", "listando as janelas"],
    ["desktop_inspect_window", "inspecionando a janela"],
    ["desktop_click", "clicando na janela"],
    ["desktop_type", "digitando na janela"],
    ["desktop_press_hotkey", "enviando atalho"],
    ["desktop_take_screenshot", "capturando a tela"],
  ];
  return table.find(([k]) => s.includes(k))?.[1] ?? s;
}

const isActive = (t: ToolRun) => t.state === "executando" || t.state === "carregando";

export function pillState(tools: ToolRun[], live: boolean): PillState {
  if (tools.some((t) => t.state === "falhou")) return "error";
  if (tools.some((t) => t.state === "recusada")) return "warn";
  return live ? "running" : "ok";
}

export function thinkingTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const CATEGORIES: { test: (s: string) => boolean; one: string; many: string }[] = [
  { test: (s) => s.includes("get_dom"), one: "página lida", many: "páginas lidas" },
  { test: (s) => s.includes("navigate") || s.includes("reuse_tab"), one: "página aberta", many: "páginas abertas" },
  { test: (s) => s.includes("browser_click") || s.includes("browser_type"), one: "ação no navegador", many: "ações no navegador" },
  { test: (s) => s.includes("browser_tabs"), one: "listagem de abas", many: "listagens de abas" },
  { test: (s) => s.includes("read_text_file"), one: "arquivo lido", many: "arquivos lidos" },
  { test: (s) => s.includes("write_file") || s.includes("edit_file"), one: "arquivo alterado", many: "arquivos alterados" },
  { test: (s) => s.includes("list_directory") || s.includes("search_files") || s.includes("get_file_info"), one: "consulta a arquivos", many: "consultas a arquivos" },
  { test: (s) => s === "topic_write", one: "nota anotada", many: "notas anotadas" },
  { test: (s) => s === "topic_read", one: "leitura do caderno", many: "leituras do caderno" },
  { test: (s) => s.startsWith("desktop_"), one: "ação no computador", many: "ações no computador" },
];

/** Resumo do que foi feito, só com ações CONCLUÍDAS: "1 página lida, 1 nota anotada". */
export function summarizeTools(tools: ToolRun[]): string {
  const counts = new Map<number, number>();
  let other = 0;
  for (const t of tools) {
    if (t.state !== "concluida") continue;
    const i = CATEGORIES.findIndex((c) => c.test(toolShort(t.name)));
    if (i < 0) other++;
    else counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const parts = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([i, n]) => plural(n, CATEGORIES[i].one, CATEGORIES[i].many));
  if (other > 0) parts.push(plural(other, "ferramenta", "ferramentas"));
  return parts.join(", ");
}

/** Linha de status AO VIVO: a ferramenta que está rodando agora e o que o Nex faz ("⚡ [Navegador] lendo a página · 💭 Planejando…"). */
export function liveStatus(tools: ToolRun[], hasThinking: boolean): string {
  const active = [...tools].reverse().find(isActive);
  if (active) {
    const detail = active.brief ? ` ${active.brief}` : "";
    return `⚡ [${toolLabel(active.name)}] ${toolVerb(active.name)}${detail}…`;
  }
  const last = tools[tools.length - 1];
  if (last) return `⚡ ${last.state === "concluida" ? "Passo concluído" : "Passo " + last.state} · 💭 Pensando no próximo…`;
  return hasThinking ? "💭 Planejando…" : "💭 Pensando…";
}

/** Linha única da pílula recolhida. */
export function collapsedLine(tools: ToolRun[], thinking: string, live: boolean): string {
  const state = pillState(tools, live);
  if (state === "error") {
    const failed = tools.filter((t) => t.state === "falhou").length;
    return `⚠️ ${failed > 1 ? `${failed} falhas na ação` : "Falha na ação"} · Inspecionar erro`;
  }
  if (live) {
    const status = liveStatus(tools, !!thinking);
    const active = tools.some(isActive);
    return active && thinking ? `${status} · 💭 Planejando…` : status;
  }
  const parts: string[] = [];
  const tasks = summarizeTools(tools);
  if (tasks) parts.push(`⚡ ${tasks}`);
  if (state === "warn") parts.push("⚠️ Ação recusada");
  if (thinking.trim()) {
    const n = thinkingTokens(thinking);
    parts.push(`💭 Raciocínio (${n} ${n === 1 ? "token" : "tokens"})`);
  }
  return parts.join(" · ") || "💭 Raciocínio";
}
