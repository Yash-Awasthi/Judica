import { motion } from "framer-motion";
import { Activity } from "lucide-react";

interface SectorHUDProps {
  sectorId: string;
  title: string;
  subtitle?: string;
  accentColor?: string;
  telemetry?: Array<{
    label: string;
    value: string;
    status: "optimal" | "online" | "alert" | "warning";
  }>;
}

export function SectorHUD({ 
  sectorId, 
  title, 
  subtitle = "Neural_Link_Stable // Root Operational Sector",
  accentColor = "var(--accent-mint)",
  telemetry = []
}: SectorHUDProps) {
  return (
    <header className="shrink-0 h-32 flex flex-col justify-center px-10 bg-black/40 backdrop-blur-3xl border-b border-white/5 z-40 relative group overflow-hidden">
      <div 
        className="absolute top-0 left-0 w-full h-[1px] opacity-20 group-hover:opacity-100 transition-opacity duration-1000"
        style={{ background: `linear-gradient(to right, transparent, ${accentColor}, transparent)` }}
      />
      
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="flex items-center gap-3 mb-2">
            <div 
              className="px-2 py-0.5 rounded-sm bg-white/5 border transition-all duration-500"
              style={{ borderColor: `${accentColor}33`, backgroundColor: `${accentColor}11` }}
            >
              <span 
                className="text-[9px] font-black uppercase tracking-[0.4em] font-diag animate-pulse"
                style={{ color: accentColor }}
              >
                {sectorId}
              </span>
            </div>
            <div className="h-[1px] w-6 bg-white/10" />
            <div className="flex items-center gap-1.5 opacity-40">
              <Activity size={10} style={{ color: accentColor }} />
              <span className="text-[8px] font-diag text-white/40 uppercase tracking-widest leading-none">STREAMING_TELEMETRY</span>
            </div>
          </div>
          
          <div className="flex flex-col">
            <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic flex items-center gap-4">
              {title.replace(/_/g, ' ')}
              <span className="text-[10px] font-mono opacity-10 font-normal tracking-[0.5em] hidden sm:inline">// {subtitle}</span>
            </h1>
          </div>
        </div>

        <div className="hidden xl:flex items-center gap-8 ml-10 pl-10 border-l border-white/5">
          {telemetry.map((item, idx) => (
            <div key={idx} className="flex flex-col items-start gap-1 group/stat">
              <span className="text-[8px] font-diag text-white/20 uppercase tracking-[0.3em]">{item.label}</span>
              <div className="flex items-center gap-3">
                <div 
                  className={`w-1 h-1 rounded-full animate-pulse`}
                  style={{ 
                    backgroundColor: item.status === "optimal" ? "var(--accent-mint)" : 
                                    item.status === "alert" ? "var(--accent-coral)" : 
                                    "var(--accent-blue)" 
                  }}
                />
                <span className="text-[14px] font-black text-white/60 tracking-tighter uppercase font-diag group-hover/stat:text-white transition-colors">
                  {item.value}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Animated Scan Line */}
      <motion.div 
        className="absolute bottom-0 left-0 right-0 h-[1.5px] opacity-20"
        style={{ background: `linear-gradient(to right, transparent, ${accentColor}, transparent)` }}
        animate={{ x: ["-100%", "100%"] }}
        transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
      />
    </header>
  );
}
