import type { OllamaStatus, Settings, VoiceSettings, VoiceStatus } from "../types";
import CoreSettings, { type CoreSettingsProps } from "./CoreSettings";

export type SettingsTab = "modelos" | "nucleo" | "voz";

const field =
  "mt-1 w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent/60";

export interface SettingsPanelProps {
  tab: SettingsTab;
  settings: Settings;
  onChange: (s: Settings) => void;
  status: OllamaStatus | null;
  bgAnim: boolean;
  onBgAnim: (v: boolean) => void;
  core: CoreSettingsProps;
  voice: VoiceSettings;
  onVoice: (v: VoiceSettings) => void;
  voiceStatus: VoiceStatus | null;
  devices: MediaDeviceInfo[];
}

/** Conteúdo de uma aba da janela de configurações (ver SettingsModal). */
export default function SettingsPanel({
  tab,
  settings,
  onChange,
  status,
  bgAnim,
  onBgAnim,
  core,
  voice,
  onVoice,
  voiceStatus,
  devices,
}: SettingsPanelProps) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const installed = (name: string) => !status?.connected || status.models.some((m) => m.name === name);
  const setVoice = <K extends keyof VoiceSettings>(k: K, v: VoiceSettings[K]) => onVoice({ ...voice, [k]: v });
  const engines = (kind: string) => voiceStatus?.engines.filter((e) => e.kind === kind) ?? [];

  if (tab === "nucleo") {
    return (
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-xs text-mute">
          <input type="checkbox" checked={bgAnim} onChange={(e) => onBgAnim(e.target.checked)} className="accent-cyan-400" />
          Núcleo neural 3D (desligue para o mínimo de consumo)
        </label>
        <CoreSettings {...core} />
      </div>
    );
  }

  if (tab === "voz") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="col-span-full flex items-center gap-2 text-xs text-mute">
          <input type="checkbox" checked={voice.enabled} onChange={(e) => setVoice("enabled", e.target.checked)} className="accent-cyan-400" />
          Voz local (microfone e resposta falada). O áudio não é gravado.
        </label>
        <label className="text-xs text-mute">
          Modo
          <select className={field} value={voice.mode} onChange={(e) => setVoice("mode", e.target.value as VoiceSettings["mode"])}>
            <option value="auto">Automático (pausa encerra o turno)</option>
            <option value="manual">Manual (clique de novo para enviar)</option>
          </select>
        </label>
        <label className="text-xs text-mute">
          Microfone
          <select className={field} value={voice.inputDeviceId} onChange={(e) => setVoice("inputDeviceId", e.target.value)}>
            <option value="">Padrão do sistema</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || "Microfone"}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-mute">
          Voz sintetizada
          <select className={field} value={voice.ttsVoice} onChange={(e) => setVoice("ttsVoice", e.target.value)}>
            <option value="">Padrão do Windows</option>
            {(voiceStatus?.voices ?? []).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-mute">
          Reconhecimento
          <select className={field} value={voice.sttEngine} onChange={(e) => setVoice("sttEngine", e.target.value)}>
            {engines("stt").map((e) => (
              <option key={e.id} value={e.id} disabled={!e.available}>{e.id}{e.available ? "" : " (indisponível)"}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-mute">
          Síntese
          <select className={field} value={voice.ttsEngine} onChange={(e) => setVoice("ttsEngine", e.target.value)}>
            {engines("tts").map((e) => (
              <option key={e.id} value={e.id} disabled={!e.available}>{e.id}{e.available ? "" : " (indisponível)"}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-mute">
          Velocidade da fala ({voice.speechRate.toFixed(1)})
          <input className={field} type="range" min={0.6} max={1.6} step={0.1} value={voice.speechRate} onChange={(e) => setVoice("speechRate", Number(e.target.value))} />
        </label>
        <label className="text-xs text-mute">
          Pausa para fim de turno ({voice.vadSilenceMs} ms)
          <input className={field} type="range" min={400} max={2000} step={50} value={voice.vadSilenceMs} onChange={(e) => setVoice("vadSilenceMs", Number(e.target.value))} />
        </label>
        <label className="text-xs text-mute">
          Sensibilidade do microfone ({voice.vadSensitivity.toFixed(2)})
          <input className={field} type="range" min={0.02} max={0.2} step={0.01} value={voice.vadSensitivity} onChange={(e) => setVoice("vadSensitivity", Number(e.target.value))} />
        </label>
        <p className="col-span-full text-[11px] text-mute">
          A pausa maior tolera respirações no meio da frase. O reconhecimento (faster-whisper) roda na CPU; o Qwen
          continua na GPU. Piper entra quando Voice:PiperExe e Voice:PiperModel estiverem preenchidos. Uma frase
          reconhecida não dispara ferramentas.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
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
          onChange={(e) => set("numCtx", Math.max(256, Number(e.target.value) || 32768))}
        />
        <span className="mt-1 block">Acima de 16.384, 24 camadas ficam na GPU e 12 na RAM desde o início.</span>
      </label>
      <label className="col-span-full text-xs text-mute">
        Prompt de sistema (opcional)
        <textarea
          className={`${field} h-16 resize-y`}
          value={settings.system}
          onChange={(e) => set("system", e.target.value)}
          placeholder="Ex.: Você é o Nex, um assistente técnico. Responda sempre em português."
        />
      </label>
      <p className="col-span-full text-[11px] text-mute">
        O botão "Raciocínio" no campo de texto escolhe qual modelo responde a próxima mensagem. A conversa é a mesma nos
        dois modos. Valem para as próximas mensagens; contexto maior consome mais VRAM/RAM.
      </p>
    </div>
  );
}
