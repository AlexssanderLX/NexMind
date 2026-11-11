import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { CoreState } from "./events";
import type { Profile } from "./profiles";
import * as S from "./shaders";

export interface CoreStats {
  fps: number;
  frameMsAvg: number;
  frameMsMax: number;
  /** Tempo de CPU (JavaScript) gasto por quadro atualizando uniforms e enviando os comandos de desenho. */
  jsMsAvg: number;
  particles: number;
  nodes: number;
  edges: number;
  drawCalls: number;
  profile: string;
  dpr: number;
  width: number;
  height: number;
  renderer: string;
  running: boolean;
}

export interface CoreHandle {
  setState(s: CoreState): void;
  setProfile(p: Profile): void;
  /** scale: tamanho relativo da esfera; intensity: brilho relativo (ex.: esmaecer atrás de uma conversa). */
  setPresence(scale: number, intensity: number): void;
  setAudioProvider(fn: () => number): void;
  setPointer(clientX: number | null, clientY: number | null): void;
  setPressed(down: boolean): void;
  /** O ponto (em coordenadas da janela) está sobre a esfera? */
  hitTest(clientX: number, clientY: number): boolean;
  ripple(clientX: number, clientY: number): void;
  /** Impulso breve de energia (ex.: a cada lote de tokens recebidos). */
  pulse(amount?: number): void;
  setMotion(scale: number): void;
  stats(): CoreStats;
  dispose(): void;
}

export interface CoreOptions {
  onContextLost?: () => void;
}

/** Parâmetros visuais de cada estado; a cena suaviza a transição entre eles. */
interface Params {
  spin: number;
  swirl: number;
  organize: number;
  intensity: number;
  breath: number;
  ring: number;
  glow: number;
  pulse: number;
  audioGain: number;
}

const STATE_PARAMS: Record<CoreState, Params> = {
  idle: { spin: 0.14, swirl: 0.1, organize: 0, intensity: 1.0, breath: 0.35, ring: 0.25, glow: 0.35, pulse: 0.16, audioGain: 0 },
  listening: { spin: 0.2, swirl: 0.2, organize: 0, intensity: 1.15, breath: 0.5, ring: 0.6, glow: 0.5, pulse: 0.3, audioGain: 1 },
  thinking: { spin: 0.55, swirl: 1.7, organize: 0, intensity: 1.2, breath: 0.6, ring: 1.8, glow: 0.55, pulse: 0.9, audioGain: 0 },
  speaking: { spin: 0.22, swirl: 0.25, organize: 0, intensity: 1.15, breath: 0.5, ring: 0.5, glow: 0.55, pulse: 0.35, audioGain: 1 },
  tool: { spin: 0.3, swirl: 0.5, organize: 1, intensity: 1.15, breath: 0.4, ring: 1.2, glow: 0.5, pulse: 0.6, audioGain: 0 },
  success: { spin: 0.18, swirl: 0.12, organize: 0, intensity: 1.45, breath: 0.4, ring: 0.4, glow: 0.8, pulse: 0.3, audioGain: 0 },
  error: { spin: 0.08, swirl: 0.05, organize: 0, intensity: 0.95, breath: 0.2, ring: 0.1, glow: 0.3, pulse: 0.1, audioGain: 0 },
};

const rand = Math.random;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Ponto i de n distribuídos de forma uniforme numa esfera unitária (espiral de Fibonacci). */
function fibDir(i: number, n: number, out: THREE.Vector3) {
  const y = 1 - ((i + 0.5) / n) * 2;
  const r = Math.sqrt(1 - y * y);
  const th = i * 2.399963229728653;
  return out.set(Math.cos(th) * r, y, Math.sin(th) * r);
}

/** Posição da partícula no padrão "anéis de latitude" usado no estado de execução de ferramenta. */
function ringTarget(d: THREE.Vector3, k: number, out: THREE.Vector3) {
  const ly = Math.round(d.y * 7) / 7;
  const lr = Math.sqrt(Math.max(0, 1 - ly * ly));
  const a = Math.atan2(d.z, d.x);
  return out.set(Math.cos(a) * lr * k, ly * k, Math.sin(a) * lr * k);
}

