import { useState } from "react";
import { motion } from "framer-motion";
import { Cpu, Zap, Share2, Layers, Activity } from "lucide-react";

interface NeuralBlueprintProps {
  type: string;
  name: string;
}

export function NeuralBlueprint({ type, name }: NeuralBlueprintProps) {
  const [hexStrings] = useState(() =>
    Array.from({ length: 20 }, () => [
      Math.random().toString(16).slice(2, 10).toUpperCase(),
      Math.random().toString(16).slice(2, 10).toUpperCase(),
    ]));
  const [sysHash] = useState(() => Math.random().toString(16).slice(2, 6).toUpperCase());

  // Define layout structures for different types
  const isWorkflow = type === "workflow";
  const isPersona = type === "persona";

  return (
    <div className="relative w-full aspect-video bg-[rgb(10,10,10)] rounded-3xl border border-[var(--glass-border)] overflow-hidden flex items-center justify-center group/blueprint select-none shadow-2xl">
      {/* Background Technical Noise */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none font-mono text-[8px] leading-tight break-all p-4 overflow-hidden">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i}>0x{hexStrings[i][0]} 0x{hexStrings[i][1]} F3 A1 09 B2</div>
        ))}
      </div>

      {/* Decorative Technical Grid */}
      <div className="absolute inset-0 opacity-[0.15] pointer-events-none" 
           style={{ backgroundImage: `linear-gradient(var(--glass-border) 1px, transparent 1px), linear-gradient(90deg, var(--glass-border) 1px, transparent 1px)`, backgroundSize: "40px 40px" }} />
      
      {/* Scanning Line Effect */}
      <motion.div 
        animate={{ y: ["-100%", "100%"] }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
        className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent-mint)]/20 to-transparent z-20 pointer-events-none"
      />

      {/* Ambient Pulsing Glow */}
      <motion.div 
        animate={{ opacity: [0.1, 0.25, 0.1] }}
        transition={{ duration: 5, repeat: Infinity }}
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,var(--accent-mint)/0.05,transparent_70%)] pointer-events-none" 
      />

      <svg width="100%" height="100%" viewBox="0 0 400 225" className="relative z-10 overflow-visible p-8">
        <defs>
          <filter id="blueprint-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <linearGradient id="path-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="50%" stopColor="var(--accent-mint)" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>

        {/* Dynamic Measurement Markers (Crosshairs) */}
        <TechnicalMarkers />

        {/* Central Neural Processor Core */}
        <motion.g animate={{ rotate: 360 }} transition={{ duration: 40, repeat: Infinity, ease: "linear" }}>
          <circle cx="200" cy="112.5" r="35" fill="none" stroke="var(--accent-mint)" strokeWidth="0.5" strokeDasharray="2 4" opacity="0.3" />
        </motion.g>
        
        <g filter="url(#blueprint-glow)">
          <circle cx="200" cy="112.5" r="24" fill="var(--bg-surface-3)" stroke="var(--accent-mint)" strokeWidth="2" />
          <foreignObject x={200 - 10} y={112.5 - 10} width="20" height="20">
            <div className="flex items-center justify-center text-[var(--accent-mint)]">
              <Cpu size={14} className="animate-pulse" />
            </div>
          </foreignObject>
        </g>

        {/* Structural Architecture Nodes */}
        {isWorkflow ? (
          <>
            <BlueprintNode x={60} y={112.5} label="EXT_INPUT" icon={<Activity size={10} />} delay={0} />
            <BlueprintNode x={140} y={55} label="CTX_FILTER_A" icon={<Layers size={10} />} delay={0.2} />
            <BlueprintNode x={140} y={170} label="CTX_FILTER_B" icon={<Layers size={10} />} delay={0.4} />
            <BlueprintNode x={260} y={112.5} label="NEURAL_LOGIC" icon={<Zap size={10} />} delay={0.6} />
            <BlueprintNode x={340} y={112.5} label="SYS_EGRESS" icon={<Share2 size={10} />} delay={0.8} />

            <BlueprintPath d="M 60 112.5 Q 100 112.5 140 55" delay={0.2} />
            <BlueprintPath d="M 60 112.5 Q 100 112.5 140 170" delay={0.4} />
            <BlueprintPath d="M 140 55 Q 200 55 260 112.5" delay={0.6} />
            <BlueprintPath d="M 140 170 Q 200 170 260 112.5" delay={0.8} />
            <BlueprintPath d="M 260 112.5 L 340 112.5" delay={1.0} />
          </>
        ) : isPersona ? (
          <>
            <BlueprintNode x={100} y={55} label="TOKEN_WEIGHTS" icon={<Activity size={10} />} delay={0.1} />
            <BlueprintNode x={300} y={55} label="REASONING_BIAS" icon={<Cpu size={10} />} delay={0.3} />
            <BlueprintNode x={100} y={170} label="CREATIVE_SEED" icon={<Zap size={10} />} delay={0.5} />
            <BlueprintNode x={300} y={170} label="KNOWLEDGE_BASE" icon={<Layers size={10} />} delay={0.7} />

            <BlueprintPath d="M 200 112.5 L 100 55" delay={0.2} />
            <BlueprintPath d="M 200 112.5 L 300 55" delay={0.4} />
            <BlueprintPath d="M 200 112.5 L 100 170" delay={0.6} />
            <BlueprintPath d="M 200 112.5 L 300 170" delay={0.8} />
          </>
        ) : (
          <>
            <BlueprintNode x={80} y={112.5} label="INIT_TRIGGER" icon={<Zap size={10} />} delay={0} />
            <BlueprintNode x={320} y={112.5} label="TARGET_OP" icon={<Cpu size={10} />} delay={0.5} />
            <BlueprintPath d="M 80 112.5 L 320 112.5" delay={0.5} />
          </>
        )}
      </svg>

      {/* Blueprint Header HUD */}
      <div className="absolute top-8 left-8 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--accent-mint)] shadow-[0_0_15px_var(--accent-mint)] animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[var(--accent-mint)] font-diag">
            Sector-06 // Schematics
          </span>
        </div>
        <div className="text-[7px] font-diag text-[var(--text-muted)] flex gap-4 opacity-40 uppercase tracking-widest">
          <span>COORDS: 40.7128N 74.0060W</span>
          <span>DEPTH: B-LEVEL_03</span>
          <span>SYSHASH: 0x{sysHash}</span>
        </div>
      </div>

      <div className="absolute top-8 right-8">
        <div className="px-4 py-1.5 rounded-lg border border-[var(--accent-mint)]/20 bg-black/40 backdrop-blur-md flex items-center gap-3">
          <span className="text-[9px] font-diag font-black text-[var(--accent-mint)] animate-pulse tracking-widest uppercase italic">Logic_Stream_Live</span>
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-mint)] shadow-[0_0_10px_var(--accent-mint)]" />
        </div>
      </div>

      {/* Technical Footer HUD */}
      <div className="absolute bottom-8 left-8 right-8 flex items-center justify-between border-t border-white/5 pt-4">
        <div className="flex items-center gap-6 text-[8px] font-diag text-[var(--text-muted)] uppercase tracking-[0.2em]">
          <div className="flex flex-col gap-0.5">
            <span className="opacity-40">System_Definition</span>
            <span className="text-white font-black">{name}</span>
          </div>
          <div className="w-[1px] h-6 bg-white/10" />
          <div className="flex flex-col gap-0.5">
            <span className="opacity-40">Security_Protocol</span>
            <span className="text-[var(--accent-mint)] font-black">ENCRYPT_V4_STATIC</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[9px] font-black uppercase text-[var(--accent-mint)]/40 tracking-[0.2em] font-diag italic">
            Property_Of_AIBYAI
          </div>
          <div className="text-[8px] font-diag text-white/20 uppercase tracking-tighter">
            REF: {type.toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  );
}

