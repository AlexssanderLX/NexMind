import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import type { CoreState } from "./events";
import { PALETTES } from "./palettes";
import { PROFILES, type ProfileId } from "./profiles";
import { createCore, type CoreHandle, type CoreStats } from "./scene";

export interface NeuralCoreHandle {
  /** Impulso breve de energia (ex.: a cada lote de tokens da resposta). */
  pulse(amount?: number): void;
  stats(): CoreStats | null;
}

interface Props {
  enabled: boolean;
  profile: ProfileId;
  state: CoreState;
  /** índice da paleta de cores (ver palettes.ts) */
  palette: number;
  /** intensidade do seguimento do cursor, 0..1 */
  follow: number;
  /** hero: tela inicial (esfera cheia) · active: respondendo · dim: esmaecida atrás de uma conversa */
  presence: "hero" | "active" | "dim";
  getLevel: () => number;
  /** Elemento que recebe o cursor "mão" quando o ponteiro está sobre a esfera. */
  hitRef: RefObject<HTMLElement | null>;
  onSphereClick: () => void;
  /** WebGL indisponível ou contexto perdido: quem usa cai para o fundo 2D. */
  onUnavailable: () => void;
}

// Com uma conversa na tela o texto precisa ser legível: a esfera encolhe e escurece bastante, ficando só como um
// brilho suave de fundo. Na tela inicial (hero) ela tem o brilho total.
const PRESENCE: Record<Props["presence"], [scale: number, intensity: number]> = {
  hero: [1, 1],
  active: [0.72, 0.3],
  dim: [0.66, 0.2],
};

/** Elementos que mantêm o comportamento normal (texto, botões, mensagens): o núcleo nunca reage a cliques neles. */
const INTERACTIVE = "button, a, input, textarea, select, summary, label, [data-no-core]";

declare global {
  interface Window {
    /** Gancho de teste/medição: expõe o núcleo ativo. */
    __nexCore?: CoreHandle;
  }
}

export default forwardRef<NeuralCoreHandle, Props>(function NeuralCore(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coreRef = useRef<CoreHandle | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(
    ref,
    () => ({
      pulse: (a) => coreRef.current?.pulse(a),
      stats: () => coreRef.current?.stats() ?? null,
    }),
    [],
  );

  // criação e destruição da cena
  useEffect(() => {
    if (!props.enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const core = createCore(canvas, PROFILES[propsRef.current.profile], {
      onContextLost: () => propsRef.current.onUnavailable(),
    });
    if (!core) {
      propsRef.current.onUnavailable();
      return;
    }
    coreRef.current = core;
    core.setAudioProvider(() => propsRef.current.getLevel());
    core.setState(propsRef.current.state);
    core.setPresence(...PRESENCE[propsRef.current.presence]);
    const pal = PALETTES[propsRef.current.palette];
    core.setPalette(pal.near, pal.far, true); // começa já na cor salva, sem transição
    core.setFollow(propsRef.current.follow);
    window.__nexCore = core;
    return () => {
      core.dispose();
      coreRef.current = null;
      delete window.__nexCore;
    };
  }, [props.enabled]);

  useEffect(() => {
    coreRef.current?.setProfile(PROFILES[props.profile]);
  }, [props.profile]);

  useEffect(() => {
    coreRef.current?.setState(props.state);
  }, [props.state]);

  useEffect(() => {
    coreRef.current?.setPresence(...PRESENCE[props.presence]);
  }, [props.presence]);

  useEffect(() => {
    const pal = PALETTES[props.palette];
    coreRef.current?.setPalette(pal.near, pal.far);
  }, [props.palette]);

  useEffect(() => {
    coreRef.current?.setFollow(props.follow);
  }, [props.follow]);

  // ponteiro: acompanhar o cursor, hover, clique e toque (sem capturar eventos de campos e botões)
  useEffect(() => {
    if (!props.enabled) return;
    const overHit = (t: EventTarget | null) => t instanceof Element && !t.closest(INTERACTIVE) && !!t.closest("[data-core-hit]");

    const onMove = (e: PointerEvent) => {
      const core = coreRef.current;
      const canvas = canvasRef.current;
      if (!core || !canvas) return;
      // O núcleo só acompanha o cursor dentro da própria área: sobre a barra lateral, o cabeçalho ou o campo de
      // texto ele perde o movimento e volta ao repouso.
      const r = canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      core.setPointer(inside ? e.clientX : null, inside ? e.clientY : null);
      const el = propsRef.current.hitRef.current;
      if (el) el.style.cursor = inside && core.hitTest(e.clientX, e.clientY) && overHit(e.target) ? "pointer" : "";
    };

    const onDown = (e: PointerEvent) => {
      const core = coreRef.current;
      if (!core) return;
      core.setPointer(e.clientX, e.clientY);
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!overHit(e.target) || !core.hitTest(e.clientX, e.clientY)) return;
      core.setPressed(true);
      core.ripple(e.clientX, e.clientY);
      propsRef.current.onSphereClick();
    };

    const onUp = (e: PointerEvent) => {
      const core = coreRef.current;
      if (!core) return;
      core.setPressed(false);
      if (e.pointerType !== "mouse") core.setPointer(null, null); // toque: sem cursor depois de soltar
    };

    const onLeave = () => coreRef.current?.setPointer(null, null);

    // Clicar no cartão de uma mensagem (data-color-card), da IA ou sua, também troca a cor. Não atrapalha copiar:
    // com texto selecionado, ou em link, botão, raciocínio (summary), código e tabela, não faz nada.
    const onCardClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.closest("[data-color-card]")) return;
      if (t.closest("a, button, summary, input, textarea, select, label, pre, code, table")) return;
      if (window.getSelection()?.toString()) return;
      propsRef.current.onSphereClick();
    };

    window.addEventListener("click", onCardClick);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("click", onCardClick);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [props.enabled]);

  if (!props.enabled) return null;
  // preto + mix-blend-mode: screen = o fundo preto do WebGL some e só o brilho se soma ao fundo da página
  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
        style={{ mixBlendMode: "screen" }}
      />
      {/* véu escuro entre o núcleo e a conversa: aparece quando há mensagens, para o texto ficar bem legível */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[5] transition-opacity duration-500"
        style={{
          opacity: props.presence === "hero" ? 0 : 1,
          background: "radial-gradient(ellipse at 50% 45%, rgba(3,7,15,0.55) 0%, rgba(3,7,15,0.78) 75%)",
        }}
      />
    </>
  );
});
