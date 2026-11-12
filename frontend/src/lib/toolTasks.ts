// Monitor de tasks das ferramentas: o painel "Ferramentas" mostra o que cada uma está fazendo AGORA, em tempo real,
// sem interruptores (o backend aciona a ferramenta pela intenção da frase). Funções puras, com testes em frontend/tests.

export type ToolKey = "pesquisa" | "browser" | "desktop" | "mcp";

export interface ToolTask {
  busy: boolean;
  /** o que está fazendo ("lendo DOM de /dashboard"); vazio quando ociosa */
  note: string;
}

export const IDLE_TASKS: Record<ToolKey, ToolTask> = {
  pesquisa: { busy: false, note: "" },
  browser: { busy: false, note: "" },
  desktop: { busy: false, note: "" },
  mcp: { busy: false, note: "" },
};

/** Os cards do painel, na ordem. Sem interruptor: a ferramenta entra sozinha quando a frase pede; leitura roda direto e só escrita/ação pede aprovação. */
export const TOOL_CARDS: { key: ToolKey; label: string; description: string }[] = [
  { key: "browser", label: "Navegador", description: "Lê e mapeia páginas (DOM, rotas, formulários, scripts) nas abas do grupo Nex. Ligado pela frase, sem interruptor. Ler roda direto; clicar e digitar pedem a sua aprovação." },
  { key: "pesquisa", label: "Pesquisa na web", description: "Busca na internet quando você pede para pesquisar, com um filtro antes da busca. Ligada pela frase." },
  { key: "mcp", label: "Arquivos do Nex", description: "Lê arquivos e pastas direto, sem aprovação. Criar ou editar arquivos pede a sua aprovação, com aviso das consequências." },
  { key: "desktop", label: "Computador", description: "Lê janelas do Windows direto. Clique, digitação e atalho pedem a sua aprovação." },
];

/** Qual card do painel uma ferramenta pertence, pelo nome qualificado (servidor__ferramenta). */
export function toolKeyOf(name: string): ToolKey | null {
  if (name === "pesquisa") return "pesquisa";
  if (name.startsWith("browser__")) return "browser";
  if (name.startsWith("desktop__")) return "desktop";
  if (name.startsWith("arquivos__")) return "mcp";
  return null;
}

/** Valor de um argumento no resumo do backend ("url=https://x tab_id=0"). */
export function briefArg(brief: string | undefined, key: string): string {
  if (!brief) return "";
  const m = new RegExp(`(?:^|\\s)${key}=(\\S+)`).exec(brief);
  return m ? m[1].replace(/…$/, "") : "";
}

/** "/dashboard" de "https://alvo.local/dashboard?x=1"; vazio se não for um endereço. */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.length > 1 ? u.pathname : "";
    return p || u.host;
  } catch {
    return "";
  }
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Texto curto do que a ferramenta está fazendo. `lastPath` é a última página aberta (get_dom e recon não trazem o endereço,
 * só o número da aba, então o painel lembra a rota da última navegação).
 */
export function describeTask(name: string, brief: string | undefined, lastPath = ""): string {
  const tool = name.includes("__") ? name.split("__")[1] : name;
  const where = lastPath || "aba atual";
  switch (tool) {
    case "browser_navigate":
    case "browser_reuse_tab":
      return `abrindo ${pathOf(briefArg(brief, "url")) || briefArg(brief, "url") || "página"}`;
    case "browser_get_dom":
      return `lendo DOM de ${where}`;
    case "browser_recon":
      return `mapeando superfície de ${where}`;
    case "browser_tabs":
      return "listando abas do grupo Nex";
    case "browser_click":
      return `clicando no item ${briefArg(brief, "element_id") || ""}`.trim();
    case "browser_type":
      return `digitando no item ${briefArg(brief, "element_id") || ""}`.trim();
    case "browser_close":
      return "fechando aba";
    case "list_directory":
    case "list_directory_with_sizes":
    case "directory_tree":
      return `listando ${baseName(briefArg(brief, "path")) || "pasta"}`;
    case "search_files":
      return "procurando arquivos";
    case "write_file":
    case "edit_file":
      return `gravando ${baseName(briefArg(brief, "path")) || "arquivo"}`;
    case "create_directory":
      return `criando pasta ${baseName(briefArg(brief, "path"))}`.trim();
    case "move_file":
      return "movendo arquivo";
    default:
      if (tool.startsWith("read_")) return `lendo ${baseName(briefArg(brief, "path")) || "arquivo"}`;
      if (tool.startsWith("desktop_")) return `no Windows: ${tool.replace("desktop_", "").replaceAll("_", " ")}`;
      return tool.replaceAll("_", " ");
  }
}

/** O que o cartão escreve: "[Executando - lendo DOM de /dashboard]" ou "[Pronta / Ociosa]". */
export function taskStatusText(task: ToolTask): string {
  return task.busy ? `[Executando - ${task.note || "trabalhando"}]` : "[Pronta / Ociosa]";
}

/** Eventos do backend: carregando/executando = ocupada; concluida/falhou/recusada = ociosa. */
export function isBusyState(state: string): boolean {
  return state === "carregando" || state === "executando" || state === "filtrando";
}
