// Ícones do explorador do Nex Dev (estilo VS Code): um selo curto e colorido por tipo de arquivo. Funções puras, com testes.

export interface FileIcon {
  /** texto do selo (2 a 3 caracteres) */
  label: string;
  /** classe de cor do Tailwind */
  color: string;
}

const BY_EXT: Record<string, FileIcon> = {
  cs: { label: "C#", color: "text-violet-400" },
  csproj: { label: "C#", color: "text-violet-300" },
  sln: { label: "VS", color: "text-violet-300" },
  ts: { label: "TS", color: "text-sky-400" },
  tsx: { label: "TSX", color: "text-cyan-300" },
  js: { label: "JS", color: "text-yellow-300" },
  jsx: { label: "JSX", color: "text-yellow-200" },
  mjs: { label: "JS", color: "text-yellow-300" },
  json: { label: "{}", color: "text-amber-300" },
  md: { label: "M↓", color: "text-slate-300" },
  ps1: { label: ">_", color: "text-blue-400" },
  py: { label: "PY", color: "text-emerald-300" },
  html: { label: "<>", color: "text-orange-400" },
  css: { label: "#", color: "text-sky-300" },
  svg: { label: "◇", color: "text-pink-300" },
  yml: { label: "YML", color: "text-rose-300" },
  yaml: { label: "YML", color: "text-rose-300" },
  txt: { label: "TXT", color: "text-slate-400" },
  sh: { label: "$", color: "text-green-300" },
  sql: { label: "SQL", color: "text-amber-200" },
};

const BY_NAME: Record<string, FileIcon> = {
  ".gitignore": { label: "git", color: "text-orange-300" },
  "package.json": { label: "npm", color: "text-red-400" },
  "package-lock.json": { label: "npm", color: "text-red-300" },
  dockerfile: { label: "🐳", color: "text-sky-300" },
};

const GENERIC: FileIcon = { label: "·", color: "text-mute" };

/** Selo do arquivo: pelo nome (package.json, .gitignore) e, se não houver, pela extensão. */
export function fileIcon(name: string): FileIcon {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  const dot = lower.lastIndexOf(".");
  if (dot <= 0 || dot === lower.length - 1) return GENERIC;
  return BY_EXT[lower.slice(dot + 1)] ?? GENERIC;
}
