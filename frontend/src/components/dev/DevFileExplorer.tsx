import { useState } from "react";
import type { DevNode } from "../../api";

export default function DevFileExplorer({
  root,
  nodes,
  onOpenFolder,
  onOpenFile,
}: {
  root: string | null;
  nodes: DevNode[];
  onOpenFolder: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(next: string) {
    setBusy(true);
    setError(null);
    try {
      await onOpenFolder(next);
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
        if (file?.path) void open(file.path);
        else setError("O navegador não entrega o caminho da pasta. Cole o caminho completo.");
      }}
    >
      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-mute">Explorador</div>
      <form
        className="space-y-2 px-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (path.trim()) void open(path.trim());
        }}
      >
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="C:\caminho\do\projeto"
          aria-label="Caminho da pasta local"
          className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-fg outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy} className="w-full rounded border border-accent/30 px-2 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-40">
          Abrir Pasta
        </button>
      </form>
      {error && <p className="px-3 pb-2 text-[11px] text-red-300">{error}</p>}
      <p className="truncate px-3 pb-2 text-[10px] text-mute" title={root ?? ""}>
        {root ?? "Nenhuma pasta aberta. Arraste uma pasta ou cole o caminho."}
      </p>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-3 text-[13px]">
        {nodes.map((n) => (
          <Node key={n.path} node={n} depth={0} onOpenFile={onOpenFile} />
        ))}
      </div>
    </aside>
  );
}

function Node({ node, depth, onOpenFile }: { node: DevNode; depth: number; onOpenFile: (path: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  if (node.directory) {
    return (
      <div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-mute hover:bg-white/5 hover:text-fg" style={{ paddingLeft: 8 + depth * 12 }}>
          <span className="w-3 text-[10px]">{open ? "▼" : "▶"}</span>
          {node.name}
        </button>
        {open && node.children.map((c) => <Node key={c.path} node={c} depth={depth + 1} onOpenFile={onOpenFile} />)}
      </div>
    );
  }
  return (
    <button type="button" onClick={() => onOpenFile(node.path)} className="block w-full truncate rounded px-1 py-0.5 text-left text-fg/90 hover:bg-white/5" style={{ paddingLeft: 22 + depth * 12 }} title={node.path}>
      {node.name}
    </button>
  );
}
