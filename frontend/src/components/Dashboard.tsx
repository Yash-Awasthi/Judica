import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Workflow, Code2, Store, BarChart3, Search, MessageSquare, Database, Swords
} from "lucide-react";
import { HeroScene } from "./HeroScene";
import { TiltCard } from "./TiltCard";

import { DashboardActivityFeed } from "./DashboardActivityFeed";
import { DashboardTopPerformingAgents } from "./DashboardTopPerformingAgents";
import { DashboardDNATicker } from "./DashboardDNATicker";
import { SectorHUD } from "./SectorHUD";
import { TechnicalGrid } from "./TechnicalGrid";

interface DashboardProps {
  onStartChat?: (templateId?: string) => void;
}

const stagger = {
  container: {
    animate: { transition: { staggerChildren: 0.06 } }
  },
  item: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } }
  }
};

const COUNCIL_TEMPLATES = [
  {
    id: "debate",
    title: "Debate Council",
    description: "Structured adversarial deliberation",
    icon: <Swords size={18} />,
    color: "var(--accent-coral)",
    roles: ["Advocate", "Critic", "Judge"],
  },
  {
    id: "research",
    title: "Research Panel",
    description: "Deep literature & methodology critique",
    icon: <Search size={18} />,
    color: "var(--accent-blue)",
    roles: ["Analyst", "Reviewer", "Statistician"],
  },
  {
    id: "technical",
    title: "Technical Review",
    description: "Architecture & code analysis",
    icon: <Code2 size={18} />,
    color: "var(--accent-mint)",
    roles: ["Architect", "Security", "QA"],
  },
];

