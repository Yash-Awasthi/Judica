import { useRef } from "react";
import { motion, useMotionValue, useTransform, useSpring } from "framer-motion";
import { Star, Download, User, Code2, Workflow, UserCircle, Wrench, Package, ShieldCheck, Zap, Cpu } from "lucide-react";

interface MarketplaceCardProps {
  item: {
    id: string;
    type: string;
    name: string;
    description: string;
    authorName: string;
    tags: string[];
    stars: number;
    downloads: number;
    version: string;
  };
  onClick: (id: string) => void;
  onInstall: (id: string) => void;
}

const typeIcons: Record<string, React.ReactNode> = {
  prompt: <Code2 size={18} />,
  workflow: <Workflow size={18} />,
  persona: <UserCircle size={18} />,
  tool: <Wrench size={18} />,
};

const typeColors: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  prompt: { bg: "rgba(96,165,250,0.08)", text: "var(--accent-blue)", border: "rgba(96,165,250,0.2)", glow: "rgba(96,165,250,0.4)" },
  workflow: { bg: "rgba(110,231,183,0.08)", text: "var(--accent-mint)", border: "rgba(110,231,183,0.2)", glow: "rgba(110,231,183,0.4)" },
  persona: { bg: "rgba(167,139,250,0.08)", text: "#a78bfa", border: "rgba(167,139,250,0.2)", glow: "rgba(167,139,250,0.4)" },
  tool: { bg: "rgba(251,191,36,0.08)", text: "var(--accent-gold)", border: "rgba(251,191,36,0.2)", glow: "rgba(251,191,36,0.4)" },
};

const defaultTypeColor = { bg: "var(--glass-bg)", text: "var(--text-muted)", border: "var(--glass-border)", glow: "rgba(255,255,255,0.1)" };

