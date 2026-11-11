import { useRef, type ReactNode } from "react";
import NeuralCore from "../core/NeuralCore";
import { PROFILES } from "../core/profiles";
import { stateLabel } from "../core/events";
import type { NexCore } from "../hooks/useNexCore";
import PanelsLayer, { type ActivityInfo, type RunItem, type ToolItem } from "./panels/PanelsLayer";
import PerfHud from "./PerfHud";

/**
 * Palco do Nex: o núcleo neural centralizado na área de conteúdo (sem contar a sidebar), a conversa por cima,
 * a saudação da tela inicial e os painéis flutuantes (bolinhas com ícone que abrem no próprio lugar e podem ser arrastadas).
 * Camadas: núcleo (z-0) · conversa (z-10) · painéis (z-30) · medidor (z-40).
 */
export default function NexStage({
  core,
  empty,
  streaming,
  hero,
  info,
  runs,
  tools,
  onToggleTool,
  children,
}: {
  core: NexCore;
  empty: boolean;
  streaming: boolean;
  hero: ReactNode;
  info: Omit<ActivityInfo, "stateLabel" | "micOn" | "profileLabel">;
  runs: RunItem[];
  tools: ToolItem[];
  onToggleTool?: (name: string) => void;
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

      <PanelsLayer
        panels={core.panels}
        onToggle={core.togglePanel}
        glass={profile.glass}
        info={{ ...info, stateLabel: stateLabel(core.state), micOn: core.micOn, profileLabel: profile.label }}
        runs={runs}
        tools={tools}
        onToggleTool={onToggleTool}
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