function TechnicalMarkers() {
  return (
    <>
      {/* Corner crosshairs */}
      <g stroke="var(--accent-mint)" strokeWidth="0.5" opacity="0.3">
        <path d="M 10 10 L 30 10 M 10 10 L 10 30" />
        <path d="M 370 10 L 390 10 M 390 10 L 390 30" />
        <path d="M 10 195 L 30 195 M 10 195 L 10 215" />
        <path d="M 370 215 L 390 215 M 390 195 L 390 215" />
      </g>
      {/* Center crosshair */}
      <g stroke="var(--accent-mint)" strokeWidth="0.5" opacity="0.2">
        <line x1="200" y1="102" x2="200" y2="122.5" />
        <line x1="190" y1="112.5" x2="210" y2="112.5" />
      </g>
    </>
  );
}

function BlueprintNode({ x, y, label, icon, delay }: { x: number; y: number; label: string; icon: React.ReactNode; delay: number }) {
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
    >
      {/* Coordinate Label */}
      <text x={x - 12} y={y - 18} className="text-[6px] fill-[var(--accent-mint)] font-diag opacity-40 font-black tracking-widest">
        0x{x.toFixed(0)}.{y.toFixed(0)}
      </text>
      
      <motion.circle 
        initial={{ r: 0 }}
        animate={{ r: 16 }}
        transition={{ delay: delay + 0.1, duration: 0.5 }}
        cx={x} cy={y} fill="var(--bg-surface-2)" stroke="var(--glass-border)" strokeWidth="1" 
      />
      <circle cx={x} cy={y} r="12" fill="rgba(255,255,255,0.02)" stroke="var(--accent-mint)" strokeWidth="0.5" opacity="0.4" />
      
      <foreignObject x={x - 6} y={y - 6} width="12" height="12">
        <div className="flex items-center justify-center text-[var(--accent-mint)] opacity-80">
          {icon}
        </div>
      </foreignObject>
      
      <text x={x} y={y + 28} textAnchor="middle" className="text-[7px] fill-[var(--text-secondary)] font-diag font-black uppercase tracking-[0.1em] italic">
        {label}
      </text>
    </motion.g>
  );
}

function BlueprintPath({ d, delay }: { d: string; delay: number }) {
  return (
    <g>
      <path d={d} stroke="var(--glass-border)" strokeWidth="1" fill="none" opacity="0.3" />
      
      {/* Data Flow Particles */}
      <motion.path
        d={d}
        stroke="url(#path-grad)"
        strokeWidth="2"
        fill="none"
        strokeDasharray="20 180"
        animate={{ strokeDashoffset: [-200, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear", delay }}
      />
      
      {/* Target glow at path endpoints */}
      <motion.circle
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.4, 0] }}
        transition={{ duration: 2, repeat: Infinity, delay }}
        cx={d.split(' ').slice(-2)[0]}
        cy={d.split(' ').slice(-2)[1]}
        r="3"
        fill="var(--accent-mint)"
        filter="url(#blueprint-glow)"
      />
    </g>
  );
}