export function MarketplaceCard({ item, onClick, onInstall }: MarketplaceCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const typeColor = typeColors[item.type] || defaultTypeColor;

  // 3D Tilt Logic
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [10, -10]), { stiffness: 300, damping: 30 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-10, 10]), { stiffness: 300, damping: 30 });

  // Holographic Shine Logic
  const shineX = useSpring(useTransform(x, [-0.5, 0.5], ["0%", "100%"]));
  const shineY = useSpring(useTransform(y, [-0.5, 0.5], ["0%", "100%"]));

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;

    x.set(xPct);
    y.set(yPct);
  }

  function handleMouseLeave() {
    x.set(0);
    y.set(0);
  }

  // Neural Badges
  const isVerified = item.stars > 50;
  const isHighSynergy = item.downloads > 100;
  const isReasoningCore = item.type === "workflow" || item.type === "persona";

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={() => onClick(item.id)}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
        perspective: 1000,
      }}
      className="group relative bg-[var(--bg-surface-2)] backdrop-blur-3xl border border-[var(--glass-border)] rounded-2xl p-5 hover:border-[var(--accent-mint)]/40 transition-all duration-500 cursor-pointer flex flex-col h-full overflow-hidden shadow-2xl"
    >
      {/* Refractive Shine Layer */}
      <motion.div
        style={{
          background: `radial-gradient(circle at ${shineX} ${shineY}, rgba(255,255,255,0.1) 0%, transparent 60%)`,
          pointerEvents: "none",
        }}
        className="absolute inset-0 z-10"
      />

      {/* Technical Ribbing (Scanning Lines) */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(110,231,183,1)_1px,transparent_1px)] bg-[size:100%_4px]" />
      </div>

      {/* Holographic Border Glow (Animated) */}
      <div className="absolute -inset-[2px] bg-gradient-to-br from-[var(--accent-mint)]/20 via-transparent to-[var(--accent-blue)]/20 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

      {/* Depth Content Container */}
      <div style={{ transform: "translateZ(40px)" }} className="relative z-20 flex flex-col h-full">
        {/* Header Section */}
        <div className="flex items-start gap-4 mb-4">
          {/* Icon Port */}
          <div className="relative group/icon">
            <motion.div
              className="w-14 h-14 rounded-2xl border flex items-center justify-center shrink-0 relative overflow-hidden transition-all duration-500"
              style={{
                transform: "translateZ(20px)",
                backgroundColor: typeColor.bg,
                color: typeColor.text,
                borderColor: typeColor.border,
                boxShadow: `0 0 30px ${typeColor.glow}11`,
              }}
            >
              {/* Spinning Circuit Pattern inside icon */}
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 opacity-10"
                style={{ backgroundImage: `conic-gradient(from 0deg, transparent, ${typeColor.text}, transparent)` }}
              />
              <span className="relative z-10 group-hover:scale-110 transition-transform duration-500">
                {typeIcons[item.type] || <Package size={22} />}
              </span>
            </motion.div>
            
            {/* Status Indicator */}
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--bg)] border-2 border-[var(--glass-border)] flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-mint)] animate-pulse" />
            </div>
          </div>

          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-base font-black text-white tracking-tight truncate group-hover:text-[var(--accent-mint)] transition-colors">
                {item.name}
              </h3>
              {isVerified && (
                <ShieldCheck size={14} className="text-[var(--accent-gold)] drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]" />
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 opacity-60">
                <User size={10} className="text-[var(--text-muted)]" />
                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-[0.1em]">{item.authorName}</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-[var(--glass-border)]" />
              <span className="text-[9px] font-mono font-bold text-[var(--accent-blue)] opacity-70">REF: {item.id.slice(0, 8).toUpperCase()}</span>
            </div>
          </div>
        </div>

        {/* Technical Specification Bar */}
        <div className="flex items-center gap-3 py-2 px-3 bg-white/5 border-y border-white/5 mb-4 -mx-5 overflow-hidden">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-mint)]/40" />
            <span className="text-[8px] font-mono text-[var(--text-muted)] uppercase">Version Stable {item.version}</span>
          </div>
          <div className="w-px h-3 bg-white/10" />
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-[8px] font-mono text-[var(--text-muted)] opacity-50 uppercase">Checksum:</span>
            <span className="text-[8px] font-mono text-[var(--text-secondary)] truncate">SHA256:4X9...{item.id.slice(-4)}</span>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-6 line-clamp-2 h-10 group-hover:text-[var(--text-primary)] transition-colors italic">
          "{item.description}"
        </p>

        {/* Capabilities Badge System */}
        <div className="flex flex-wrap gap-2 mb-6">
          {isHighSynergy && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[rgba(110,231,183,0.05)] border border-[rgba(110,231,183,0.2)] shadow-[0_0_15px_rgba(110,231,183,0.05)]">
              <Zap size={10} className="text-[var(--accent-mint)]" />
              <span className="text-[8px] font-black uppercase tracking-tighter text-[var(--accent-mint)]">Synergy High</span>
            </div>
          )}
          {isReasoningCore && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[rgba(96,165,250,0.05)] border border-[rgba(96,165,250,0.2)] shadow-[0_0_15px_rgba(96,165,250,0.05)]">
              <Cpu size={10} className="text-[var(--accent-blue)]" />
              <span className="text-[8px] font-black uppercase tracking-tighter text-[var(--accent-blue)]">Reasoning Engine</span>
            </div>
          )}
          {item.type === "tool" && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[rgba(251,191,36,0.05)] border border-[rgba(251,191,36,0.2)] shadow-[0_0_15px_rgba(251,191,36,0.05)]">
              <Wrench size={10} className="text-[var(--accent-gold)]" />
              <span className="text-[8px] font-black uppercase tracking-tighter text-[var(--accent-gold)]">Execution Logic</span>
            </div>
          )}
        </div>

        {/* Telemetry Footer */}
        <div className="mt-auto flex items-center justify-between pt-5 border-t border-white/5">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[7px] font-bold text-[var(--text-muted)] uppercase tracking-widest leading-none mb-1">Consensus</span>
              <div className="flex items-center gap-1.5">
                <Star size={11} className="text-[var(--accent-gold)]" />
                <span className="text-xs font-black text-white leading-none">{item.stars}</span>
              </div>
            </div>
            
            <div className="flex flex-col">
              <span className="text-[7px] font-bold text-[var(--text-muted)] uppercase tracking-widest leading-none mb-1">Deployments</span>
              <div className="flex items-center gap-1.5">
                <Download size={11} className="text-[var(--text-muted)] opacity-60" />
                <span className="text-xs font-black text-white leading-none">{item.downloads}</span>
              </div>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => {
              e.stopPropagation();
              onInstall(item.id);
            }}
            className="h-10 px-6 text-[10px] font-black uppercase tracking-[0.2em] rounded-xl bg-[var(--accent-mint)] text-black hover:shadow-[0_0_40px_rgba(110,231,183,0.4)] transition-all duration-300 relative overflow-hidden group/btn"
          >
            <span className="relative z-10">Deploy Asset</span>
            <motion.div 
              className="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300"
            />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
