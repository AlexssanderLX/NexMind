/**
 * Contrato entre o núcleo visual e o resto do Nex.
 *
 * O núcleo não sabe de STT, TTS, ferramentas ou MCPs. Quem implementar essas partes no futuro só precisa emitir
 * estes eventos, sem tocar no código visual:
 *
 *   emitNexState("tool");          // execução de ferramenta em andamento
 *   emitNexAudioLevel(0.4);        // nível de áudio 0..1 (microfone ou saída de voz), ~30x por segundo
 *   emitNexState("idle");
 *
 * Hoje só o chat de texto (estado "thinking"/"success"/"error") e o microfone (visualização) existem de verdade.
 * Os demais estados só aparecem no modo demonstrativo ou se alguém emitir o evento.
 */
export type CoreState = "idle" | "listening" | "thinking" | "speaking" | "tool" | "success" | "error";

export const CORE_STATES: { id: CoreState; label: string }[] = [
  { id: "idle", label: "Repouso" },
  { id: "listening", label: "Ouvindo" },
  { id: "thinking", label: "Pensando" },
  { id: "speaking", label: "Falando" },
  { id: "tool", label: "Ferramenta" },
  { id: "success", label: "Sucesso" },
  { id: "error", label: "Erro" },
];

export const stateLabel = (s: CoreState) => CORE_STATES.find((c) => c.id === s)?.label ?? s;

export const NEX_STATE_EVENT = "nex:state";
export const NEX_AUDIO_EVENT = "nex:audio-level";

export function emitNexState(state: CoreState) {
  window.dispatchEvent(new CustomEvent(NEX_STATE_EVENT, { detail: { state } }));
}

export function emitNexAudioLevel(level: number) {
  window.dispatchEvent(new CustomEvent(NEX_AUDIO_EVENT, { detail: { level } }));
}

/** Assina os eventos acima. Retorna a função que cancela a assinatura. */
export function onNexEvents(handlers: { state?: (s: CoreState) => void; level?: (l: number) => void }): () => void {
  const onState = (e: Event) => handlers.state?.((e as CustomEvent<{ state: CoreState }>).detail.state);
  const onLevel = (e: Event) => handlers.level?.((e as CustomEvent<{ level: number }>).detail.level);
  window.addEventListener(NEX_STATE_EVENT, onState);
  window.addEventListener(NEX_AUDIO_EVENT, onLevel);
  return () => {
    window.removeEventListener(NEX_STATE_EVENT, onState);
    window.removeEventListener(NEX_AUDIO_EVENT, onLevel);
  };
}
