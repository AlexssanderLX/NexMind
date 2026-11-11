import { useCallback, useEffect, useRef, useState } from "react";
import { startDemoAudio, startMic, type AudioSource } from "../core/audio";
import { onNexEvents, type CoreState } from "../core/events";
import type { NeuralCoreHandle } from "../core/NeuralCore";
import { clampPalette, PALETTES } from "../core/palettes";
import { isProfileId, type ProfileId } from "../core/profiles";

export type PanelId = "activity" | "tools" | "runs";

const MIC_NOTICE = "Microfone ativo — só visualização. A transcrição de voz ainda não está implementada.";

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
 * Estado do núcleo neural: qual estado visual mostrar, perfil gráfico, microfone (só visualização), modo
 * demonstrativo e painéis. Fica fora do App.tsx para não inchar o arquivo compartilhado.
 *
 * Prioridade do estado: sucesso/erro momentâneo > demonstração > microfone > resposta em andamento (pensando) >
 * estado emitido por outros módulos via `emitNexState` (voz, ferramentas) > repouso.
 */
export function useNexCore({ streaming, bgAnim }: { streaming: boolean; bgAnim: boolean }) {
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
  const [micOn, setMicOn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState<"success" | "error" | null>(null);
  const [external, setExternal] = useState<CoreState | null>(null);
  const [panels, setPanels] = useState<Record<PanelId, boolean>>({ activity: false, tools: false, runs: false });

  const micRef = useRef<AudioSource | null>(null);
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

  const stopMic = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    setMicOn(false);
    setNotice(null);
  }, []);

  /** Só é chamado a partir de um clique do usuário na esfera: é aí que o navegador pede permissão do microfone. */
  const toggleMic = useCallback(async () => {
    if (micRef.current) {
      stopMic();
      return;
    }
    try {
      micRef.current = await startMic();
      setMicOn(true);
      setNotice(MIC_NOTICE);
    } catch (e) {
      setNotice(`Não foi possível usar o microfone: ${(e as Error).message}`);
      triggerFlash("error");
      window.setTimeout(() => setNotice((n) => (n?.startsWith("Não foi possível") ? null : n)), 5000);
    }
  }, [stopMic, triggerFlash]);

  const pickDemoState = useCallback(
    (s: CoreState) => {
      if (s === "success" || s === "error") triggerFlash(s);
      else setDemoStateValue(s);
    },
    [triggerFlash],
  );

  const setDemoMode = useCallback(
    (on: boolean) => {
      if (on) stopMic();
      setDemo(on);
      if (!on) setDemoStateValue("idle");
    },
    [stopMic],
  );

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
    if (micRef.current) return micRef.current.level();
    if (demoAudioRef.current && (demoStateRef.current === "listening" || demoStateRef.current === "speaking"))
      return demoAudioRef.current.level();
    return externalLevel.current;
  }, []);

  // outros módulos (voz, ferramentas) comandam o núcleo só emitindo eventos
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

  // por privacidade, o microfone para quando a aba fica escondida
  useEffect(() => {
    const onHidden = () => document.hidden && stopMic();
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [stopMic]);

  useEffect(
    () => () => {
      micRef.current?.stop();
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

  const base: CoreState = demo ? demoState : micOn ? "listening" : streaming ? "thinking" : (external ?? "idle");
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
    micOn,
    toggleMic,
    notice,
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
