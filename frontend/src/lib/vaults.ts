// As 6 gavetas de dados da investigação (Nex Security). Funções puras, com testes em frontend/tests.
// Espelham SecurityNotes.VaultKeys no backend. Pentest não é linear: os agentes alimentam as gavetas e o Alexssander abre, edita e salva qualquer uma.

export type VaultKey = "scope" | "surface" | "hypotheses" | "tests" | "effects" | "evidence";

export const VAULTS: { key: VaultKey; icon: string; name: string; hint: string; one: string; many: string }[] = [
  { key: "scope", icon: "🎯", name: "Escopo & Alvos", hint: "domínios, contas de teste, regras", one: "item", many: "itens" },
  { key: "surface", icon: "🗺️", name: "Superfície Mapeada", hint: "rotas, endpoints, formulários, scripts", one: "rota", many: "rotas" },
  { key: "hypotheses", icon: "🧪", name: "Hipóteses OWASP", hint: "hipóteses ligadas ao WSTG", one: "hipótese", many: "hipóteses" },
  { key: "tests", icon: "🚀", name: "Testes Executados", hint: "payloads inertes, requisições enviadas", one: "teste", many: "testes" },
  { key: "effects", icon: "📡", name: "Efeitos & Respostas", hint: "anomalias e comportamentos observados", one: "efeito", many: "efeitos" },
  { key: "evidence", icon: "🧾", name: "Evidências & PoCs", hint: "provas validadas e resumo de impacto", one: "PoC", many: "PoCs" },
];

export function findVault(key: VaultKey) {
  return VAULTS.find((v) => v.key === key)!;
}

/** Itens de uma gaveta: linhas com texto que não são títulos (igual ao backend). */
export function countItems(text: string): number {
  return text.split("\n").filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith("#");
  }).length;
}

/** O selo do cartão: "Vazio", "1 hipótese", "3 rotas". */
export function vaultBadge(key: VaultKey, count: number): string {
  if (!count) return "Vazio";
  const v = findVault(key);
  return `${count} ${count === 1 ? v.one : v.many}`;
}

export type VaultBlock = { kind: "h"; text: string } | { kind: "li"; text: string } | { kind: "p"; text: string };

/** Visualização formatada: títulos (#), itens (- ou *) e parágrafos. Linhas em branco são ignoradas. */
export function parseVault(text: string): VaultBlock[] {
  const out: VaultBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) out.push({ kind: "h", text: h[1] });
    else if (/^[-*]\s+/.test(line)) out.push({ kind: "li", text: line.replace(/^[-*]\s+/, "") });
    else out.push({ kind: "p", text: line });
  }
  return out;
}

/** "salvo agora", "salvo há 5 min", ou a data. Sem data: "ainda não salvo". */
export function lastSavedLabel(updatedAt: string | null | undefined, now = Date.now()): string {
  if (!updatedAt) return "ainda não salvo";
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return "ainda não salvo";
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return "salvo agora";
  if (min < 60) return `salvo há ${min} min`;
  return `salvo em ${new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}
