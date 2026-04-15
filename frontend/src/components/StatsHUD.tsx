import * as React from 'react';
import { motion } from 'framer-motion';
import { AnimatedCounter } from './AnimatedCounter';

interface StatItem {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  color?: string;
}

interface StatsHUDProps {
  stats: StatItem[];
}

export function StatsHUD({ stats }: StatsHUDProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 p-4 lg:p-8 pointer-events-none">
      <div className="max-w-7xl mx-auto flex flex-wrap lg:flex-nowrap justify-center lg:justify-end gap-4">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 + 0.5 }}
            className="pointer-events-auto relative px-8 py-5 rounded-[2rem] bg-gradient-to-br from-[#000000]/80 to-white/[0.03] border border-white/5 backdrop-blur-3xl group overflow-hidden shadow-2xl min-w-[200px]"
          >
            <div 
              className="absolute top-0 right-0 w-24 h-24 blur-[60px] opacity-10 pointer-events-none group-hover:opacity-20 transition-opacity" 
              style={{ backgroundColor: stat.color || "var(--accent-mint)" }} 
            />
            <div className="flex items-center gap-5 relative z-10">
              {stat.icon && (
                <div 
                  className="w-10 h-10 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center transition-all group-hover:scale-110 duration-500" 
                  style={{ color: stat.color || "var(--accent-mint)" }}
                >
                  {stat.icon}
                </div>
              )}
              <div>
                <p className="text-[10px] font-diag text-white/20 uppercase tracking-[0.3em] mb-1">{stat.label}</p>
                <p className="text-xl font-black text-white tracking-tighter italic drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]">
                  {typeof stat.value === "number" ? <AnimatedCounter value={stat.value} /> : stat.value}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
