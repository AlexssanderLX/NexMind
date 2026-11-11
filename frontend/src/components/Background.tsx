import { useEffect, useRef } from "react";

/**
 * Esfera de nós em rotação (estilo "núcleo de IA"), desenhada em Canvas 2D com projeção 3D feita à mão.
 * De propósito não usa WebGL: a GPU já é do modelo, e esta animação não pode roubar tokens/s dele.
 * Custo: ~150 pontos e ~350 linhas a 30 fps, pausa com a aba escondida, e `active` (resposta em andamento)
 * só acelera e acende um pouco a esfera.
 */
const POINTS = 150;
const FRAME_MS = 33; // ~30 fps
const BUCKETS = 4;
const bucket = (d: number) => Math.min(BUCKETS - 1, Math.floor(d * BUCKETS));

function fibonacciSphere(n: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    pts.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]);
  }
  return pts;
}

function neighborPairs(pts: [number, number, number][], maxDist: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], dz = pts[i][2] - pts[j][2];
      if (Math.hypot(dx, dy, dz) < maxDist) pairs.push([i, j]);
    }
  return pairs;
}

export default function Background({ enabled, active }: { enabled: boolean; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!enabled) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const pts = fibonacciSphere(POINTS);
    const pairs = neighborPairs(pts, 0.42);
    const proj = pts.map(() => ({ x: 0, y: 0, d: 0 }));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, angle = 0.6, energy = 0, raf = 0, last = 0;

    const resize = () => {
      w = canvas.width = canvas.clientWidth; // dpr 1 de propósito: menos pixels, menos custo
      h = canvas.height = canvas.clientHeight;
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const cx = w * 0.68, cy = h * 0.48, R = Math.min(w, h) * 0.27;
      energy += ((activeRef.current ? 1 : 0) - energy) * 0.06;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const tilt = 0.4, ct = Math.cos(tilt), st = Math.sin(tilt);

      for (let i = 0; i < pts.length; i++) {
        const [x, y, z] = pts[i];
        const x1 = x * ca + z * sa, z1 = -x * sa + z * ca; // gira em Y
        const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct; // inclina em X
        const s = 2.6 / (2.6 - z2); // perspectiva
        proj[i].x = cx + x1 * R * s;
        proj[i].y = cy + y2 * R * s;
        proj[i].d = (z2 + 1) / 2; // 0 = atrás, 1 = na frente
      }

      // brilho do núcleo
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.1);
      glow.addColorStop(0, `rgba(34,211,238,${0.1 + energy * 0.12})`);
      glow.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.1, 0, Math.PI * 2);
      ctx.fill();

      // arestas e nós agrupados por profundidade: 4 traços em vez de centenas (bem mais barato)
      ctx.lineWidth = 1;
      for (let b = 0; b < BUCKETS; b++) {
        const d = (b + 0.5) / BUCKETS;
        ctx.strokeStyle = `rgba(56,189,248,${0.04 + d * 0.16 + energy * 0.08})`;
        ctx.beginPath();
        for (const [i, j] of pairs) {
          if (bucket((proj[i].d + proj[j].d) / 2) !== b) continue;
          ctx.moveTo(proj[i].x, proj[i].y);
          ctx.lineTo(proj[j].x, proj[j].y);
        }
        ctx.stroke();

        ctx.fillStyle = `rgba(165,243,252,${0.15 + d * 0.6 + energy * 0.2})`;
        const r = 0.8 + d * 2;
        ctx.beginPath();
        for (const p of proj) {
          if (bucket(p.d) !== b) continue;
          ctx.moveTo(p.x + r, p.y);
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      // anéis de HUD
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.45);
      ctx.scale(1, 0.36);
      ctx.rotate(angle * 0.8);
      ctx.strokeStyle = `rgba(34,211,238,${0.28 + energy * 0.2})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 11]);
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        const a = -angle * 1.3 + (k * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.55, a, a + 0.9);
        ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = "rgba(34,211,238,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
      ctx.stroke();

      angle += 0.004 + energy * 0.014;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || now - last < FRAME_MS) return;
      last = now;
      draw();
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduceMotion) raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [enabled]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-0 h-full w-full" />;
}
