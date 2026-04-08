import type { CouncilMember } from "../types/index.js";

interface CouncilConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  summon: string;
  onSummonChange: (value: string) => void;
  rounds: number;
  onRoundsChange: (value: number) => void;
  members: CouncilMember[];
  onAddMember: () => void;
  onRemoveMember: (id: string) => void;
  onUpdateMember: (id: string, field: keyof CouncilMember, value: any) => void;
}

const ROLES = ["Default", "Analyst", "Devil's Advocate", "Optimist", "Pessimist", "Expert", "Critic", "Creative", "Pragmatist"];
const TONES = ["Concise", "Detailed", "Blunt", "Diplomatic", "Academic", "Casual"];

const ROLE_PRESETS: Record<string, string> = {
  "Default": "Respond directly and helpfully.",
  "Analyst": "Analyze systematically. Use data and logic. Break down into clear points.",
  "Devil's Advocate": "Challenge assumptions. Argue the opposite view. Be provocative but logical.",
  "Optimist": "Focus on opportunities, benefits, and positive outcomes.",
  "Pessimist": "Focus on risks, downsides, and what could go wrong.",
  "Expert": "Respond as a domain expert. Be precise and authoritative.",
  "Critic": "Identify flaws, weaknesses, and gaps in any argument.",
  "Creative": "Think outside the box. Suggest unconventional ideas.",
  "Pragmatist": "Focus only on practical, actionable real-world solutions.",
};

const TONE_PRESETS: Record<string, string> = {
  "Concise": "Be brief and to the point.",
  "Detailed": "Be thorough and comprehensive.",
  "Blunt": "Be direct and unfiltered.",
  "Diplomatic": "Be tactful and considerate.",
  "Academic": "Use formal academic language.",
  "Casual": "Use simple conversational language.",
};

export function CouncilConfigPanel({
  isOpen,
  onClose,
  summon,
  onSummonChange,
  rounds,
  onRoundsChange,
  members,
  onAddMember,
  onRemoveMember,
  onUpdateMember
}: CouncilConfigPanelProps) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full right-4 mb-4 w-96 glass-panel rounded-xl shadow-2xl z-50 p-6 border border-white/8 max-h-[60vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-black text-text-dim uppercase tracking-[0.2em]">Council Configuration</div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-dim hover:text-text hover:bg-white/5 rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <div className="space-y-4">
          {/* Summon type */}
          <div>
            <label className="text-xs font-black text-text-dim uppercase tracking-[0.2em] block mb-2">Summon Type</label>
            <select
              value={summon}
              onChange={(e) => onSummonChange(e.target.value)}
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
            >
              <option value="default">Default</option>
              <option value="role">Role-based</option>
              <option value="tone">Tone-based</option>
            </select>
          </div>

          {/* Role/Tone selection */}
          {summon === "role" && (
            <div>
              <label className="text-xs font-black text-text-dim uppercase tracking-[0.2em] block mb-2">Role Preset</label>
              <select
                value={members[0]?.role || ""}
                onChange={(e) => onUpdateMember(members[0]?.id, "role", e.target.value)}
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">Select role...</option>
                {ROLES.map(role => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              {members[0]?.role && ROLE_PRESETS[members[0].role] && (
                <div className="mt-2 p-3 bg-white/[0.02] border border-white/[0.06] rounded-lg text-xs text-text-muted">
                  {ROLE_PRESETS[members[0].role]}
                </div>
              )}
            </div>
          )}

          {summon === "tone" && (
            <div>
              <label className="text-xs font-black text-text-dim uppercase tracking-[0.2em] block mb-2">Tone Preset</label>
              <select
                value={members[0]?.tone || ""}
                onChange={(e) => onUpdateMember(members[0]?.id, "tone", e.target.value)}
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">Select tone...</option>
                {TONES.map(tone => (
                  <option key={tone} value={tone}>{tone}</option>
                ))}
              </select>
              {members[0]?.tone && TONE_PRESETS[members[0].tone] && (
                <div className="mt-2 p-3 bg-white/[0.02] border border-white/[0.06] rounded-lg text-xs text-text-muted">
                  {TONE_PRESETS[members[0].tone]}
                </div>
              )}
            </div>
          )}

          {/* Rounds */}
          <div>
            <label className="text-xs font-black text-text-dim uppercase tracking-[0.2em] block mb-2">Deliberation Rounds</label>
            <input
              type="number"
              min="1"
              max="5"
              value={rounds}
              onChange={(e) => onRoundsChange(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>

          {/* Members */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-black text-text-dim uppercase tracking-[0.2em]">Council Members</label>
              <button
                onClick={onAddMember}
                className="px-2 py-1 bg-accent/10 border border-accent/20 rounded-lg text-[10px] text-accent hover:bg-accent/20 transition-colors"
              >
                Add Member
              </button>
            </div>
            <div className="space-y-2">
              {members.map((member) => (
                <div key={member.id} className="flex items-center gap-2 p-3 bg-white/[0.02] border border-white/[0.06] rounded-lg">
                  <input
                    type="text"
                    placeholder="Name"
                    value={member.name || ""}
                    onChange={(e) => onUpdateMember(member.id, "name", e.target.value)}
                    className="flex-1 px-2 py-1 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
                  />
                  <select
                    value={member.type || ""}
                    onChange={(e) => onUpdateMember(member.id, "type", e.target.value)}
                    className="flex-1 px-2 py-1 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
                  >
                    <option value="openai-compat">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                  </select>
                  <input
                    type="text"
                    placeholder="API Key (optional)"
                    value={member.apiKey || ""}
                    onChange={(e) => onUpdateMember(member.id, "apiKey", e.target.value)}
                    className="flex-1 px-2 py-1 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
                  />
                  <input
                    type="text"
                    placeholder="Model"
                    value={member.model || ""}
                    onChange={(e) => onUpdateMember(member.id, "model", e.target.value)}
                    className="flex-1 px-2 py-1 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
                  />
                  {members.length > 1 && (
                    <button
                      onClick={() => onRemoveMember(member.id)}
                      className="p-1 text-text-dim hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
