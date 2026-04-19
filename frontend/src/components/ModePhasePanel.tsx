import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, MessageCircleQuestion, Swords, FlaskConical, BarChart3 } from "lucide-react";
import type { ModePhase } from "../types/index";

interface ModePhaseProps {
  mode: string;
  phases: ModePhase[];
  isStreaming?: boolean;
}

const MODE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  socratic:   { label: "Socratic Dialogue",        icon: <MessageCircleQuestion size={14} />, color: "var(--accent-mint)" },
  red_blue:   { label: "Red / Blue Debate",         icon: <Swords size={14} />,               color: "var(--accent-coral)" },
  hypothesis: { label: "Hypothesis Refinement",     icon: <FlaskConical size={14} />,          color: "#a78bfa" },
  confidence: { label: "Confidence Calibration",    icon: <BarChart3 size={14} />,             color: "var(--accent-gold)" },
};

// ── Socratic Q&A ─────────────────────────────────────────────────────────────

function SocraticPhase({ phase }: { phase: ModePhase }) {
  const qa = phase.qa ?? [];
  if (qa.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
        Clarifying Q&amp;A ({qa.length} questions resolved)
      </p>
      <div className="space-y-2">
        {qa.map((item, i) => (
          <div key={i} className="text-xs space-y-0.5">
            <p className="text-[var(--accent-mint)] font-medium">Q: {item.q}</p>
            <p className="text-[var(--text-secondary)] pl-3 border-l border-[var(--border-subtle)]">A: {item.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Red / Blue ────────────────────────────────────────────────────────────────

function RedBluePhase({ phase }: { phase: ModePhase }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-red-400">Red Team — FOR</p>
        <p className="text-xs text-[var(--text-secondary)] line-clamp-4 leading-relaxed">{phase.redArguments}</p>
      </div>
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-400">Blue Team — AGAINST</p>
        <p className="text-xs text-[var(--text-secondary)] line-clamp-4 leading-relaxed">{phase.blueArguments}</p>
      </div>
    </div>
  );
}

// ── Hypothesis Rounds ─────────────────────────────────────────────────────────

const ROUND_COLORS: Record<string, string> = {
  propose: "text-[var(--accent-mint)]",
  falsify: "text-[var(--accent-coral)]",
  revise:  "text-[#a78bfa]",
};

function HypothesisPhase({ phase }: { phase: ModePhase }) {
  const round = phase.round;
  if (!round) return null;
  const colorClass = ROUND_COLORS[round.phase] ?? "text-[var(--text-muted)]";
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
        Round {round.round} —{" "}
        <span className={colorClass}>{round.phase.charAt(0).toUpperCase() + round.phase.slice(1)}</span>
      </p>
      <div className="space-y-1.5">
        {round.hypotheses.map((h, i) => (
          <div key={i} className="text-xs flex gap-2">
            <span className="shrink-0 font-semibold text-[var(--text-muted)] w-24 truncate">{h.agent}</span>
            <span className="text-[var(--text-secondary)] line-clamp-2">{h.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Confidence ────────────────────────────────────────────────────────────────

function ConfidencePhase({ phase }: { phase: ModePhase }) {
  const opinions = phase.opinions ?? [];
  if (opinions.length === 0) return null;
  const sorted = [...opinions].sort((a, b) => b.confidence - a.confidence);
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
        Calibrated Confidence Scores
      </p>
      <div className="space-y-2">
        {sorted.map((o, i) => {
          const pct = Math.round(o.confidence * 100);
          return (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-[var(--text-secondary)]">{o.agent}</span>
                <span className="text-[var(--accent-gold)] font-bold">{pct}%</span>
              </div>
              <div className="h-1 bg-[var(--border-subtle)] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, delay: i * 0.08, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{ background: `var(--accent-gold)` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Spinner shown while mode is running ──────────────────────────────────────

function ModeSpinner({ mode }: { mode: string }) {
  const meta = MODE_META[mode];
  if (!meta) return null;
  return (
    <div className="flex items-center gap-2 py-2">
      <div
        className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: `${meta.color} transparent transparent transparent` }}
      />
      <span className="text-xs text-[var(--text-muted)]">
        Running {meta.label}…
      </span>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ModePhasePanel({ mode, phases, isStreaming }: ModePhaseProps) {
  const [open, setOpen] = useState(true);
  const meta = MODE_META[mode];
  if (!meta) return null;

  const hasPhases = phases.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mb-5 rounded-xl border border-[var(--border-medium)] bg-[var(--glass-bg)] overflow-hidden"
    >
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-[var(--glass-bg-hover)] transition-colors"
      >
        <span style={{ color: meta.color }}>{meta.icon}</span>
        <span className="text-xs font-semibold text-[var(--text-primary)] flex-1 text-left">
          {meta.label}
        </span>
        {isStreaming && !hasPhases && <ModeSpinner mode={mode} />}
        {hasPhases && (
          <ChevronDown
            size={13}
            className="text-[var(--text-muted)] transition-transform"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        )}
      </button>

      {/* Phase content */}
      <AnimatePresence>
        {open && hasPhases && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-[var(--border-subtle)]">
              {phases.map((phase, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="pt-3"
                >
                  {phase.phase === "socratic_prelude" && <SocraticPhase phase={phase} />}
                  {phase.phase === "red_blue_complete" && <RedBluePhase phase={phase} />}
                  {phase.phase === "hypothesis_round" && <HypothesisPhase phase={phase} />}
                  {phase.phase === "calibrated_opinions" && <ConfidencePhase phase={phase} />}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
