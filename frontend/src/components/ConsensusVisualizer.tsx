import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Node, Link } from "../types/index.js";

interface ConsensusVisualizerProps {
  nodes: Node[];
  links?: Link[];
  consensusScore?: number;
  streaming?: boolean;
  annotations?: { id: string; nodeId: string; title: string; content: string; type: 'conflict' | 'info' | 'warning' }[];
}

export function ConsensusVisualizer({
  nodes,
  links: customLinks,
  consensusScore = 85
}: ConsensusVisualizerProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const [infNodeHex] = useState(() => Math.random().toString(16).substring(2, 6).toUpperCase());
  const [linkAnimations] = useState(() =>
    Array.from({ length: 50 }, () => ({
      duration: 1.5 + Math.random() * 1.5,
      delay: Math.random() * 2,
    })));

  const links = useMemo(() => {
    if (customLinks) return customLinks;
    
    // Fallback: simple loop if no links provided
    const defaultLinks: Link[] = [];
    for (let i = 0; i < nodes.length; i++) {
        defaultLinks.push({
            source: nodes[i].id,
            target: nodes[(i + 1) % nodes.length].id,
            strength: 0.4,
            type: "support"
        });
    }
    return defaultLinks;
  }, [nodes, customLinks]);

  return (
    <div className="relative w-full aspect-square max-w-[340px] mx-auto overflow-hidden bg-black/80 border border-white/5 rounded-[2.5rem] p-6 shadow-[0_0_50px_rgba(0,0,0,0.5)] group/visualizer holographic-panel">
      {/* Corner Accents */}
      <div className="absolute top-0 left-0 w-8 h-[1px] bg-[var(--accent-mint)] opacity-30" />
      <div className="absolute top-0 left-0 w-[1px] h-8 bg-[var(--accent-mint)] opacity-30" />
      <div className="absolute bottom-0 right-0 w-8 h-[1px] bg-[var(--accent-mint)] opacity-30" />
      <div className="absolute bottom-0 right-0 w-[1px] h-8 bg-[var(--accent-mint)] opacity-30" />
      {/* Background HUD Labels */}
      <div className="absolute top-6 left-8 z-10 pointer-events-none">
        <h4 className="text-[9px] font-black uppercase tracking-[0.4em] text-[var(--accent-mint)] opacity-60 font-diag">Consensus_Core</h4>
        <div className="flex items-baseline gap-2 mt-1.5">
          <span className="text-3xl font-black text-white tracking-tighter drop-shadow-[0_0_10px_var(--hud-glow)]">{consensusScore}%</span>
          <span className="text-[7px] text-[var(--text-muted)] font-black uppercase tracking-[0.2em]">Stability_Index</span>
        </div>
      </div>

      <div className="absolute top-6 right-8 z-10 text-right pointer-events-none">
        <div className="text-[7px] font-mono text-[var(--text-muted)] opacity-30 leading-relaxed uppercase tracking-[0.1em]">
          INF_NODE: 0x{infNodeHex}<br/>
          SYNC: CRYPTO_SAFE
        </div>
      </div>

      <svg viewBox="0 0 300 300" className="w-full h-full relative z-0">
        <defs>
          <filter id="vis-node-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          
          <linearGradient id="link-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent-mint)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.1" />
          </linearGradient>
          
          <radialGradient id="radar-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent-mint)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {/* Technical Target Circles */}
        <circle cx="150" cy="150" r="140" fill="none" stroke="white" strokeWidth="0.5" strokeOpacity="0.03" />
        <circle cx="150" cy="150" r="100" fill="none" stroke="white" strokeWidth="0.5" strokeOpacity="0.05" />
        <circle cx="150" cy="150" r="60" fill="none" stroke="white" strokeWidth="0.5" strokeOpacity="0.08" />

        {/* Radar Sweep with Trail */}
        <motion.g
          style={{ originX: "150px", originY: "150px" }}
          animate={{ rotate: 360 }}
          transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
        >
          <line x1="150" y1="150" x2="150" y2="10" stroke="var(--accent-mint)" strokeWidth="0.5" strokeOpacity="0.4" />
          <path d="M 150 150 L 150 10 A 140 140 0 0 1 200 20" fill="url(#radar-grad)" opacity="0.3" />
        </motion.g>

        {/* Dynamic Background Waves */}
        <motion.circle
          cx="150" cy="150" r="145" fill="none" stroke="var(--accent-mint)" strokeWidth="0.5" strokeDasharray="2 10"
          animate={{ rotate: 360, opacity: [0.05, 0.15, 0.05] }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
        />

        {/* Links with Data Flow */}
        {links.map((link, i) => {
          const source = nodes.find(n => n.id === link.source);
          const target = nodes.find(n => n.id === link.target);
          if (!source || !target) return null;

          const isActive = hoveredNode === link.source || hoveredNode === link.target;

          return (
            <g key={`link-${i}`}>
              <motion.line
                x1={source.x} y1={source.y} x2={target.x} y2={target.y}
                stroke={isActive ? (link.type === "critique" ? "var(--accent-red)" : "var(--accent-mint)") : "var(--glass-border)"}
                strokeWidth={isActive ? 1.5 : 0.8}
                strokeOpacity={isActive ? 0.6 : 0.15}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 2, ease: "easeOut" }}
              />
              {/* Data Flow Particles */}
              <motion.circle
                r="1.2"
                fill={link.type === "critique" ? "#ff4d4d" : "var(--accent-mint)"}
                filter="url(#vis-node-glow)"
                animate={{ 
                  cx: [source.x, target.x],
                  cy: [source.y, target.y],
                  opacity: [0, 1, 0],
                  scale: [1, 1.5, 1]
                }}
                transition={{ 
                  duration: linkAnimations[i].duration,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: linkAnimations[i].delay
                }}
              />
            </g>
          );
        })}

        {/* Nodes with Technical Detail */}
        {nodes.map((node) => (
          <g 
            key={node.id} 
            onMouseEnter={() => setHoveredNode(node.id)} 
            onMouseLeave={() => setHoveredNode(null)}
            className="cursor-pointer"
          >
            {/* Pulsing Hover Halo */}
            <AnimatePresence>
              {hoveredNode === node.id && (
                <motion.circle
                  initial={{ r: 0, opacity: 0 }}
                  animate={{ r: 18, opacity: 0.15 }}
                  exit={{ r: 0, opacity: 0 }}
                  cx={node.x} cy={node.y}
                  fill="var(--accent-mint)"
                />
              )}
            </AnimatePresence>

            {/* Support Crosshair Rings */}
            <circle cx={node.x} cy={node.y} r={hoveredNode === node.id ? 10 : 8} fill="none" stroke={node.type === "proposer" ? "var(--accent-mint)" : "var(--accent-blue)"} strokeWidth="0.5" strokeOpacity="0.2" />

            {/* Core Node Circle */}
            <motion.circle
              cx={node.x} cy={node.y}
              fill={node.type === "proposer" ? "var(--accent-mint)" : node.type === "moderator" ? "var(--accent-blue)" : "var(--text-secondary)"}
              animate={{ 
                r: hoveredNode === node.id ? 5 : 4,
                filter: hoveredNode === node.id ? "url(#vis-node-glow)" : "none",
              }}
              className="transition-all duration-300"
            />

            {/* Technical Node Text Label */}
            <motion.text
              x={node.x} y={node.y + 18}
              textAnchor="middle"
              className="text-[6px] font-mono font-black uppercase tracking-widest pointer-events-none"
              fill={hoveredNode === node.id ? "white" : "var(--text-muted)"}
              animate={{ opacity: hoveredNode === node.id ? 1 : 0.5, y: node.y + (hoveredNode === node.id ? 20 : 18) }}
            >
              {node.name}
            </motion.text>

            {/* Miniature [X,Y] Marker */}
            {hoveredNode === node.id && (
              <text x={node.x + 8} y={node.y - 8} className="text-[5px] font-mono fill-[var(--accent-mint)] opacity-60">
                [{node.x.toFixed(0)},{node.y.toFixed(0)}]
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* Info Overlay Panel */}
      <AnimatePresence>
        {hoveredNode && (
          <motion.div
            initial={{ opacity: 0, y: 10, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, y: 0, backdropFilter: "blur(12px)" }}
            exit={{ opacity: 0, y: 10, backdropFilter: "blur(0px)" }}
            className="absolute bottom-4 left-4 right-4 bg-white/[0.03] border border-white/10 p-3 rounded-xl pointer-events-none shadow-2xl z-20 overflow-hidden"
          >
            {/* Animated background bar */}
            <motion.div 
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--accent-mint)] to-transparent origin-left"
            />
            
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[8px] font-mono text-[var(--accent-mint)] uppercase tracking-[0.2em] font-black opacity-80">Telemetry Identified</div>
              <div className="w-1 h-1 rounded-full bg-[var(--accent-mint)] shadow-[0_0_8px_var(--accent-mint)] animate-pulse" />
            </div>
            
            <div className="text-xs font-black text-white mb-0.5 tracking-tight">
               {nodes.find(n => n.id === hoveredNode)?.name}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-[9px] text-[var(--text-muted)] font-mono uppercase font-bold tracking-widest">
                 Role: <span className="text-[var(--text-secondary)]">{nodes.find(n => n.id === hoveredNode)?.type}</span>
              </div>
              <div className="w-px h-2.5 bg-white/10" />
              <div className="text-[9px] text-[var(--text-muted)] font-mono uppercase font-bold tracking-widest">
                 Status: <span className="text-[var(--accent-mint)]">Verified</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Technical Grain Overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.05]" 
           style={{ backgroundImage: "radial-gradient(circle, var(--accent-mint) 0.5px, transparent 0.5px)", backgroundSize: "15px 15px" }} />
    </div>
  );
}
