/**
 * Fontes de nível de áudio (0..1) para o núcleo reagir.
 *
 * - startMic: microfone real via Web Audio (AnalyserNode). Só chame a partir de um clique do usuário.
 *   Isto só mede o nível do som para a esfera reagir. A transcrição (STT) e a fala (TTS) são do hook useVoice e do backend
 *   (backend/voice), que rodam na CPU: a VRAM fica toda para o Qwen.
 * - startDemoAudio: sinal sintético com envelope parecido com fala, para testar as animações sem microfone.
 */
export interface AudioSource {
  label: string;
  /** Nível atual 0..1 (chamar a cada quadro). */
  level(): number;
  stop(): void;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Cria uma fonte a partir de qualquer MediaStream (microfone ou um stream de teste). */
export function createStreamSource(stream: MediaStream, label: string): AudioSource {
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.75;
  src.connect(analyser); // não conecta ao destino: nada sai nas caixas de som
  const data = new Uint8Array(analyser.frequencyBinCount);
  return {
    label,
    level() {
      analyser.getByteFrequencyData(data);
      // faixa de voz (~85 Hz a ~3 kHz com fftSize 512 a 48 kHz: bins 1..32)
      let sum = 0;
      for (let i = 1; i < 33; i++) sum += data[i];
      return clamp01((sum / (32 * 255)) * 2.4);
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

/** Pede o microfone. Rejeita se o usuário negar ou não houver dispositivo. */
export async function startMic(): Promise<AudioSource> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("este navegador não permite acessar o microfone aqui");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  return createStreamSource(stream, "microfone");
}

/** Sinal sintético (NÃO é áudio real): sílabas ~4 Hz sobre um envelope lento, com um pouco de ruído. */
export function startDemoAudio(): AudioSource {
  const t0 = performance.now();
  return {
    label: "demonstração",
    level() {
      const t = (performance.now() - t0) / 1000;
      const envelope = 0.55 + 0.45 * Math.sin(t * 0.9);
      const syllables = Math.abs(Math.sin(t * Math.PI * 4.2));
      const noise = 0.08 * Math.sin(t * 37) * Math.sin(t * 11);
      return clamp01(envelope * syllables * 0.85 + noise);
    },
    stop() {},
  };
}
