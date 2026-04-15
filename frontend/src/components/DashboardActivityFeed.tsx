import { motion } from "framer-motion";
import { MessageSquare, Zap, Target, ArrowUpRight, Clock } from "lucide-react";

import { ActivityFeedSkeleton } from "./LoadingSkeletons";

interface Activity {
  id: string;
  type: "consensus" | "deliberation" | "benchmark";
  title: string;
  subtitle: string;
  timestamp: string;
  status: "active" | "completed";
}

const MOCK_ACTIVITIES: Activity[] = [
  {
    id: "1",
    type: "consensus",
    title: "Project Phoenix Architecture",
    subtitle: "84% Consensus Reached • 4 Agents",
    timestamp: "2m ago",
    status: "completed"
  },
  {
    id: "2",
    type: "deliberation",
    title: "Market Strategy Analysis",
    subtitle: "Round 3/5 • Critical Conflict Detected",
    timestamp: "Just now",
    status: "active"
  },
  {
    id: "3",
    type: "benchmark",
    title: "Logic-7b vs GPT-4o Arena",
    subtitle: "Stress Testing Persona: 'Aggressive Architect'",
    timestamp: "15m ago",
    status: "completed"
  },
  {
    id: "4",
    type: "consensus",
    title: "Quarterly Risk Assessment",
    subtitle: "Mathematical Synthesis in Progress",
    timestamp: "5m ago",
    status: "active"
  }
];

export function DashboardActivityFeed({ loading }: { loading?: boolean }) {
  if (loading) return <ActivityFeedSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
          <Zap size={14} className="text-[var(--accent-mint)]" />
          Live Council Pulse
        </h3>
        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest px-2 py-0.5 rounded-pill bg-[var(--glass-bg)] border border-[var(--glass-border)]">
          Real-time
        </span>
      </div>

      <div className="space-y-2">
        {MOCK_ACTIVITIES.map((activity, i) => (
          <motion.div
            key={activity.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="surface-card p-3 flex items-center gap-3 group relative overflow-hidden"
          >
            {activity.status === "active" && (
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--accent-mint)] shadow-[0_0_10px_var(--accent-mint)] animate-pulse" />
            )}

            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              activity.type === "consensus" ? "bg-emerald-500/10 text-emerald-400" :
              activity.type === "deliberation" ? "bg-blue-500/10 text-blue-400" :
              "bg-amber-500/10 text-amber-400"
            }`}>
              {activity.type === "consensus" ? <Target size={16} /> :
               activity.type === "deliberation" ? <MessageSquare size={16} /> :
               <Zap size={16} />}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                  {activity.title}
                </span>
                <span className="text-[9px] text-[var(--text-muted)] whitespace-nowrap flex items-center gap-1">
                  <Clock size={8} /> {activity.timestamp}
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                {activity.subtitle}
              </p>
            </div>

            <ArrowUpRight size={14} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
          </motion.div>
        ))}
      </div>

      <button className="w-full py-2 text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] uppercase tracking-widest bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-pill transition-all">
        View All Operations
      </button>
    </div>
  );
}
