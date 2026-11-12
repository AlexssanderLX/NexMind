import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { countItems, findVault, lastSavedLabel, parseVault, type VaultKey } from "../lib/vaults";

/** Corpo da visualização formatada (separado do modal para renderizar em testes). */
export function VaultFormatted({ text }: { text: string }) {
  const blocks = parseVault(text);
  if (blocks.length === 0) return <p className="text-mute">Gaveta vazia. Os agentes anotam aqui, ou use Editar para escrever você mesmo.</p>;
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed">
      {blocks.map((b, i) =>
        b.kind === "h" ? (
          <h3 key={i} className="pt-2 text-sm font-semibold text-accent">
            {b.text}
          </h3>
        ) : b.kind === "li" ? (
          <p key={i} className="flex gap-2 pl-1">
            <span className="text-accent" aria-hidden>
              •
            </span>
            <span className="min-w-0 break-words">{b.text}</span>
          </p>
        ) : (
          <p key={i} className="break-words">
            {b.text}
          </p>
        ),
      )}
    </div>
  );
}

/**
 * Modal de uma gaveta da investigação: visualização formatada ou editor de texto/Markdown. Salvar grava nas notas da conversa
 * (security/vault/*.md); a partir daí os subagentes leem a versão editada. ESC ou o ✕ fecham (pedindo confirmação se há edição não salva).
 */
export default function SecurityVaultModal({
  vaultKey,
  conversationId,
  ensureConversation,
  onClose,
  onSaved,
}: {
  vaultKey: VaultKey;
  conversationId: string | null;
  ensureConversation: () => Promise<string>;
  onClose: () => void;
  onSaved: (key: VaultKey, count: number) => void;
}) {
  const vault = findVault(vaultKey);
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [loading, setLoading] = useState(!!conversationId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== saved;

  useEffect(() => {
    if (!conversationId) return;
    let alive = true;
    api
      .vaultGet(conversationId, vaultKey)
      .then((r) => {
        if (!alive) return;
        setSaved(r.text);
        setDraft(r.text);
        setUpdatedAt(r.updatedAt);
        setMode(r.text.trim() ? "view" : "edit");
      })
      .catch(() => alive && setError("Não consegui carregar a gaveta."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [conversationId, vaultKey]);

  function tryClose() {
    if (dirty && !window.confirm("Há alterações não salvas nesta gaveta. Fechar mesmo assim?")) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") tryClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (mode === "edit") areaRef.current?.focus();
  }, [mode, loading]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const id = conversationId ?? (await ensureConversation());
      const r = await api.vaultPut(id, vaultKey, draft);
      setSaved(r.text);
      setDraft(r.text);
      setUpdatedAt(r.updatedAt ?? new Date().toISOString());
      onSaved(vaultKey, countItems(r.text));
    } catch {
      setError("Não consegui salvar. Tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && tryClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Gaveta ${vault.name}`}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-accent/30 bg-[#0a1424]/95 shadow-[0_0_40px_rgba(34,211,238,0.18)]"
      >
        <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <span className="text-2xl" aria-hidden>
            {vault.icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-fg">{vault.name}</h2>
            <p className="truncate text-[11px] text-mute">{vault.hint}</p>
          </div>
          <div role="tablist" aria-label="Modo" className="flex rounded-lg border border-white/10 p-0.5 text-xs">
            {(["view", "edit"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1 ${mode === m ? "bg-accent/20 text-accent" : "text-mute hover:text-fg"}`}
              >
                {m === "view" ? "Formatada" : "Editar"}
              </button>
            ))}
          </div>
          <button onClick={tryClose} className="rounded-lg px-2 py-1 text-mute hover:bg-white/5 hover:text-fg" title="Fechar (Esc)" aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="min-h-[220px] flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-mute">Carregando…</p>
          ) : mode === "view" ? (
            <VaultFormatted text={draft} />
          ) : (
            <textarea
              ref={areaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              aria-label={`Texto da gaveta ${vault.name}`}
              placeholder={"# Título opcional\n- um item por linha\n- apague o que for lixo, corrija parâmetros, acrescente notas"}
              className="h-full min-h-[260px] w-full resize-y rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[13px] leading-relaxed text-fg outline-none focus:border-accent/60"
            />
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-white/10 px-5 py-3 text-xs">
          <span className="min-w-0 flex-1 truncate text-mute" role="status">
            {error ? <span className="text-red-300">{error}</span> : dirty ? "alterações não salvas" : lastSavedLabel(updatedAt)} · {countItems(draft)} item(ns)
          </span>
          <button onClick={tryClose} className="rounded-lg px-3 py-1.5 text-mute hover:bg-white/5 hover:text-fg">
            Fechar
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg border border-accent/50 bg-accent/15 px-4 py-1.5 font-medium text-accent hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Salvando…" : "Salvar Alterações"}
          </button>
        </footer>
      </div>
    </div>
  );
}
