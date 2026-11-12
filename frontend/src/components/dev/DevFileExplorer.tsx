import { useState } from "react";
import type { DevNode } from "../../api";
import { fileIcon } from "../../lib/devIcons";

/** Nome da pasta para o topo da árvore ("C:\Users\a\ia-local" -> "ia-local"). */
export function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Explorador no estilo VS Code. Sem pasta: um botão "Abrir Pasta" que abre a janela nativa do Windows (nada de digitar caminho).
 * Com pasta: o nome do projeto em negrito no topo, com chevron para recolher, atualizar e trocar de pasta, e a árvore com ícones.
 */
export default function DevFileExplorer({
  root,
  nodes,
  activePath,
  onPickFolder,
  onDropFolder,
  onRefresh,
  onOpenFile,
}: {
  root: string | null;
  nodes: DevNode[];
  activePath?: string | null;
  /** abre o seletor nativo de pastas */
  onPickFolder: () => Promise<void>;
  /** pasta arrastada do Explorer do Windows (só funciona se o navegador informar o caminho) */
  onDropFolder: (path: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenFile: (path: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não abriu a pasta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      className="flex h-full w-full flex-col border-r border-white/5 bg-[#0b0f19]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0] as (File & { path?: string }) | undefined;
        if (file?.path) void run(() => onDropFolder(file.path!));
        else setError("O navegador não informa o caminho de uma pasta arrastada. Use o botão Abrir Pasta.");
      }}
    >
      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-mute">Explorador</div>

      {root === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 pb-10 text-center">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(onPickFolder)}
            className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent shadow-[0_0_18px_rgba(34,211,238,0.15)] transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? "Aguardando a janela…" : "📂 Abrir Pasta"}
          </button>
          <p className="text-[11px] leading-snug text-mute">Abre a janela do Windows para escolher a pasta do projeto. Sem digitar caminho.</p>
          {error && <p className="text-[11px] text-red-300">{error}</p>}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 px-2 pb-1">
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              aria-expanded={!collapsed}
              title={root}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-[13px] font-bold text-fg hover:bg-white/5"
            >
              <span className="w-3 text-[10px] text-mute" aria-hidden>
                {collapsed ? "›" : "v"}
              </span>
              <span aria-hidden>📁</span>
              <span className="truncate">{folderName(root)}</span>
            </button>
            <button type="button" disabled={busy} onClick={() => void run(onRefresh)} title="Atualizar a árvore" aria-label="Atualizar a árvore" className="rounded px-1.5 py-1 text-xs text-mute hover:bg-white/5 hover:text-fg disabled:opacity-40">
              ⟳
            </button>
            <button type="button" disabled={busy} onClick={() => void run(onPickFolder)} title="Trocar de pasta" aria-label="Trocar de pasta" className="rounded px-1.5 py-1 text-xs text-mute hover:bg-white/5 hover:text-fg disabled:opacity-40">
              📂
            </button>
          </div>
          {error && <p className="px-3 pb-2 text-[11px] text-red-300">{error}</p>}
          {!collapsed && (
            <div className="min-h-0 flex-1 overflow-auto px-1 pb-3 text-[13px]">
              {nodes.length === 0 && <p className="px-3 py-1 text-[11px] text-mute">Pasta vazia.</p>}
              {nodes.map((n) => (
                <Node key={n.path} node={n} depth={0} activePath={activePath ?? null} onOpenFile={onOpenFile} />
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function Node({ node, depth, activePath, onOpenFile }: { node: DevNode; depth: number; activePath: string | null; onOpenFile: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  if (node.directory) {
    return (
      <div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-fg/90 hover:bg-white/5" style={{ paddingLeft: 6 + depth * 12 }}>
          <span className="w-3 text-[10px] text-mute" aria-hidden>
            {open ? "v" : "›"}
          </span>
          <span aria-hidden>{open ? "📂" : "📁"}</span>
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children.map((c) => <Node key={c.path} node={c} depth={depth + 1} activePath={activePath} onOpenFile={onOpenFile} />)}
      </div>
    );
  }
  const icon = fileIcon(node.name);
  return (
    <button
      type="button"
      onClick={() => onOpenFile(node.path)}
      className={`flex w-full items-center gap-1.5 truncate rounded px-1 py-0.5 text-left hover:bg-white/5 ${node.path === activePath ? "bg-accent/10 text-fg" : "text-fg/90"}`}
      style={{ paddingLeft: 22 + depth * 12 }}
      title={node.path}
    >
      <span className={`w-6 shrink-0 text-center font-mono text-[9px] font-bold ${icon.color}`} aria-hidden data-file-icon>
        {icon.label}
      </span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}
