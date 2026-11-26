import { useState } from "react";

export function NexCoreOrb() {
  const [pulsing, setPulsing] = useState(false);

  const handleClick = () => {
    setPulsing(true);
    setTimeout(() => setPulsing(false), 800);
  };

  return (
    <div className="relative mb-2 flex items-center justify-between rounded-lg border border-[#00f0ff]/20 bg-[#080b11]/90 px-4 py-2.5 backdrop-blur-md shadow-[0_0_20px_rgba(0,240,255,0.08)]">
      {/* Left: Core Orb & Identity */}
      <div className="flex items-center gap-3">
        <div
          onClick={handleClick}
          title="Clique para pulsar o Nex Core"
          className="group relative flex h-9 w-9 cursor-pointer items-center justify-center"
        >
          {/* Outer Rotating Energy Ring */}
          <div
            className={`absolute inset-0 rounded-full border border-[#00f0ff]/40 transition-transform duration-500 group-hover:scale-110 ${
              pulsing ? "scale-125 border-[#00f0ff] animate-ping" : "animate-spin"
            }`}
            style={{ animationDuration: "8s" }}
          />

          {/* Inner Glowing Core */}
          <div className="relative flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#00f0ff] to-[#0077ff] shadow-[0_0_12px_#00f0ff]">
            <span className="text-[9px] font-black tracking-tighter text-[#080b11]">NX</span>
          </div>
        </div>

        {/* Text Details */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-wider text-[#00f0ff]">
              NEX CORE v2.0
            </span>
            <span className="inline-flex items-center rounded-full bg-[#00f0ff]/10 px-1.5 py-0.2 text-[10px] font-medium text-[#00f0ff]">
              ONLINE
            </span>
          </div>
          <span className="text-[10px] text-gray-400">
            Runtime de Agente Autônomo · Cota Diária Ativa
          </span>
        </div>
      </div>

      {/* Right: Mode & Status Indicator */}
      <div className="flex items-center gap-2 text-right">
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-mono tracking-wider text-gray-300">
            ENGINE READY
          </span>
          <span className="text-[9px] text-[#00f0ff]/70">
            Reasoning: Enxuto (Zero Desperdício)
          </span>
        </div>
        <div className="h-2 w-2 rounded-full bg-[#00f0ff] shadow-[0_0_8px_#00f0ff] animate-pulse" />
      </div>
    </div>
  );
}
