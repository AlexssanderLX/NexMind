import type { PanelId } from "../../hooks/useNexCore";

/**
 * Corpos celestes que representam cada painel quando recolhido: cada um tem seu desenho e sua animação própria
 * e reage ao cursor (gira mais rápido e brilha). Cor = accent do tema (muda com a cor do núcleo).
 * Só CSS/SVG (transform e opacity): custo desprezível, e `prefers-reduced-motion` desliga o movimento.
 */
export const ORB_SIZE = 76;

function Pulsar() {
  return (
    <svg viewBox="0 0 100 100" className="text-accent" aria-hidden>
      <defs>
        <radialGradient id="orbGlowA" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.3" stopColor="currentColor" stopOpacity="0.8" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill="url(#orbGlowA)" className="orb-pulse" opacity="0.4" />
      <circle cx="50" cy="50" r="31" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="2 6" className="orb-spin orb-spin-slow" />
      <circle cx="50" cy="19" r="2.6" fill="currentColor" className="orb-spin orb-spin-slow" />
      <path className="orb-twinkle" d="M50 17 L54.5 45.5 L83 50 L54.5 54.5 L50 83 L45.5 54.5 L17 50 L45.5 45.5 Z" fill="#e9fcff" />
      <circle cx="50" cy="50" r="5" fill="#ffffff" />
    </svg>
  );
}

function RingedPlanet() {
  return (
    <svg viewBox="0 0 100 100" className="text-accent" aria-hidden>
      <defs>
        <radialGradient id="orbPlanetT" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="currentColor" stopOpacity="0.85" />
          <stop offset="1" stopColor="#06101d" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="1.5 5" />
      <g transform="rotate(-22 50 50)">
        <path d="M9 50 A41 12 0 0 1 91 50" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="3.2" />
      </g>
      <circle cx="50" cy="50" r="22" fill="url(#orbPlanetT)" />
      <g transform="rotate(-22 50 50)">
        <path d="M9 50 A41 12 0 0 0 91 50" fill="none" stroke="currentColor" strokeOpacity="0.95" strokeWidth="3.2" />
      </g>
      <g className="orb-spin">
        <circle cx="50" cy="8" r="4.2" fill="#ffffff" />
      </g>
    </svg>
  );
}

function Comet() {
  return (
    <svg viewBox="0 0 100 100" className="text-accent" aria-hidden>
      <defs>
        <radialGradient id="orbPlanetR" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.4" stopColor="currentColor" stopOpacity="0.7" />
          <stop offset="1" stopColor="#06101d" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
      <circle cx="50" cy="50" r="15" fill="url(#orbPlanetR)" />
      <g className="orb-spin orb-spin-fast">
        <path d="M50 10 A40 40 0 0 0 17 28" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="4" strokeLinecap="round" />
        <path d="M50 10 A40 40 0 0 0 30 15" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="50" cy="10" r="5" fill="#ffffff" />
      </g>
    </svg>
  );
}

export default function Orb({ kind }: { kind: PanelId }) {
  return (
    <span className="orb block h-full w-full">
      {kind === "activity" ? <Pulsar /> : kind === "tools" ? <RingedPlanet /> : <Comet />}
    </span>
  );
}
