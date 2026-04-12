import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, Sparkles, MessageSquare, Swords, Users,
  Workflow, Code2, Search, Store, BarChart3, Database, Brain
} from "lucide-react";
import { HeroScene } from "./HeroScene";
import { TiltCard } from "./TiltCard";
import { AnimatedCounter } from "./AnimatedCounter";

interface DashboardProps {
  onStartChat?: (templateId?: string) => void;
}

const stagger = {
  container: {
    animate: { transition: { staggerChildren: 0.06 } }
  },
  item: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } }
  }
};

const COUNCIL_TEMPLATES = [
  {
    id: "debate",
    title: "Debate Council",
    description: "Structured adversarial debate with thesis and antithesis positions",
    icon: <Swords size={20} />,
    color: "var(--accent-coral)",
    gradient: "from-red-500/10 to-orange-500/10",
    borderColor: "hover:border-[var(--accent-coral)]",
    roles: ["Advocate", "Critic", "Moderator", "Judge"],
  },
  {
    id: "research",
    title: "Research Panel",
    description: "Deep analysis with literature review and methodology critique",
    icon: <Search size={20} />,
    color: "var(--accent-blue)",
    gradient: "from-blue-500/10 to-cyan-500/10",
    borderColor: "hover:border-[var(--accent-blue)]",
    roles: ["Researcher", "Analyst", "Statistician", "Reviewer"],
  },
  {
    id: "technical",
    title: "Technical Review",
    description: "Architecture decisions, code review, and system design analysis",
    icon: <Code2 size={20} />,
    color: "var(--accent-mint)",
    gradient: "from-emerald-500/10 to-teal-500/10",
    borderColor: "hover:border-[var(--accent-mint)]",
    roles: ["Architect", "DevOps", "Security", "QA"],
  },
  {
    id: "creative",
    title: "Creative Workshop",
    description: "Brainstorming, narrative development, and creative synthesis",
    icon: <Sparkles size={20} />,
    color: "var(--accent-gold)",
    gradient: "from-amber-500/10 to-yellow-500/10",
    borderColor: "hover:border-[var(--accent-gold)]",
    roles: ["Ideator", "Storyteller", "Critic", "Synthesizer"],
  },
];

const QUICK_LINKS = [
  { to: "/workflows", icon: <Workflow size={18} />, label: "Workflows", desc: "Build agent pipelines" },
  { to: "/prompts", icon: <Code2 size={18} />, label: "Prompt IDE", desc: "Test & version prompts" },
  { to: "/debate", icon: <Swords size={18} />, label: "Debate Arena", desc: "Live agent debates" },
  { to: "/marketplace", icon: <Store size={18} />, label: "Marketplace", desc: "Community resources" },
  { to: "/repos", icon: <Database size={18} />, label: "Knowledge", desc: "Repos & memory" },
  { to: "/analytics", icon: <BarChart3 size={18} />, label: "Analytics", desc: "Usage & costs" },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Ask", desc: "Submit your question to the council" },
  { step: "02", title: "Deliberate", desc: "AI agents analyze independently" },
  { step: "03", title: "Review", desc: "Agents peer-review each other" },
  { step: "04", title: "Converge", desc: "Mathematical consensus synthesis" },
];

