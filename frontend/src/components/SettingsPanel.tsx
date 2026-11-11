import type { OllamaStatus, Settings } from "../types";

const field =
  "mt-1 w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent/60";

export default function SettingsPanel({
  settings,
  onChange,
  status,
  bgAnim,
  onBgAnim,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  status: OllamaStatus | null;
  bgAnim: boolean;
  onBgAnim: (v: boolean) => void;
}) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const installed = (name: string) => !status?.connected || status.models.some((m) => m.name === name);

  return (
    <div className="relative z-10 grid gap-3 border-y border-line bg-side/95 px-6 py-4 sm:grid-cols-3">
      <label className="text-xs text-mute">
        Modelo de conversa (rápido)
        <input
          className={field}
          list="installed-models"
          value={settings.chatModel}
          onChange={(e) => set("chatModel", e.target.value)}
          placeholder="qwen3:4b-instruct"
        />
        {!installed(settings.chatModel) && (
          <span className="text-red-400">Não instalado: ollama pull {settings.chatModel}</span>
        )}
      </label>
      <label className="text-xs text-mute">
        Modelo de raciocínio
        <input
          className={field}
          list="installed-models"
          value={settings.reasoningModel}
          onChange={(e) => set("reasoningModel", e.target.value)}
          placeholder="qwen3:4b"
        />
        {!installed(settings.reasoningModel) && (
          <span className="text-red-400">Não instalado: ollama pull {settings.reasoningModel}</span>
        )}
        <datalist id="installed-models">
          {status?.models.map((m) => (
            <option key={m.name} value={m.name} />
          ))}
        </datalist>
      </label>
      <label className="text-xs text-mute">
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
      <label className="text-xs text-mute sm:col-span-3">
        Prompt de sistema (opcional)
        <textarea
          className={`${field} h-16 resize-y`}
          value={settings.system}
          onChange={(e) => set("system", e.target.value)}
          placeholder="Ex.: Você é o Nex, um assistente técnico. Responda sempre em português."
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-mute sm:col-span-3">
        <input type="checkbox" checked={bgAnim} onChange={(e) => onBgAnim(e.target.checked)} className="accent-cyan-400" />
        Animação 3D de fundo (usa um pouco de CPU; desligue se quiser o mínimo de consumo)
      </label>
      <p className="text-[11px] text-mute sm:col-span-3">
        O botão "Raciocínio" no campo de texto escolhe qual modelo responde a próxima mensagem. A conversa é a mesma nos
        dois modos. Valem para as próximas mensagens; contexto maior consome mais VRAM/RAM.
      </p>
    </div>
  );
}
