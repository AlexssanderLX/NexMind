import { useState } from "react";
import { api } from "../../api";
import { DEV_DRAWERS, type DevDrawerKey } from "../../lib/devPrompt";

const ACTIONS: Partial<Record<DevDrawerKey, string[]>> = {
  build: ["dotnet build", "dotnet test", "npm test"],
  git: ["git status"],
};

export default function DevTaskPanel({
  drawers,
  onChange,
}: {
  drawers: Record<DevDrawerKey, string>;
  onChange: (key: DevDrawerKey, text: string) => void;
}) {
  const [open, setOpen] = useState<DevDrawerKey | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);

  function show(key: DevDrawerKey) {
    setOpen(key);
    setDraft(drawers[key]);
    setNote(null);
  }

  return (
    <>
      <div className="grid grid-cols-5 gap-1 border-b border-white/10 bg-[#0c1424] px-2 py-1.5" role="toolbar" aria-label="Gavetas de engenharia">
        {DEV_DRAWERS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => show(d.key)}
            className="truncate rounded border border-white/10 px-2 py-1.5 text-left text-[11px] text-mute hover:border-accent/50 hover:text-fg"
          >
            {d.name}
          </button>
        ))}
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setOpen(null)}>
          <div className="flex h-[70vh] w-full max-w-2xl flex-col rounded-xl border border-white/10 bg-[#0c1424] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">{DEV_DRAWERS.find((d) => d.key === open)?.name}</h2>
              <button type="button" onClick={() => setOpen(null)} className="text-mute hover:text-fg" aria-label="Fechar">
                ×
              </button>
            </div>
            {ACTIONS[open] && (
              <div className="mb-2 flex flex-wrap gap-2">
                {ACTIONS[open]!.map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    className="rounded border border-accent/30 px-2 py-1 text-[11px] text-accent hover:bg-accent/10"
                    onClick={() => {
                      setNote("rodando…");
                      api
                        .devCommand(cmd)
                        .then((r) => {
                          const block = `$ ${cmd}\n(exit ${r.exitCode})\n${r.output}`;
                          setDraft((d) => (d ? d + "\n\n" + block : block));
                          setNote(r.exitCode === 0 ? "concluído" : `saiu com ${r.exitCode}`);
                        })
                        .catch((e: Error) => setNote(e.message));
                    }}
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            )}
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-0 flex-1 resize-none rounded border border-white/10 bg-black/30 p-2 font-mono text-xs outline-none focus:border-accent" />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-mute">{note}</span>
              <button
                type="button"
                className="rounded bg-accent px-3 py-1 text-sm text-bg"
                onClick={() => {
                  onChange(open, draft);
                  setOpen(null);
                }}
              >
                Salvar gaveta
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