export function Dashboard({ onStartChat }: DashboardProps) {
  const navigate = useNavigate();

  return (
    <div className="h-full overflow-y-auto scrollbar-custom">
      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="max-w-6xl mx-auto px-6 py-8 space-y-16"
      >
        {/* ━━━━━ HERO SECTION ━━━━━ */}
        <motion.section variants={stagger.item} className="relative grid grid-cols-1 lg:grid-cols-2 gap-8 items-center min-h-[400px]">
          {/* Left — Copy */}
          <div className="space-y-6 z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-[var(--glass-bg)] border border-[var(--glass-border)] text-xs text-[var(--text-secondary)]">
              <Brain size={12} className="text-[var(--accent-mint)]" />
              <span>Multi-Agent Deliberative Intelligence</span>
            </div>

            <h1 className="text-display text-[var(--text-primary)]">
              Where AI<br />
              <span className="gradient-text">Minds Converge</span>
            </h1>

            <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-lg">
              4+ AI agents debate, critique, and synthesize answers through structured
              deliberation — reaching mathematical consensus on your most complex questions.
            </p>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={() => onStartChat?.()}
                className="btn-pill-primary text-base px-7 py-3"
              >
                <MessageSquare size={18} />
                Start Deliberation
              </button>
              <button
                onClick={() => navigate("/debate")}
                className="btn-pill-ghost text-base px-7 py-3"
              >
                <Swords size={18} />
                Debate Arena
              </button>
            </div>
          </div>

          {/* Right — 3D Hero */}
          <div className="relative h-[350px] lg:h-[420px]">
            <HeroScene className="w-full h-full" />
            {/* Glow overlay */}
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-l from-transparent via-transparent to-[var(--bg)] lg:bg-none" />
          </div>
        </motion.section>

        {/* ━━━━━ STATS STRIP ━━━━━ */}
        <motion.section variants={stagger.item}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "AI Providers", value: 9, suffix: "+" },
              { label: "Parallel Agents", value: 4, suffix: "+" },
              { label: "Deliberation Rounds", value: 5, prefix: "1-" },
              { label: "Avg Consensus", value: 85, suffix: "%" },
            ].map((stat, i) => (
              <div key={i} className="glass-panel px-5 py-4 text-center">
                <div className="text-2xl font-bold text-[var(--text-primary)]">
                  {stat.prefix}
                  <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                </div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mt-1 font-semibold">{stat.label}</p>
              </div>
            ))}
          </div>
        </motion.section>

        {/* ━━━━━ COUNCIL TEMPLATES ━━━━━ */}
        <motion.section variants={stagger.item}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">Council Templates</h2>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">Pre-configured agent councils for common use cases</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COUNCIL_TEMPLATES.map((tmpl) => (
              <TiltCard key={tmpl.id}>
                <button
                  onClick={() => onStartChat?.(tmpl.id)}
                  className={`surface-card w-full text-left p-5 group transition-all duration-300 ${tmpl.borderColor}`}
                >
                  {/* Top bar accent */}
                  <div className="h-0.5 rounded-full mb-4 w-12" style={{ background: tmpl.color }} />

                  <div className="flex items-start gap-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${tmpl.color} 12%, transparent)`, color: tmpl.color }}
                    >
                      {tmpl.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-mint)] transition-colors">
                        {tmpl.title}
                      </h3>
                      <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{tmpl.description}</p>
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {tmpl.roles.map((role) => (
                          <span key={role} className="px-2 py-0.5 text-[9px] uppercase tracking-wider font-semibold rounded-pill bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-muted)]">
                            {role}
                          </span>
                        ))}
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-[var(--text-muted)] group-hover:text-[var(--accent-mint)] group-hover:translate-x-1 transition-all shrink-0 mt-1" />
                  </div>
                </button>
              </TiltCard>
            ))}
          </div>
        </motion.section>

        {/* ━━━━━ HOW IT WORKS ━━━━━ */}
        <motion.section variants={stagger.item}>
          <h2 className="text-xl font-bold text-[var(--text-primary)] tracking-tight mb-6">How It Works</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={i} className="glass-panel p-5 relative">
                <span className="text-3xl font-black text-[var(--accent-mint)] opacity-15">{step.step}</span>
                <h3 className="text-sm font-bold text-[var(--text-primary)] mt-2">{step.title}</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{step.desc}</p>
                {i < HOW_IT_WORKS.length - 1 && (
                  <div className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10">
                    <ArrowRight size={14} className="text-[var(--accent-mint)] opacity-30" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.section>

        {/* ━━━━━ QUICK LINKS ━━━━━ */}
        <motion.section variants={stagger.item}>
          <h2 className="text-xl font-bold text-[var(--text-primary)] tracking-tight mb-6">Explore</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {QUICK_LINKS.map((link) => (
              <TiltCard key={link.to} tiltAmount={2}>
                <button
                  onClick={() => navigate(link.to)}
                  className="surface-card w-full text-left p-4 group hover:border-[var(--accent-mint)] transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[rgba(110,231,183,0.06)] border border-[rgba(110,231,183,0.1)] flex items-center justify-center text-[var(--accent-mint)] group-hover:bg-[rgba(110,231,183,0.1)] transition-colors shrink-0">
                      {link.icon}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{link.label}</h3>
                      <p className="text-[10px] text-[var(--text-muted)]">{link.desc}</p>
                    </div>
                  </div>
                </button>
              </TiltCard>
            ))}
          </div>
        </motion.section>

        {/* Bottom padding */}
        <div className="h-8" />
      </motion.div>
    </div>
  );
}
