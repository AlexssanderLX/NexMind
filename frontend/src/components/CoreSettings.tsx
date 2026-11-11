import { CORE_STATES, type CoreState } from "../core/events";
import { PROFILE_LIST, PROFILES, type ProfileId } from "../core/profiles";

export interface CoreSettingsProps {
  profile: ProfileId;
  onProfile: (p: ProfileId) => void;
  follow: number;
  onFollow: (v: number) => void;
  demo: boolean;
  onDemo: (on: boolean) => void;
  demoState: CoreState;
  onDemoState: (s: CoreState) => void;
  showPerf: boolean;
  onShowPerf: (v: boolean) => void;
}

const field =
  "mt-1 w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent/60";

/** Seção "Núcleo neural" das configurações: perfil gráfico, modo demonstrativo e medidor de FPS. */
export default function CoreSettings(p: CoreSettingsProps) {
  return (
    <div className="space-y-3 border-t border-line pt-3 sm:col-span-3">
      <div className="text-xs font-medium text-fg">Núcleo neural</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-mute sm:col-span-1">
          Perfil gráfico
          <select className={field} value={p.profile} onChange={(e) => p.onProfile(e.target.value as ProfileId)}>
            {PROFILE_LIST.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.label}
              </option>
            ))}
          </select>
        </label>
        <p className="self-end text-[11px] leading-relaxed text-mute sm:col-span-2">{PROFILES[p.profile].description}</p>
      </div>

      <label className="block text-xs text-mute">
        Seguir o cursor: {Math.round(p.follow * 100)}%
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(p.follow * 100)}
          onChange={(e) => p.onFollow(Number(e.target.value) / 100)}
          className="mt-1 block w-full accent-cyan-400 sm:max-w-xs"
        />
        <span className="text-[11px]">
          Quanto o lado da esfera voltado para o cursor se alonga e a esfera se inclina. Ela não sai do lugar e fica
          sempre dentro da área visível. Só acompanha o cursor sobre a área do núcleo (não na barra lateral). 0%
          desliga.
        </span>
      </label>

      <label className="flex items-center gap-2 text-xs text-mute">
        <input type="checkbox" checked={p.showPerf} onChange={(e) => p.onShowPerf(e.target.checked)} className="accent-cyan-400" />
        Mostrar FPS e tempos do núcleo (canto inferior direito)
      </label>

      <label className="flex items-center gap-2 text-xs text-mute">
        <input type="checkbox" checked={p.demo} onChange={(e) => p.onDemo(e.target.checked)} className="accent-cyan-400" />
        Modo demonstrativo: anima o núcleo com estados e áudio de teste
      </label>
      {p.demo && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {CORE_STATES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => p.onDemoState(s.id)}
                aria-pressed={p.demoState === s.id}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  p.demoState === s.id ? "border-accent/60 bg-accent/15 text-accent" : "border-line text-mute hover:text-fg"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-amber-300/90">
            DEMONSTRAÇÃO: o áudio é um sinal sintético e os estados são forçados por estes botões. Não é uma conversa
            nem voz real. Sucesso e erro disparam um efeito breve; os outros ficam ativos até você trocar.
          </p>
        </div>
      )}
      <p className="text-[11px] text-mute">
        Clique na esfera para trocar a cor (a cor de destaque do app acompanha). O microfone fica ao lado do botão de
        enviar e no topo (Microfone); o navegador pede a permissão no primeiro uso.
      </p>
    </div>
  );
}
