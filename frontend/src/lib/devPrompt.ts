export const DEV_MODEL = "nex-unfiltered:latest";

export const DEV_DRAWERS = [
  { key: "requisitos", name: "0. Requisitos" },
  { key: "arquitetura", name: "1. Arquitetura (ADR)" },
  { key: "arquivos", name: "2. Arquivos Afetados" },
  { key: "build", name: "3. Build & Testes" },
  { key: "git", name: "4. Git & Diff" },
] as const;

export type DevDrawerKey = (typeof DEV_DRAWERS)[number]["key"];

export const DEV_DOMAIN_PROMPT = [
  "Você está no Nex Dev, como Engenheiro de Software Sênior dentro da pasta aberta do projeto.",
  "Escreva código limpo, completo e com tipagem forte. É proibido placeholder preguiçoso (// implemente aqui, TODO vazio, código pela metade).",
  "Trate exceção no ponto em que ela pode acontecer e diga o que falhou. Não engula erro em silêncio.",
  "Opere só nos arquivos da pasta aberta. Quando citar código, diga o caminho do arquivo.",
  "Consciência de memória: se o uso de memória passar de 75%, pare de expandir o plano, resuma as decisões e peça para gravá-las na gaveta de Arquitetura.",
].join(" ");

export function loadDrawers(): Record<DevDrawerKey, string> {
  const empty = { requisitos: "", arquitetura: "", arquivos: "", build: "", git: "" };
  try {
    const raw = localStorage.getItem("nexDevDrawers");
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}

export function saveDrawers(drawers: Record<DevDrawerKey, string>) {
  localStorage.setItem("nexDevDrawers", JSON.stringify(drawers));
}