function nearestNeighborEdges(nodes: THREE.Vector3[], k: number): [number, number][] {
  const edges: [number, number][] = [];
  const seen = new Set<number>();
  const dist: { j: number; d: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    dist.length = 0;
    for (let j = 0; j < nodes.length; j++) if (j !== i) dist.push({ j, d: nodes[i].distanceToSquared(nodes[j]) });
    dist.sort((a, b) => a.d - b.d);
    for (let q = 0; q < k; q++) {
      const j = dist[q].j;
      const key = Math.min(i, j) * nodes.length + Math.max(i, j);
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([i, j]);
      }
    }
  }
  return edges;
}

export function createCore(canvas: HTMLCanvasElement, initial: Profile, opts: CoreOptions = {}): CoreHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    // powerPreference "default": deixa o sistema escolher a GPU em vez de forçar a mesma que o modelo usa
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "default" });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 1); // preto + mix-blend-mode: screen no CSS = fundo transparente na prática

  let profile = initial;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  const root = new THREE.Group(); // inclinação/paralaxe do cursor e escala de presença
  const coreGroup = new THREE.Group(); // giro automático
  const ringsGroup = new THREE.Group();
  root.add(coreGroup, ringsGroup);
  scene.add(root);

  const U: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uSwirl: { value: 0 },
    uBreath: { value: 0.35 },
    uOrganize: { value: 0 },
    uBurst: { value: 0 },
    uError: { value: 0 },
    uAudio: { value: 0 },
    uRippleT: { value: 99 },
    uRippleDir: { value: new THREE.Vector3(0, 0, 1) },
    uMouse: { value: new THREE.Vector3(0, 0, 5) },
    uMouseStrength: { value: 0 },
    uCamZ: { value: 4 },
    uPointScale: { value: 2 },
    uProx: { value: 0 },
    uIntensity: { value: 1 },
    uPulseSpeed: { value: 0.16 },
    uNear: { value: new THREE.Vector3(0.62, 0.95, 1.0) },
    uFar: { value: new THREE.Vector3(0.08, 0.42, 0.95) },
  };
  const glowU = { value: 0.35 };

  // ---- estado dinâmico
  let state: CoreState = "idle";
  const cur: Params = { ...STATE_PARAMS.idle };
  let burst = 0, errorAmt = 0, pulseAmt = 0, rippleT = 99;
  let audio = 0, spin = 0, swirlPhase = 0, prox = 0;
  let px = 0, py = 0; // ponteiro suavizado (NDC)
  let ptr: { x: number; y: number } | null = null; // ponteiro em px relativos ao canvas
  let pressed = false;
  let motion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0.25 : 1;
  const presence = { scale: 1, intensity: 1, tScale: 1, tInt: 1 };
  let provider: () => number = () => 0;

  // ---- tamanho
  let width = 1, height = 1, basePx = 320, dpr = 1;

  // ---- objetos construídos por perfil
  let disposables: { dispose(): void }[] = [];
  let ringLoops: { loop: THREE.LineLoop; mat: THREE.ShaderMaterial; speed: number }[] = [];
  let glowMesh: THREE.Mesh | null = null;
  let composer: EffectComposer | null = null;
  let counts = { particles: 0, nodes: 0, edges: 0 };

  const additive = (extra: THREE.ShaderMaterialParameters) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      ...extra,
    });

  function track<T extends { dispose(): void }>(o: T): T {
    disposables.push(o);
    return o;
  }

  function disposeBuilt() {
    for (const o of disposables) o.dispose();
    disposables = [];
    ringLoops = [];
    coreGroup.clear();
    ringsGroup.clear();
    if (glowMesh) scene.remove(glowMesh);
    glowMesh = null;
    if (composer) composer.dispose();
    composer = null;
  }

  function build(p: Profile) {
    disposeBuilt();
    const v = new THREE.Vector3();
    const t = new THREE.Vector3();

    // partículas do volume
    {
      const n = p.particles;
      const pos = new Float32Array(n * 3), tgt = new Float32Array(n * 3), seed = new Float32Array(n), size = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        fibDir(i, n, v);
        const inner = rand() < 0.25;
        const r = inner ? 0.25 + rand() * 0.65 : 1 + (rand() - 0.5) * 0.1;
        pos.set([v.x * r, v.y * r, v.z * r], i * 3);
        ringTarget(v, inner ? 0.7 : 1, t);
        tgt.set([t.x, t.y, t.z], i * 3);
        seed[i] = rand();
        size[i] = inner ? 0.5 + rand() * 0.6 : 0.6 + rand() * 1.2;
      }
      const g = track(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aTarget", new THREE.BufferAttribute(tgt, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
      const m = track(additive({ uniforms: U, vertexShader: S.COMMON + S.POINT_VERT, fragmentShader: S.POINT_FRAG }));
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      coreGroup.add(pts);
      counts.particles = n;
    }

    // rede neural: nós + conexões (os vizinhos mais próximos)
    {
      const m = p.nodes;
      const nodes: THREE.Vector3[] = [];
      const nodeTarget: THREE.Vector3[] = [];
      const nodeSeed = new Float32Array(m);
      for (let i = 0; i < m; i++) {
        fibDir(i, m, v);
        ringTarget(v, 1, t);
        nodeTarget.push(t.clone());
        nodes.push(v.clone().multiplyScalar(1 + (rand() - 0.5) * 0.04));
        nodeSeed[i] = rand();
      }
      const edges = nearestNeighborEdges(nodes, p.neighbors);

      // nós
      const npos = new Float32Array(m * 3), ntgt = new Float32Array(m * 3), nsize = new Float32Array(m);
      for (let i = 0; i < m; i++) {
        npos.set([nodes[i].x, nodes[i].y, nodes[i].z], i * 3);
        ntgt.set([nodeTarget[i].x, nodeTarget[i].y, nodeTarget[i].z], i * 3);
        nsize[i] = 1.6 + rand() * 1.8;
      }
      const ng = track(new THREE.BufferGeometry());
      ng.setAttribute("position", new THREE.BufferAttribute(npos, 3));
      ng.setAttribute("aTarget", new THREE.BufferAttribute(ntgt, 3));
      ng.setAttribute("aSeed", new THREE.BufferAttribute(nodeSeed, 1));
      ng.setAttribute("aSize", new THREE.BufferAttribute(nsize, 1));
      const nm = track(additive({ uniforms: U, vertexShader: S.COMMON + S.POINT_VERT, fragmentShader: S.POINT_FRAG }));
      const nodePoints = new THREE.Points(ng, nm);
      nodePoints.frustumCulled = false;
      coreGroup.add(nodePoints);

      // conexões: cada ponta usa a semente/posição do seu nó, então acompanha o deslocamento dele
      const e = edges.length;
      const lpos = new Float32Array(e * 6), ltgt = new Float32Array(e * 6), lseed = new Float32Array(e * 2);
      const lt = new Float32Array(e * 2), lphase = new Float32Array(e * 2);
      edges.forEach(([a, b], k) => {
        lpos.set([nodes[a].x, nodes[a].y, nodes[a].z, nodes[b].x, nodes[b].y, nodes[b].z], k * 6);
        ltgt.set(
          [nodeTarget[a].x, nodeTarget[a].y, nodeTarget[a].z, nodeTarget[b].x, nodeTarget[b].y, nodeTarget[b].z],
          k * 6,
        );
        lseed.set([nodeSeed[a], nodeSeed[b]], k * 2);
        lt.set([0, 1], k * 2);
        const ph = rand();
        lphase.set([ph, ph], k * 2);
      });
      const lg = track(new THREE.BufferGeometry());
      lg.setAttribute("position", new THREE.BufferAttribute(lpos, 3));
      lg.setAttribute("aTarget", new THREE.BufferAttribute(ltgt, 3));
      lg.setAttribute("aSeed", new THREE.BufferAttribute(lseed, 1));
      lg.setAttribute("aT", new THREE.BufferAttribute(lt, 1));
      lg.setAttribute("aPhase", new THREE.BufferAttribute(lphase, 1));
      const lm = track(additive({ uniforms: U, vertexShader: S.COMMON + S.LINE_VERT, fragmentShader: S.LINE_FRAG }));
      const lines = new THREE.LineSegments(lg, lm);
      lines.frustumCulled = false;
      coreGroup.add(lines);
      counts.nodes = m;
      counts.edges = e;
    }

    // anéis de HUD
    if (p.rings) {
      const defs = [
        { r: 1.34, tx: 1.15, ty: 0.2, dash: 36, speed: 0.5, alpha: 0.55 },
        { r: 1.62, tx: 0.35, ty: -0.6, dash: 60, speed: -0.35, alpha: 0.4 },
        { r: 1.92, tx: -0.9, ty: 0.4, dash: 90, speed: 0.25, alpha: 0.3 },
      ];
      for (const d of defs) {
        const N = 220;
        const pos = new Float32Array(N * 3), a = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const ang = (i / N) * Math.PI * 2;
          pos.set([Math.cos(ang) * d.r, Math.sin(ang) * d.r, 0], i * 3);
          a[i] = i / N;
        }
        const g = track(new THREE.BufferGeometry());
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("aA", new THREE.BufferAttribute(a, 1));
        const mat = track(
          additive({
            uniforms: {
              uIntensity: U.uIntensity,
              uError: U.uError,
              uDash: { value: d.dash },
              uPhase: { value: 0 },
              uAlpha: { value: d.alpha },
            },
            vertexShader: S.RING_VERT,
            fragmentShader: S.RING_FRAG,
          }),
        );
        const loop = new THREE.LineLoop(g, mat);
        loop.rotation.set(d.tx, d.ty, 0);
        loop.frustumCulled = false;
        ringsGroup.add(loop);
        ringLoops.push({ loop, mat, speed: d.speed });
      }
    }

    // poeira orbital
    if (p.halo > 0) {
      const n = p.halo;
      const pos = new Float32Array(n * 3), seed = new Float32Array(n), size = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = rand() * 2 - 1;
        const th = rand() * Math.PI * 2;
        const rr = Math.sqrt(1 - u * u);
        const r = 1.25 + Math.pow(rand(), 0.7) * 1.15;
        pos.set([Math.cos(th) * rr * r, u * r, Math.sin(th) * rr * r], i * 3);
        seed[i] = rand();
        size[i] = 0.5 + rand();
      }
      const g = track(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
      const m = track(additive({ uniforms: U, vertexShader: S.COMMON + S.HALO_VERT, fragmentShader: S.HALO_FRAG }));
      const halo = new THREE.Points(g, m);
      halo.frustumCulled = false;
      ringsGroup.add(halo);
    }

    // brilho central (plano sempre de frente para a câmera)
    {
      const g = track(new THREE.PlaneGeometry(4.6, 4.6));
      const m = track(
        additive({ uniforms: { uGlow: glowU, uError: U.uError }, vertexShader: S.GLOW_VERT, fragmentShader: S.GLOW_FRAG }),
      );
      glowMesh = new THREE.Mesh(g, m);
      glowMesh.position.z = -0.3;
      glowMesh.renderOrder = -1;
      scene.add(glowMesh);
    }

    // pós-processamento: brilho (bloom), só no perfil Máximo
    if (p.bloom) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.65, 0.12));
    }
    applySize();
  }

  function applySize() {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, profile.dpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    if (composer) {
      composer.setPixelRatio(dpr);
      composer.setSize(width, height);
    }
    // esfera com 240–500 px de diâmetro, conforme a área disponível
    basePx = Math.min(500, Math.max(240, Math.min(width * 0.8, height * 0.78)));
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const camZ = height / (basePx * tan);
    camera.aspect = width / height;
    camera.position.set(0, 0, camZ);
    camera.near = Math.max(0.1, camZ - 4);
    camera.far = camZ + 6;
    camera.updateProjectionMatrix();
    U.uCamZ.value = camZ;
  }

  // ---- ponteiro, raio e esfera de colisão
  const raycaster = new THREE.Raycaster();
  const hitSphere = new THREE.Sphere(new THREE.Vector3(), 1.12);
  const ndc = new THREE.Vector2();
  const tmp = new THREE.Vector3();

  /** Ponto da esfera mais próximo do raio do cursor, em coordenadas locais do núcleo. */
  function pointerOnSphere(x: number, y: number, radius: number, out: THREE.Vector3) {
    ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    hitSphere.center.copy(root.position);
    hitSphere.radius = radius * presence.scale;
    if (!raycaster.ray.intersectSphere(hitSphere, tmp)) {
      raycaster.ray.closestPointToPoint(hitSphere.center, tmp);
      tmp.sub(hitSphere.center).setLength(hitSphere.radius).add(hitSphere.center);
    }
    out.copy(tmp);
    coreGroup.worldToLocal(out);
    return out;
  }

  function update(dt: number) {
    U.uTime.value += dt;

    // parâmetros do estado, com transição suave
    const tgt = STATE_PARAMS[state];
    const k = 1 - Math.exp(-dt * 3);
    for (const key of Object.keys(cur) as (keyof Params)[]) cur[key] += (tgt[key] - cur[key]) * k;

    burst = Math.max(0, burst - dt / 1.3);
    errorAmt = Math.max(0, errorAmt - dt / 1.7);
    pulseAmt = Math.max(0, pulseAmt - dt * 1.6);
    rippleT = Math.min(99, rippleT + dt);
    U.uBurst.value = burst * burst;
    U.uError.value = errorAmt;
    U.uRippleT.value = rippleT;

    const kp = 1 - Math.exp(-dt * 4);
    presence.scale += (presence.tScale - presence.scale) * kp;
    presence.intensity += (presence.tInt - presence.intensity) * kp;

    // áudio: ataque rápido, queda lenta
    const target = Math.min(1, provider() * cur.audioGain + pulseAmt);
    audio += (target - audio) * (1 - Math.exp(-dt * (target > audio ? 30 : 8)));
    U.uAudio.value = audio;

    // ponteiro (suavizado) e proximidade
    const kPtr = 1 - Math.exp(-dt * 6);
    const tx = ptr ? (ptr.x / width) * 2 - 1 : 0;
    const ty = ptr ? -(ptr.y / height) * 2 + 1 : 0;
    px += (tx - px) * kPtr;
    py += (ty - py) * kPtr;
    let proxT = 0;
    if (ptr) {
      const r = (basePx * presence.scale) / 2;
      proxT = 1 - smooth(r * 0.9, r * 2.4, Math.hypot(ptr.x - width / 2, ptr.y - height / 2));
    }
    prox += (proxT - prox) * (1 - Math.exp(-dt * 5));
    U.uProx.value = prox;

    // movimento
    spin += dt * cur.spin * motion;
    coreGroup.rotation.set(0.22, spin, 0);
    root.rotation.set(-py * 0.35 * motion, px * 0.55 * motion, 0);
    root.position.set(px * 0.1 * motion, py * 0.08 * motion, 0);
    root.scale.setScalar(presence.scale);
    if (glowMesh) glowMesh.scale.setScalar(presence.scale);
    for (const r of ringLoops) {
      r.loop.rotation.z += dt * r.speed * (0.3 + cur.ring) * motion;
      r.mat.uniforms.uPhase.value += dt * Math.sign(r.speed) * 0.15 * (0.3 + cur.ring) * motion;
    }

    swirlPhase += dt * (0.5 + cur.swirl * 1.2) * motion;
    U.uSwirl.value = Math.min(1, 0.12 + cur.swirl * 0.5) * Math.sin(swirlPhase) * motion;
    U.uBreath.value = cur.breath;
    U.uOrganize.value = cur.organize;
    U.uPulseSpeed.value = cur.pulse;
    U.uIntensity.value = cur.intensity * presence.intensity * (1 + prox * 0.12);
    U.uPointScale.value = basePx * dpr * 0.0045 * presence.scale;
    glowU.value = (cur.glow + audio * 0.35 + prox * 0.12 + burst * 0.4) * presence.intensity;

    // gravidade do cursor, no espaço local do núcleo
    root.updateMatrixWorld(true);
    if (ptr) {
      pointerOnSphere(ptr.x, ptr.y, 1.12, U.uMouse.value as THREE.Vector3);
      U.uMouseStrength.value = (0.1 + 0.34 * prox + (pressed ? 0.25 : 0)) * motion;
    } else {
      U.uMouseStrength.value = 0;
    }
  }

  function render() {
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  // ---- laço de quadros, com teto de fps do perfil e medição
  let raf = 0, running = true, lastRender = 0;
  const frameDts: number[] = [];
  const jsTimes: number[] = [];
  const push = (arr: number[], v: number) => {
    arr.push(v);
    if (arr.length > 120) arr.shift();
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!running || document.hidden) {
      lastRender = 0; // evita um salto de tempo ao voltar
      return;
    }
    if (lastRender && now - lastRender < 1000 / profile.fps - 2) return;
    const dtMs = lastRender ? now - lastRender : 16.7;
    lastRender = now;
    const t0 = performance.now();
    update(Math.min(0.05, dtMs / 1000));
    render();
    push(jsTimes, performance.now() - t0);
    if (dtMs < 500) push(frameDts, dtMs);
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    running = false;
    opts.onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  const ro = new ResizeObserver(() => applySize());
  ro.observe(canvas);

  build(profile);
  raf = requestAnimationFrame(frame);

  const rendererName = (() => {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "desconhecido";
  })();

  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

  return {
    setState(s) {
      if (s === "success") burst = 1;
      if (s === "error") errorAmt = 1;
      state = s;
    },
    setProfile(p) {
      if (p.id === profile.id) return;
      profile = p;
      frameDts.length = 0;
      jsTimes.length = 0;
      build(p);
    },
    setPresence(scale, intensity) {
      presence.tScale = scale;
      presence.tInt = intensity;
    },
    setAudioProvider(fn) {
      provider = fn;
    },
    setPointer(clientX, clientY) {
      if (clientX === null || clientY === null) {
        ptr = null;
        return;
      }
      const r = canvas.getBoundingClientRect();
      ptr = { x: clientX - r.left, y: clientY - r.top };
    },
    setPressed(down) {
      pressed = down;
    },
    hitTest(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const dx = clientX - (r.left + r.width / 2);
      const dy = clientY - (r.top + r.height / 2);
      return Math.hypot(dx, dy) <= (basePx * presence.scale * 1.08) / 2;
    },
    ripple(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const dir = pointerOnSphere(clientX - r.left, clientY - r.top, 1, U.uRippleDir.value as THREE.Vector3);
      dir.normalize();
      rippleT = 0;
      pulseAmt = Math.max(pulseAmt, 0.35);
    },
    pulse(amount = 0.3) {
      pulseAmt = Math.min(1, Math.max(pulseAmt, amount));
    },
    setMotion(scale) {
      motion = scale;
    },
    stats() {
      const dt = avg(frameDts);
      return {
        fps: dt > 0 ? 1000 / dt : 0,
        frameMsAvg: dt,
        frameMsMax: frameDts.length ? Math.max(...frameDts) : 0,
        jsMsAvg: avg(jsTimes),
        particles: counts.particles,
        nodes: counts.nodes,
        edges: counts.edges,
        drawCalls: renderer.info.render.calls,
        profile: profile.id,
        dpr,
        width,
        height,
        renderer: rendererName,
        running: running && !document.hidden,
      };
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      disposeBuilt();
      renderer.dispose();
    },
  };
}