export function Dashboard({ onStartChat }: DashboardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative h-full bg-[#000000] overflow-hidden">
      <TechnicalGrid showScanline={loading} />

      <div className="relative z-10 h-full overflow-y-auto scrollbar-custom p-4 lg:p-8">
        <motion.div
          variants={stagger.container}
          initial="initial"
          animate="animate"
          className="max-w-7xl mx-auto space-y-12 pb-24"
        >
          <SectorHUD
            sectorId="UNIT-00"
            title="Mission_Control"
            subtitle="Central Intelligence Nexus // Root Operational Sector"
            accentColor="var(--accent-mint)"
            telemetry={[
              { label: "SYS_STABILITY", value: loading ? "INITIALIZING..." : "99.2%", status: loading ? "online" : "optimal" },
              { label: "CONSENSUS_ST", value: loading ? "SCANNING..." : "ACTIVE", status: "online" },
              { label: "UPLINK_BAND", value: loading ? "SYNCING..." : "1.2GB/s", status: "optimal" }
            ]}
          />


        {/* ━━━━━ MAIN GRID ━━━━━ */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:col-span-12 xl:grid-cols-12 gap-6 lg:gap-8">

          {/* LEFT COLUMN: Operations & Entry (Col 8) */}
          <div className="md:col-span-2 xl:col-span-8 space-y-8 lg:space-y-12">

            {/* Hero Sub-section */}
            <motion.section variants={stagger.item} className="relative p-12 rounded-[3.5rem] bg-white/[0.01] border border-white/5 backdrop-blur-3xl overflow-hidden group shadow-2xl">
              <div className="absolute top-0 right-0 w-[40%] h-[40%] bg-[var(--accent-mint)]/5 blur-[120px] pointer-events-none" />

              <div className="relative z-10 max-w-2xl">
                <div className="flex items-center gap-4 mb-8">
                  <div className="px-3 py-1 rounded-lg bg-[var(--accent-mint)]/10 border border-[var(--accent-mint)]/20 text-[10px] font-black uppercase text-[var(--accent-mint)] tracking-[0.3em] font-diag">
                    Sector-01 // Ops_Nexus
                  </div>
                  <div className="h-[1px] w-24 bg-gradient-to-r from-[var(--accent-mint)]/40 to-transparent" />
                </div>

                <h2 className="text-5xl lg:text-7xl font-black text-white tracking-tighter leading-[0.85] mb-8 italic uppercase">
                  NEURAL<br />
                  <span className="text-[var(--accent-mint)] drop-shadow-[0_0_20px_rgba(110,231,183,0.3)]">CONVERGENCE</span>
                </h2>

                <p className="text-sm lg:text-base text-white/50 leading-relaxed mb-12 max-w-md font-diag uppercase tracking-wider">
                  ORCHESTRATE MULTI-AGENT COUNCILS TO ACHIEVE MATHEMATICAL CONSENSUS.
                  BRIDGE THE GAP BETWEEN RAW LLM OUTPUTS AND VERIFIABLE INTELLIGENCE.
                </p>

                  <button
                    onClick={() => onStartChat?.()}
                    className="group relative h-14 px-10 rounded-2xl bg-[var(--accent-mint)] text-black font-black uppercase tracking-[0.2em] text-[11px] shadow-[0_0_30px_rgba(110,231,183,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-3"
                  >
                    <MessageSquare size={18} className="group-hover:rotate-12 transition-transform" />
                    INITIALIZE_COUNCIL
                  </button>
                  <button
                    onClick={() => navigate("/workflows")}
                    className="group h-14 px-10 rounded-2xl bg-white/[0.03] border border-white/10 text-white font-black uppercase tracking-[0.2em] text-[11px] hover:bg-white/[0.08] hover:border-[var(--accent-mint)]/30 transition-all flex items-center gap-3"
                  >
                    <Workflow size={18} />
                    BUILD_PROTOCOL
                  </button>
                </div>


              {/* Decorative Hero Scene Background */}
              <div className="absolute right-[-10%] bottom-[-10%] w-[70%] h-[130%] opacity-20 group-hover:opacity-40 transition-all duration-1000 pointer-events-none filter blur-xl mix-blend-screen">
                <HeroScene className="w-full h-full scale-125 rotate-[-5deg]" />
              </div>
            </motion.section>

            {/* Templates Section */}
            <motion.section variants={stagger.item}>
              <div className="flex items-center gap-4 mb-6">
                <h3 className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Sector-02 // Deployment</h3>
                <div className="h-[1px] flex-1 bg-white/[0.05]" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {COUNCIL_TEMPLATES.map((tmpl) => (
                  <TiltCard key={tmpl.id}>
                    <button
                      onClick={() => onStartChat?.(tmpl.id)}
                      className="surface-card w-full p-5 text-left group hover:border-[var(--accent-mint)] transition-all"
                    >
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
                        style={{ background: `color-mix(in srgb, ${tmpl.color} 10%, transparent)`, color: tmpl.color }}
                      >
                        {tmpl.icon}
                      </div>
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">{tmpl.title}</h4>
                      <p className="text-[10px] text-[var(--text-muted)] mt-1 line-clamp-1">{tmpl.description}</p>
                      <div className="flex flex-wrap gap-1 mt-3">
                        {tmpl.roles.map(r => (
                          <span key={r} className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--text-muted)] border border-[var(--glass-border)]">
                            {r}
                          </span>
                        ))}
                      </div>
                    </button>
                  </TiltCard>
                ))}
              </div>
            </motion.section>

            {/* Activity Feed Section */}
            <motion.section variants={stagger.item}>
              <DashboardActivityFeed loading={loading} />
            </motion.section>

          </div>

          {/* RIGHT COLUMN: Intelligence & DNA (Col 4) */}
          <div className="xl:col-span-4 space-y-12">

            {/* Top Performers */}
            <motion.section variants={stagger.item} className="relative">
              <div className="flex items-center gap-4 mb-6">
                <h3 className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Sector-03 // Intelligence</h3>
                <div className="h-[1px] flex-1 bg-white/[0.05]" />
              </div>
              <DashboardTopPerformingAgents loading={loading} />
            </motion.section>

            {/* DNA Evolution Ticker */}
            <motion.section variants={stagger.item}>
              <DashboardDNATicker />
            </motion.section>

            {/* Quick Actions / Explore */}
            <motion.section variants={stagger.item}>
              <h3 className="text-xs font-black text-[var(--text-muted)] uppercase tracking-[0.2em] mb-4">Ecosystem</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { to: "/marketplace", icon: <Store size={14} />, label: "Marketplace" },
                  { to: "/repos", icon: <Database size={14} />, label: "Knowledge" },
                  { to: "/analytics", icon: <BarChart3 size={14} />, label: "Performance" },
                  { to: "/prompts", icon: <Code2 size={14} />, label: "Prompt IDE" },
                ].map((link) => (
                  <button
                    key={link.to}
                    onClick={() => navigate(link.to)}
                    className="surface-card p-3 flex items-center gap-2 hover:border-[var(--accent-mint)] group transition-all"
                  >
                    <div className="text-[var(--text-muted)] group-hover:text-[var(--accent-mint)] transition-colors">
                      {link.icon}
                    </div>
                    <span className="text-[10px] font-bold text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                      {link.label}
                    </span>
                  </button>
                ))}
              </div>
            </motion.section>

            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
