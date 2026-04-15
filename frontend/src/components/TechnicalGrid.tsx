import { motion, AnimatePresence } from 'framer-motion';

interface TechnicalGridProps {
  opacity?: number;
  showScanline?: boolean;
}

export function TechnicalGrid({ opacity = 0.05, showScanline = false }: TechnicalGridProps) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden select-none">
      {/* ━━━ Grid Base ━━━ */}
      <div 
        className="absolute inset-0" 
        style={{ 
          opacity: opacity * 0.6,
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px'
        }} 
      />
      
      {/* ━━━ Intense Scanning Overlay ━━━ */}
      <AnimatePresence>
        {showScanline && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 pointer-events-none"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--accent-mint)]/[0.02] to-transparent animate-scan" />
            <div className="absolute top-0 left-0 w-full h-full">
               {[...Array(6)].map((_, i) => (
                 <motion.div
                   key={i}
                   className="absolute h-[1px] w-full bg-[var(--accent-mint)]/10"
                   initial={{ top: "-10%" }}
                   animate={{ top: "110%" }}
                   transition={{ 
                     duration: 1.5 + i * 0.5, 
                     repeat: Infinity, 
                     ease: "linear",
                     delay: i * 0.2
                   }}
                 />
               ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div 
        className="absolute inset-0" 
        style={{ 
          opacity: opacity,
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '200px 200px',
          border: '1px solid rgba(255,255,255,0.05)'
        }} 
      />

      {/* ━━━ Dynamic Orbs ━━━ */}
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-[var(--accent-mint)]/5 blur-[120px] rounded-full animate-drift-slow" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[var(--accent-blue)]/5 blur-[100px] rounded-full animate-drift" />
      
      {/* ━━━ Main Scan Line ━━━ */}
      <motion.div 
        className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent-mint)]/20 to-transparent z-10"
        animate={{ translateY: ['0vh', '100vh'] }}
        transition={{ repeat: Infinity, duration: 6, ease: "linear" }}
      />

      {/* ━━━ Technical Markings ━━━ */}
      <div className="absolute top-10 left-10 text-[8px] font-mono text-white/10 uppercase tracking-[0.5em] writing-mode-vertical whitespace-nowrap">
        Sector_Grid // {showScanline ? "Initializing_Stream" : "System_Optimal"}
      </div>
      <div className="absolute bottom-10 right-10 text-[8px] font-mono text-white/10 uppercase tracking-[0.5em]">
        Lattice_Coord_V2.0.4
      </div>

      {/* ━━━ Corner Brackets ━━━ */}
      <div className="absolute top-4 left-4 w-8 h-8 border-t border-l border-white/10" />
      <div className="absolute top-4 right-4 w-8 h-8 border-t border-r border-white/10" />
      <div className="absolute bottom-4 left-4 w-8 h-8 border-b border-l border-white/10" />
      <div className="absolute bottom-4 right-4 w-8 h-8 border-b border-r border-white/10" />
    </div>
  );
}
