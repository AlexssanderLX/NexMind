import { useCallback, useEffect, useRef, useState } from "react";
import { startDemoAudio, type AudioSource } from "../core/audio";
import { onNexEvents, type CoreState } from "../core/events";
import type { NeuralCoreHandle } from "../core/NeuralCore";
import { clampPalette, PALETTES } from "../core/palettes";
import { isProfileId, type ProfileId } from "../core/profiles";

export type PanelId = "activity" | "tools" | "runs";

/** O microfone de verdade é da voz (useVoice). O núcleo só mostra o estado e aciona o mesmo botão. */
export interface MicControl {
  active: boolean;
  toggle: () => void;
}

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* sem armazenamento: tudo bem */
    }
  },
};

/**
 * Estado do núcleo neural: qual estado visual mostrar, perfil gráfico, cor, seguimento do cursor, modo
 * demonstrativo e painéis. Fica fora do App.tsx para não inchar o arquivo compartilhado.
 *
 * Não captura áudio: o microfone e a fala são do módulo de voz, que comanda o núcleo emitindo `emitNexState` e
 * `emitNexAudioLevel` (ver core/events.ts). O botão de microfone do dock só chama o mesmo `mic.toggle` do campo
 * de texto.
 *
 * Prioridade do estado: sucesso/erro momentâneo > demonstração > estado emitido pela voz/ferramentas (se não for
 * repouso) > resposta em andamento (pensando) > repouso.
 */
export function useNexCore({ streaming, bgAnim, mic }: { streaming: boolean; bgAnim: boolean; mic?: MicControl }) {
  const coreRef = useRef<NeuralCoreHandle>(null);

  const [profile, setProfileState] = useState<ProfileId>(() => {
    const v = store.get("nexProfile");
    return isProfileId(v) ? v : "max";
  });
  const [showPerf, setShowPerfState] = useState(() => store.get("nexPerf") === "1");
  const [palette, setPalette] = useState(() => clampPalette(Number(store.get("nexPalette"))));
  const [follow, setFollowState] = useState(() => {
    const raw = store.get("nexFollow");
    const n = Number(raw);
    return raw === null || Number.isNaN(n) ? 0.5 : Math.max(0, Math.min(1, n));
  });
  const setFollow = useCallback((v: number) => {
    setFollowState(v);
    store.set("nexFollow", String(v));
  }, []);
  const [fallback, setFallback] = useState(false);
  const [demo, setDemo] = useState(false);
  const [demoState, setDemoStateValue] = useState<CoreState>("idle");
  const [flash, setFlash] = useState<"success" | "error" | null>(null);
  const [external, setExternal] = useState<CoreState | null>(null);
  const [panels, setPanels] = useState<Record<PanelId, boolean>>(() => {
    return { activity: false, tools: false, runs: false };
  });

  const demoAudioRef = useRef<AudioSource | null>(null);
  const externalLevel = useRef(0);
  const flashTimer = useRef<number | null>(null);
  const demoStateRef = useRef(demoState);
  demoStateRef.current = demoState;

  const setProfile = useCallback((p: ProfileId) => {
    setProfileState(p);
    store.set("nexProfile", p);
  }, []);

  const setShowPerf = useCallback((v: boolean) => {
    setShowPerfState(v);
    store.set("nexPerf", v ? "1" : "0");
  }, []);

  /** Sucesso ou erro momentâneo (expansão luminosa / oscilação), que volta sozinho ao estado de base. */
  const triggerFlash = useCallback((kind: "success" | "error" | null) => {
    if (!kind) return;
    setFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), kind === "error" ? 1800 : 1500);
  }, []);

  const pickDemoState = useCallback(
    (s: CoreState) => {
      if (s === "success" || s === "error") triggerFlash(s);
      else setDemoStateValue(s);
    },
    [triggerFlash],
  );

  const setDemoMode = useCallback((on: boolean) => {
    setDemo(on);
    if (!on) setDemoStateValue("idle");
  }, []);

  useEffect(() => {
    if (!demo) return;
    demoAudioRef.current = startDemoAudio();
    return () => {
      demoAudioRef.current?.stop();
      demoAudioRef.current = null;
    };
  }, [demo]);

  /** Clique na esfera: próxima cor. A cor de destaque do app acompanha (variável CSS --color-accent). */
  const onSphereClick = useCallback(() => {
    setPalette((p) => {
      const next = (p + 1) % PALETTES.length;
      store.set("nexPalette", String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--color-accent", PALETTES[palette].accent);
  }, [palette]);

  const getLevel = useCallback(() => {
    if (demoAudioRef.current && (demoStateRef.current === "listening" || demoStateRef.current === "speaking"))
      return demoAudioRef.current.level();
    return externalLevel.current;
  }, []);

  // a voz (e, no futuro, as ferramentas) comanda o núcleo só emitindo eventos
  useEffect(
    () =>
      onNexEvents({
        state: setExternal,
        level: (l) => {
          externalLevel.current = l;
        },
      }),
    [],
  );

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const togglePanel = useCallback((id: PanelId) => {
    setPanels((p) => {
      const open = !p[id];
      // em tela pequena os painéis viram "folhas" na base: um por vez
      if (window.matchMedia("(max-width: 767px)").matches) return { activity: false, tools: false, runs: false, [id]: open };
      return { ...p, [id]: open };
    });
  }, []);

  const pulse = useCallback((amount?: number) => coreRef.current?.pulse(amount), []);

  const base: CoreState = demo
    ? demoState
    : external && external !== "idle"
      ? external
      : streaming
        ? "thinking"
        : "idle";
  const state: CoreState = flash ?? base;

  return {
    coreRef,
    enabled: bgAnim && !fallback,
    fallback,
    onUnavailable: useCallback(() => setFallback(true), []),
    state,
    profile,
    setProfile,
    showPerf,
    setShowPerf,
    micOn: mic?.active ?? false,
    toggleMic: mic?.toggle ?? (() => {}),
    palette,
    follow,
    demo,
    demoState,
    getLevel,
    onSphereClick,
    panels,
    togglePanel,
    pulse,
    flash: triggerFlash,
    /** Props prontas para a seção "Núcleo neural" das configurações. */
    settingsProps: {
      profile,
      onProfile: setProfile,
      follow,
      onFollow: setFollow,
      demo,
      onDemo: setDemoMode,
      demoState,
      onDemoState: pickDemoState,
      showPerf,
      onShowPerf: setShowPerf,
    },
  };
}

export type NexCore = ReturnType<typeof useNexCore>;
