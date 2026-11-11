/** Paletas do núcleo. Um clique na esfera passa para a próxima; a cor de destaque do app acompanha. */
export interface Palette {
  id: string;
  label: string;
  /** cor das partículas de frente e dos pulsos (RGB 0..1) */
  near: [number, number, number];
  /** cor das partículas ao fundo e das conexões (RGB 0..1) */
  far: [number, number, number];
  /** cor de destaque da interface (--color-accent) */
  accent: string;
}

export const PALETTES: Palette[] = [
  { id: "ciano", label: "Ciano", near: [0.62, 0.95, 1.0], far: [0.08, 0.42, 0.95], accent: "#22d3ee" },
  { id: "violeta", label: "Violeta", near: [0.8, 0.7, 1.0], far: [0.4, 0.2, 0.95], accent: "#a78bfa" },
  { id: "verde", label: "Verde", near: [0.65, 1.0, 0.8], far: [0.08, 0.65, 0.4], accent: "#34d399" },
  { id: "ambar", label: "Âmbar", near: [1.0, 0.85, 0.55], far: [0.95, 0.5, 0.1], accent: "#fbbf24" },
  { id: "rosa", label: "Rosa", near: [1.0, 0.72, 0.88], far: [0.85, 0.15, 0.55], accent: "#f472b6" },
];

export function clampPalette(i: number): number {
  return Number.isInteger(i) && i >= 0 && i < PALETTES.length ? i : 0;
}
