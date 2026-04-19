import { useState } from "react";
import { motion } from "framer-motion";

export function CircuitBackground() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden bg-[rgb(8,8,8)]">
      {/* Grid Overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03]" 
        style={{ 
          backgroundImage: `
            linear-gradient(to right, var(--accent-mint) 1px, transparent 1px),
            linear-gradient(to bottom, var(--accent-mint) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px"
        }} 
      />

      {/* Circuit Trace Layers */}
      <svg width="100%" height="100%" className="absolute inset-0 opacity-20">
        <defs>
          <pattern id="circuit-pattern" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path 
              d="M 100 0 L 100 40 M 100 40 L 140 80 M 140 80 L 140 120 M 140 120 L 100 160 M 100 160 L 100 200" 
              stroke="var(--accent-mint)" 
              strokeWidth="0.5" 
              fill="none" 
              opacity="0.3"
            />
            <circle cx="100" cy="40" r="1.5" fill="var(--accent-mint)" opacity="0.5" />
            <circle cx="140" cy="120" r="1.5" fill="var(--accent-mint)" opacity="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#circuit-pattern)" />
      </svg>

      {/* Animated Data Pulses */}
      <div className="absolute inset-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <DataPulse key={i} index={i} />
        ))}
      </div>

      {/* Ambient Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_0%,rgba(0,0,0,0.6)_100%)]" />
    </div>
  );
}

function DataPulse({ index }: { index: number }) {
  const horizontal = index % 2 === 0;
  const [position] = useState(() => Math.random() * 100);
  const [duration] = useState(() => 10 + Math.random() * 20);
  
  return (
    <motion.div
      initial={horizontal ? { left: "-10%", top: `${position}%` } : { top: "-10%", left: `${position}%` }}
      animate={horizontal ? { left: "110%" } : { top: "110%" }}
      transition={{
        duration: duration,
        repeat: Infinity,
        delay: index * 2,
        ease: "linear",
      }}
      className={`absolute opacity-20 blur-[1px] ${horizontal ? "h-[1px] w-24 bg-gradient-to-r" : "w-[1px] h-24 bg-gradient-to-b"} from-transparent via-[var(--accent-mint)] to-transparent`}
    />
  );
}
