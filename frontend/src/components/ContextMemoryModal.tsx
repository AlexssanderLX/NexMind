import { useEffect, useState } from "react";
import { api } from "../api";
import { usePolling } from "../hooks/usePolling";
import { CONTEXT_PROFILES } from "../types";

function barColor(percent: number) {
  return percent > 85 ? "bg-red-500" : percent > 60 ? "bg-amber-400" : "bg-emerald-400";
}

export default function ContextMemoryModal({
  conversationId,
  numCtx,
  onClose,
  onReset,
}: {
  conversationId: string | null;
  numCtx: number;
  onClose: () => void;
  onReset: (newNumCtx: number) => void;
}) {
  const [tokensActive, setTokensActive] = useState(0);
  const [ceiling, setCeiling] = useState(numCtx);
  const [profileCtx, setProfileCtx] = useState(numCtx);
  const [saveSnapshot, setSaveSnapshot] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePolling(() => {
    if (!conversationId) return;
    api
      .get(conversationId)
      .then((c) => {
        setTokensActive(c.tokensActive ?? 0);
        setCeiling(c.numCtx ?? numCtx);
      })
      .catch(() => {});
  }, 1500);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !resetting && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, resetting]);

  const percent = ceiling > 0 ? Math.min(100, Math.round((tokensActive / ceiling) * 100)) : 0;

  async function handleReset() {
    if (!conversationId) {
      setError("Nenhuma conversa ativa para resetar.");
      return;
    }
    setResetting(true);
    setError(null);
    try {
      const r = await api.snapshotReset(conversationId, saveSnapshot, profileCtx);
      onReset(r.num_ctx);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não consegui resetar o contexto.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !resetting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Contexto & Memória"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-accent/20 bg-side p-6 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold">🧠 Contexto & Memória</h2>
          <button
            onClick={() => !resetting && onClose()}
            className="rounded-lg px-2 py-1 text-mute hover:bg-white/5 hover:text-fg"
            title="Fechar (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <div className="flex justify-between text-sm">
              <span className="text-mute">Tokens ativos no contexto</span>
              <span className="tabular-nums">
                {tokensActive.toLocaleString("pt-BR")} / {ceiling.toLocaleString("pt-BR")} tokens ({percent}% usado)
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full ${barColor(percent)} transition-all duration-500`} style={{ width: `${percent}%` }} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm text-mute">Perfil de contexto</p>
            <div className="space-y-1.5">
              {CONTEXT_PROFILES.map((p) => (
                <label
                  key={p.label}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    profileCtx === p.numCtx ? "border-accent/60 bg-accent/10" : "border-line hover:bg-white/5"
                  }`}
                >
                  <input
                    type="radio"
                    name="context-profile"
                    className="mt-0.5"
                    checked={profileCtx === p.numCtx}
                    onChange={() => setProfileCtx(p.numCtx)}
                  />
                  <span>
                    <span className="font-medium text-fg">
                      {p.label} ({p.numCtx.toLocaleString("pt-BR")} tokens)
                    </span>
                    <span className="block text-xs text-mute">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={saveSnapshot} onChange={(e) => setSaveSnapshot(e.target.checked)} />
            <span>
              <span className="text-fg">Consolidar Snapshot de Memória antes de limpar</span>
              <span className="block text-xs text-mute">
                Gera um resumo executivo forense (decisões, endpoints e arquivos tocados) e salva em{" "}
                <code>memory_snapshot.json</code> antes de zerar o contexto.
              </span>
            </span>
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={resetting}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-mute hover:bg-white/5 hover:text-fg disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting || !conversationId}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg shadow-[0_0_12px_rgba(0,240,255,0.35)] hover:opacity-90 disabled:opacity-50"
            >
              {resetting ? "Resetando…" : "🧹 Consolidar & Resetar para 0k"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
