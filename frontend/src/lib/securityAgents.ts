// Nex Security: os subagentes especialistas e o prompt do modo. Funções puras, com testes em frontend/tests.
import type { MicroAppMode } from "../types";
import { DEV_DOMAIN_PROMPT } from "./devPrompt.ts";
import { clampWindow } from "./geometry.ts";

export type AgentId = "recon" | "auth" | "input" | "logic" | "verify";

/** Espelha backend/Security/SubagentCatalog.cs (o backend é quem define o prompt de cada especialista). */
export const SECURITY_AGENTS: { id: AgentId; name: string; emoji: string; summary: string }[] = [
  { id: "recon", name: "Recon Specialist", emoji: "🧭", summary: "Mapeamento de superfícies, rotas, DOM, formulários e scripts JS" },
  { id: "auth", name: "Auth Specialist", emoji: "🔑", summary: "BOLA/IDOR, BFLA, tokens e Contas A/B" },
  { id: "input", name: "Input Specialist", emoji: "💉", summary: "XSS, SSRF, SQLi com marcadores inertes" },
  { id: "logic", name: "Logic Specialist", emoji: "⚙️", summary: "Workflows, limites numéricos e uploads" },
  { id: "verify", name: "Verify Specialist", emoji: "🛡️", summary: "Contra-provas e evidências" },
];

/** A instrução de domínio do modo Security. */
export const SECURITY_DOMAIN_PROMPT =
  "Você é o Nex Security (Pentest & Bug Bounty Workbench), co-piloto sênior de segurança ofensiva e inteligência. Você domina amplamente OSINT (Open-Source Intelligence), reconhecimento passivo, enumeração de subdomínios, certificados SSL/TLS, Google Dorks, registros DNS/WHOIS, análise de cabeçalhos e mapeamento de superfícies web com base no OWASP WSTG v4.2. NUNCA diga que não tem conhecimento em OSINT ou cibersegurança: responda e investigue com maestria técnica e prontidão imediata.";

/**
 * O que o modelo de 4B precisa SABER para explicar o app com propriedade (ele não tem como inventar isto). Cabe em ~450 tokens
 * e só entra no modo Security: no modo Geral o prompt continua enxuto.
 */
export const SECURITY_KNOWLEDGE = [
  "BASE DO NEX SECURITY (use ao explicar o app e a metodologia):",
  "- Os 6 estágios de trabalho: 0 Escopo & Alvos (definição dos alvos e regras do Alexssander); 1 Mapear Superfície (rotas, parâmetros, DOM, bundles JS); 2 Formular Hipótese (refutável, OWASP WSTG v4.2); 3 Teste Mínimo Seguro (marcadores inertes); 4 Interpretar Efeito; 5 Evidência & Relatório.",
  '- OWASP Workbench: o atlas do OWASP WSTG v4.2 em /workbench.html (botão "OWASP Workbench" no topo, abre em nova aba).',
  "- Subagentes especialistas (botão do robô 🤖, arrastável, abre um micro-chat flutuante sem sair desta conversa): " +
    "Recon (superfícies, rotas, DOM, formulários, scripts JS), Auth (BOLA/IDOR, BFLA, tokens, contas A/B), Input (XSS, SSRF, SQLi com marcadores inertes), " +
    "Logic (workflows, limites numéricos, uploads) e Verify (contraprovas e evidências).",
  "- Cada subagente anota suas descobertas em arquivos Markdown da conversa (recon.md, auth.md, input.md, logic.md, verify.md e INDEX.md). " +
    'Você NÃO lê essas notas por conta própria: só quando o Alexssander perguntar ("O que o Recon achou?"), e então elas aparecem aqui no prompt.',
  "- Ferramentas do app: navegador no grupo de abas Nex (ler páginas, DOM e scripts), arquivos, computador, pesquisa na web e o caderno. Ações que alteram algo pedem a aprovação dele.",
  "- Princípios operacionais: hipótese não é vulnerabilidade (refutabilidade em primeiro lugar); menor intervenção necessária; separe o fato observado da suspeita; foco na execução técnica sem burocracia.",
  "- Domínio de OSINT: investigação passiva com motores de busca, descoberta de ativos, subdomínios, tecnologias, repositórios públicos e footprints digitais.",
  "- Evidência: cada achado sai como [CONFIRMED], [INFERRED], [NOT_FOUND], [TOOL_UNAVAILABLE] ou [UNVERIFIED]. Sem rota, porta ou subdomínio inventado. Sem caixa de comando, a menos que o Alexssander peça o comando.",
  "- Antes de agir, a frase é [CAPABILITIES_QUERY] (só lista o que existe), [PLANNING_AND_SCOPE] (confirma a gaveta Escopo & Alvos) ou [ACTIVE_EXECUTION] (só então a ferramenta roda).",
].join("\n");

/** O `system` enviado ao backend: o das Configurações, mais o do modo Security quando ele está ativo. */
export function composeSystem(base: string, mode: MicroAppMode): string {
  const clean = base.trim();
  if (mode === "security") return [clean, SECURITY_DOMAIN_PROMPT, SECURITY_KNOWLEDGE].filter(Boolean).join("\n\n");
  if (mode === "dev") return [clean, DEV_DOMAIN_PROMPT].filter(Boolean).join("\n\n");
  return clean;
}

/** Separa os anexos ([[ARQUIVO nome]] … [[/ARQUIVO]]) do texto digitado, para mostrar só um chip por arquivo. */
export function splitAttachments(content: string): { files: { name: string; chars: number }[]; body: string } {
  const files: { name: string; chars: number }[] = [];
  const body = content
    .replace(/\[\[ARQUIVO ([^\]]*)\]\]\n?([\s\S]*?)\n?\[\[\/ARQUIVO\]\]\n*/g, (_, name: string, text: string) => {
      files.push({ name, chars: text.length });
      return "";
    })
    .trim();
  return { files, body };
}

export { clampWindow } from "./geometry.ts";

// ---------- várias janelas de subagente ao mesmo tempo ----------
// `order` é a pilha de janelas abertas: a última é a que está na frente.

/** Abre a janela do especialista, ou só a traz para a frente se ela já está aberta. */
export function openWindow(order: AgentId[], id: AgentId): AgentId[] {
  return [...order.filter((x) => x !== id), id];
}

/** Fecha a janela do especialista (as outras continuam abertas e com a conversa que tinham). */
export function closeWindow(order: AgentId[], id: AgentId): AgentId[] {
  return order.filter((x) => x !== id);
}

/** Onde a N-ésima janela aparece pela primeira vez: em cascata, para não esconder a anterior por completo. */
export function cascadePos(index: number, bounds: { w: number; h: number }, size: { w: number; h: number }) {
  return clampWindow({ x: bounds.w - size.w - 24 - index * 44, y: 70 + index * 40 }, bounds, size);
}

/** z-index da janela: as da frente têm número maior (a base 30 é a dos painéis do Nex). */
export function windowZ(order: AgentId[], id: AgentId): number {
  return 40 + Math.max(0, order.indexOf(id));
}
