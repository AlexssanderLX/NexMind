/** Perfis gráficos do núcleo. O padrão é "max": a ideia desta etapa é ver o potencial visual e medir o custo real. */
export type ProfileId = "max" | "balanced" | "light";

export interface Profile {
  id: ProfileId;
  label: string;
  description: string;
  particles: number; // partículas do volume da esfera
  nodes: number; // nós da rede neural (cada um com conexões)
  neighbors: number; // conexões por nó
  halo: number; // poeira orbital ao redor
  rings: boolean;
  bloom: boolean; // brilho (pós-processamento)
  dpr: number; // limite de pixel ratio
  fps: number; // teto de quadros por segundo
  glass: boolean; // desfoque de fundo nos painéis
}

export const PROFILES: Record<ProfileId, Profile> = {
  max: {
    id: "max",
    label: "Máximo",
    description: "Tudo ligado: ~9 mil partículas, rede de conexões, anéis, poeira orbital, brilho (bloom) e 60 fps.",
    particles: 9000,
    nodes: 700,
    neighbors: 4,
    halo: 1500,
    rings: true,
    bloom: true,
    dpr: 2,
    fps: 60,
    glass: true,
  },
  balanced: {
    id: "balanced",
    label: "Equilibrado",
    description: "Menos partículas, sem brilho, resolução até 1,5x e 45 fps.",
    particles: 4000,
    nodes: 420,
    neighbors: 3,
    halo: 600,
    rings: true,
    bloom: false,
    dpr: 1.5,
    fps: 45,
    glass: true,
  },
  light: {
    id: "light",
    label: "Leve",
    description: "Mínimo de efeitos: ~1,5 mil partículas, sem brilho, sem anéis, sem desfoque nos painéis e 30 fps.",
    particles: 1500,
    nodes: 220,
    neighbors: 3,
    halo: 0,
    rings: false,
    bloom: false,
    dpr: 1,
    fps: 30,
    glass: false,
  },
};

export const PROFILE_LIST: Profile[] = [PROFILES.max, PROFILES.balanced, PROFILES.light];

export function isProfileId(v: unknown): v is ProfileId {
  return v === "max" || v === "balanced" || v === "light";
}
