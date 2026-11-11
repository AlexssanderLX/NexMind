import type { OllamaStatus, Settings } from "../types";

const field = "w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-neutral-500";

export default function SettingsPanel({
  settings,
  onChange,
  status,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  status: OllamaStatus | null;
}) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  return (
    <div className="grid gap-3 border-b border-neutral-800 bg-neutral-900/50 px-4 py-3 sm:grid-cols-3">
      <label className="text-xs text-neutral-400">
        Modelo
        <input
          className={field}
          list="installed-models"
          value={settings.model}
          onChange={(e) => set("model", e.target.value)}
          placeholder="qwen3:8b"
        />
        <datalist id="installed-models">
          {status?.models.map((m) => (
            <option key={m.name} value={m.name} />
          ))}
        </datalist>
      </label>
      <label className="text-xs text-neutral-400">
        Contexto (tokens)
        <input
          className={field}
          type="number"
          min={256}
          step={512}
          value={settings.numCtx}
          onChange={(e) => set("numCtx", Math.max(256, Number(e.target.value) || 4096))}
        />
      </label>
      <label className="text-xs text-neutral-400">
        Raciocínio (thinking)
        <select className={field} value={settings.think} onChange={(e) => set("think", e.target.value as Settings["think"])}>
          <option value="auto">Padrão do modelo</option>
          <option value="on">Ligado</option>
          <option value="off">Desligado (mais rápido)</option>
        </select>
      </label>
      <label className="text-xs text-neutral-400 sm:col-span-3">
        Prompt de sistema (opcional)
        <textarea
          className={`${field} h-16 resize-y`}
          value={settings.system}
          onChange={(e) => set("system", e.target.value)}
          placeholder="Ex.: Você é um assistente técnico. Responda sempre em português."
        />
      </label>
      <p className="text-[11px] text-neutral-500 sm:col-span-3">
        Valem para as próximas mensagens. Contexto maior consome mais VRAM/RAM. Modelos sem suporte a "thinking" podem
        dar erro se você forçar Ligado/Desligado — use Padrão. Atenção: o qwen3:4b atual só raciocina (variante
        "thinking"); "Desligado" não o impede de pensar e mistura o raciocínio na resposta. Mantenha em Padrão.
      </p>
    </div>
  );
}
