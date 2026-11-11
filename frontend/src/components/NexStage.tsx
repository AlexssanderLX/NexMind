import { useRef, type ReactNode } from "react";
import NeuralCore from "../core/NeuralCore";
import { PROFILES } from "../core/profiles";
import { stateLabel } from "../core/events";
import type { NexCore, PanelId } from "../hooks/useNexCore";
import PanelsLayer, { type ActivityInfo, type RunItem, type ToolItem } from "./panels/PanelsLayer";
import PerfHud from "./PerfHud";

const DOCK: { id: PanelId; label: string }[] = [
  { id: "activity", label: "Atividade" },
  { id: "tools", label: "Ferramentas" },
  { id: "runs", label: "Execuções" },
];

/**
 * Palco do Nex: o núcleo neural centralizado na área de conteúdo (sem contar a sidebar), a conversa por cima,
 * a saudação da tela inicial, o dock de painéis e os painéis flutuantes.
 * Camadas: núcleo (z-0) · conversa (z-10) · dock (z-30) · painéis (z-30) · medidor (z-40).
 */
export default function NexStage({
  core,
  empty,
  streaming,
  hero,
  info,
  runs,
  tools,
  children,
}: {
  core: NexCore;
  empty: boolean;
  streaming: boolean;
  hero: ReactNode;
  info: Omit<ActivityInfo, "stateLabel" | "micOn" | "profileLabel">;
  runs: RunItem[];
  tools: ToolItem[];
  children: ReactNode;
}) {
  const hitRef = useRef<HTMLDivElement>(null);
  const presence = streaming ? "active" : empty ? "hero" : "dim";
  const profile = PROFILES[core.profile];

  return (
    <div className="relative min-h-0 flex-1">
      <NeuralCore
        ref={core.coreRef}
        enabled={core.enabled}
        profile={core.profile}
        state={core.state}
        palette={core.palette}
        follow={core.follow}
        presence={presence}
        getLevel={core.getLevel}
        hitRef={hitRef}
        onSphereClick={core.onSphereClick}
        onUnavailable={core.onUnavailable}
      />

      {/* conversa: rolável, por cima do núcleo; as áreas vazias dela (data-core-hit) deixam o clique chegar à esfera */}
      <div ref={hitRef} data-core-hit className="absolute inset-0 z-10 overflow-y-auto px-6 py-6">
        {children}
      </div>

      {empty && (
        <div data-core-hit className="pointer-events-none absolute inset-x-0 bottom-6 z-10 px-6 text-center">
          {hero}
        </div>
      )}

      <div
        data-no-core
        className="absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 gap-1 overflow-x-auto whitespace-nowrap rounded-full border border-line bg-panel/70 p-1 text-xs"
      >
        {DOCK.map((d) => (
          <button
            key={d.id}
            aria-pressed={core.panels[d.id]}
            onClick={() => core.togglePanel(d.id)}
            className={`rounded-full px-3 py-1 transition-colors ${
              core.panels[d.id] ? "bg-accent/20 text-accent" : "text-mute hover:text-fg"
            }`}
          >
            {d.label}
          </button>
        ))}
        <span className="mx-0.5 my-1 w-px bg-line" />
        <button
          aria-pressed={core.micOn}
          onClick={() => void core.toggleMic()}
          title="Falar com o Nex. Uma pausa envia a frase. O navegador pede permissão no primeiro uso."
          className={`rounded-full px-3 py-1 transition-colors ${
            core.micOn ? "bg-red-500/20 text-red-300" : "text-mute hover:text-fg"
          }`}
        >
          {core.micOn ? "● Microfone" : "Microfone"}
        </button>
      </div>

      <PanelsLayer
        panels={core.panels}
        onClose={core.togglePanel}
        glass={profile.glass}
        info={{ ...info, stateLabel: stateLabel(core.state), micOn: core.micOn, profileLabel: profile.label }}
        runs={runs}
        tools={tools}
        demo={core.demo}
        coreRef={core.coreRef}
      />

      {core.demo && (
        <div
          data-no-core
          className="pointer-events-none absolute left-3 top-3 z-40 rounded-full border border-amber-400/50 bg-black/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-300"
        >
          Demonstração · {stateLabel(core.state)}
        </div>
      )}

      {core.showPerf && core.enabled && <PerfHud coreRef={core.coreRef} />}
    </div>
  );
}
