import { useEffect, useRef, useState } from "react";
import { emitNexAudioLevel, emitNexState } from "../core/events";
import type { VoiceSettings } from "../types";

export type VoicePhase = "off" | "listening" | "transcribing" | "speaking" | "error";

export type VoiceTimings = {
  sttMs: number | null;
  firstTokenMs: number | null;
  firstAudioMs: number | null;
  totalMs: number | null;
  note: string;
};

type Args = {
  settings: VoiceSettings;
  /** true enquanto o Ollama ainda está gerando */
  busy: boolean;
  onUtterance: (text: string, mark: number, spoken: boolean) => void;
  onInterrupt: () => void;
  onError: (message: string) => void;
};

const TARGET_RATE = 16000;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** Captura, VAD por energia (pausa configurável) e reprodução com cancelamento. */
export function useVoice({ settings, busy, onUtterance, onInterrupt, onError }: Args) {
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [conversation, setConversation] = useState(false);
  const conversationRef = useRef(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [partial, setPartial] = useState("");
  const phaseRef = useRef<VoicePhase>("off");
  const settingsRef = useRef(settings);
  const busyRef = useRef(busy);
  const gen = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const heardRef = useRef(false);
  const silenceMsRef = useRef(0);
  const lastTickRef = useRef(0);
  const speakingSinceRef = useRef(0);
  const rafRef = useRef(0);
  const playGen = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const queueRef = useRef<string[]>([]);
  const pumping = useRef(false);
  const turnOpen = useRef(false);
  const firstAudioAt = useRef<number | null>(null);
  const speakT0 = useRef(0);

  settingsRef.current = settings;
  busyRef.current = busy;

  function setPhaseBoth(p: VoicePhase) {
    phaseRef.current = p;
    setPhase(p);
    if (p === "off") emitNexState("idle");
    else if (p === "listening") emitNexState("listening");
    else if (p === "transcribing") emitNexState("thinking");
    else if (p === "speaking") emitNexState("speaking");
    else emitNexState("error");
  }

  function stopTracks() {
    cancelAnimationFrame(rafRef.current);
    procRef.current?.disconnect();
    procRef.current = null;
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    chunksRef.current = [];
  }

  function stopPlayback() {
    playGen.current++;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.filter((d) => d.kind === "audioinput"));
  }

  useEffect(() => {
    void refreshDevices();
    const onChange = () => {
      void refreshDevices();
      const live = streamRef.current?.getAudioTracks()[0];
      if (phaseRef.current === "listening" && live && live.readyState === "ended") {
        stopTracks();
        setPhaseBoth("error");
        onError("O microfone foi desconectado.");
      }
    };
    navigator.mediaDevices?.addEventListener("devicechange", onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", onChange);
      gen.current++;
      stopPlayback();
      stopTracks();
    };
    // montagem única: encerrar áudio ao sair da sessão
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function levelNow(): number {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 4);
  }

  async function flushUtterance() {
    const mine = gen.current;
    const rate = audioCtxRef.current?.sampleRate ?? 48000;
    const parts = chunksRef.current;
    chunksRef.current = [];
    heardRef.current = false;
    let total = 0;
    for (const p of parts) total += p.length;
    if (total < rate * 0.35) {
      if (conversationRef.current && phaseRef.current !== "off") setPhaseBoth("listening");
      return;
    }
    const merged = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
      merged.set(p, o);
      o += p.length;
    }
    const wav = encodeWav(downsample(merged, rate, TARGET_RATE), TARGET_RATE);
    setPartial("");
    setPhaseBoth("transcribing");
    const started = performance.now();
    try {
      const body = new FormData();
      body.append("audio", wav, "fala.wav");
      const res = await fetch("/api/voice/transcribe", { method: "POST", body });
      if (mine !== gen.current) return;
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { text: string; sttMs: number };
      if (!data.text.trim()) {
        setPhaseBoth(conversationRef.current ? "listening" : "off");
        if (!conversationRef.current) stopTracks();
        return;
      }
      setPartial(data.text);
      onUtterance(data.text, started - data.sttMs, conversationRef.current);
    } catch (e) {
      if (mine !== gen.current) return;
      setPhaseBoth("error");
      onError((e as Error).message || "Falha ao transcrever.");
    }
  }

  function tick() {
    if (phaseRef.current !== "listening") return;
    const level = levelNow();
    emitNexAudioLevel(level);
    const now = performance.now();
    const dt = lastTickRef.current ? now - lastTickRef.current : 0;
    lastTickRef.current = now;
    const threshold = settingsRef.current.vadSensitivity;
    const track = streamRef.current?.getAudioTracks()[0];
    if (track && (track.readyState === "ended" || track.muted)) {
      stopTracks();
      setPhaseBoth("error");
      onError("O microfone foi desconectado ou silenciado.");
      return;
    }
    if (level >= threshold) {
      if (!heardRef.current) speakingSinceRef.current = now;
      heardRef.current = true;
      silenceMsRef.current = 0;
    } else if (heardRef.current) {
      silenceMsRef.current += dt;
      if (silenceMsRef.current >= settingsRef.current.vadSilenceMs) {
        void flushUtterance();
        return;
      }
    }
    if (heardRef.current && now - speakingSinceRef.current > 30_000) {
      void flushUtterance();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  async function openMic() {
    stopTracks();
    const audio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    };
    if (settingsRef.current.inputDeviceId) audio.deviceId = { exact: settingsRef.current.inputDeviceId };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch {
      setPhaseBoth("error");
      onError("Permissão do microfone negada ou dispositivo indisponível.");
      return;
    }
    streamRef.current = stream;
    await refreshDevices();
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    analyserRef.current = analyser;
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (ev) => {
      if (phaseRef.current !== "listening") return;
      const copy = new Float32Array(ev.inputBuffer.getChannelData(0));
      if (heardRef.current || levelNow() >= settingsRef.current.vadSensitivity) chunksRef.current.push(copy);
    };
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);
    procRef.current = proc;
    heardRef.current = false;
    silenceMsRef.current = 0;
    lastTickRef.current = 0;
    setPhaseBoth("listening");
    rafRef.current = requestAnimationFrame(tick);
  }

  function markConversation(on: boolean) {
    conversationRef.current = on;
    setConversation(on);
  }

  /** Uma frase só: transcreve e para. Não continua a conversa falada. */
  async function dictate() {
    settingsRef.current = { ...settingsRef.current, enabled: true };
    if (conversationRef.current) markConversation(false);
    if (phaseRef.current === "speaking" || busyRef.current) {
      stopPlayback();
      onInterrupt();
    }
    if (phaseRef.current === "listening") {
      await flushUtterance();
      stopTracks();
      if (phaseRef.current !== "transcribing") setPhaseBoth("off");
      return;
    }
    if (phaseRef.current === "transcribing") return;
    gen.current++;
    await openMic();
  }

  /** Liga ou desliga a conversa contínua: ouve, responde em voz e volta a ouvir. */
  async function toggleConversation() {
    settingsRef.current = { ...settingsRef.current, enabled: true };
    if (conversationRef.current) {
      markConversation(false);
      gen.current++;
      turnOpen.current = false;
      queueRef.current = [];
      playGen.current++;
      stopPlayback();
      stopTracks();
      setPhaseBoth("off");
      onInterrupt();
      return;
    }
    markConversation(true);
    if (phaseRef.current === "transcribing") return;
    gen.current++;
    await openMic();
  }

  function cleanSpeech(text: string) {
    return text.replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim();
  }

  function armSpeech() {
    playGen.current++;
    stopPlayback();
    queueRef.current = [];
    turnOpen.current = true;
    firstAudioAt.current = null;
    speakT0.current = performance.now();
  }

  function enqueueSentence(text: string) {
    const clean = cleanSpeech(text).slice(0, 500);
    if (!clean || !turnOpen.current || !settingsRef.current.enabled) return;
    queueRef.current.push(clean);
    void pump();
  }

  async function playOne(text: string, token: number) {
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        engine: settingsRef.current.ttsEngine,
        voice: settingsRef.current.ttsVoice || null,
        rate: settingsRef.current.speechRate,
      }),
    });
    if (token !== playGen.current) return;
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    if (token !== playGen.current) return;
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    if (firstAudioAt.current === null) firstAudioAt.current = performance.now();
    await new Promise<void>((resolve, reject) => {
      const id = window.setInterval(() => {
        if (token !== playGen.current) {
          window.clearInterval(id);
          resolve();
          return;
        }
        emitNexAudioLevel(audio.paused ? 0 : 0.35 + Math.random() * 0.4);
      }, 80);
      audio.onended = () => {
        window.clearInterval(id);
        resolve();
      };
      audio.onerror = () => {
        window.clearInterval(id);
        reject(new Error("Não foi possível reproduzir a voz."));
      };
      void audio.play().catch(reject);
    });
    if (urlRef.current === url) {
      URL.revokeObjectURL(url);
      urlRef.current = null;
    }
  }

  async function pump() {
    if (pumping.current) return;
    pumping.current = true;
    const token = playGen.current;
    setPhaseBoth("speaking");
    try {
      while (token === playGen.current && queueRef.current.length > 0) {
        const next = queueRef.current.shift()!;
        await playOne(next, token);
      }
    } catch (e) {
      if (token === playGen.current) {
        setPhaseBoth("error");
        onError((e as Error).message || "Falha na síntese de voz.");
        turnOpen.current = false;
      }
    } finally {
      pumping.current = false;
    }
    if (token === playGen.current && !turnOpen.current && queueRef.current.length === 0) {
      if (conversationRef.current && settingsRef.current.enabled) await openMic();
      else setPhaseBoth("off");
    }
  }

  function finishSpeech(): number | null {
    turnOpen.current = false;
    if (!pumping.current && queueRef.current.length === 0 && phaseRef.current === "speaking") {
      if (conversationRef.current && settingsRef.current.enabled) void openMic();
      else setPhaseBoth("off");
    } else if (queueRef.current.length > 0) {
      void pump();
    }
    return firstAudioAt.current === null ? null : Math.round(firstAudioAt.current - speakT0.current);
  }

  function interrupt() {
    gen.current++;
    turnOpen.current = false;
    queueRef.current = [];
    playGen.current++;
    stopPlayback();
    if (phaseRef.current === "speaking") {
      emitNexState("listening");
      if (settingsRef.current.enabled && conversationRef.current) void openMic();
      else setPhaseBoth("off");
    }
  }

  return { phase, conversation, devices, partial, dictate, toggleConversation, armSpeech, enqueueSentence, finishSpeech, interrupt, refreshDevices };
}
