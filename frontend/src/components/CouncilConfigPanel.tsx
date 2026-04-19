import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Trash2 } from "lucide-react";
import type { CouncilMember } from "../types/index.js";
import { maskApiKey } from "../hooks/useCouncilMembers.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

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
  deliberationMode: string;
  onDeliberationModeChange: (value: string) => void;
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

// Separate component for API key input that never displays the real key
function ApiKeyInput({ memberId: _memberId, hasKey, maskedKey, onUpdate }: {
  memberId: string;
  hasKey: boolean;
  maskedKey: string;
  onUpdate: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const handleFocus = () => {
    setEditing(true);
    setDraft("");
  };

  const handleBlur = () => {
    if (draft) {
      onUpdate(draft);
    }
    setEditing(false);
    setDraft("");
  };

  return (
    <input
      type="password"
      placeholder={hasKey ? maskedKey : "API Key (optional)"}
      value={editing ? draft : ""}
      onFocus={handleFocus}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      className="flex-1 px-2 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-mint)]/50 transition-colors font-mono"
    />
  );
}

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
  onUpdateMember,
  deliberationMode,
  onDeliberationModeChange,
}: CouncilConfigPanelProps) {
  const trapRef = useFocusTrap(onClose);
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <motion.div
            ref={trapRef}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            role="dialog"
            aria-modal="true"
            aria-label="Council Configuration"
            className="absolute bottom-full right-4 mb-4 w-96 surface-card rounded-modal shadow-2xl z-50 p-6 border border-[var(--border-medium)] max-h-[60vh] overflow-y-auto scrollbar-custom"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-tight">Council Configuration</h3>
              <button
                onClick={onClose}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] rounded-lg transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-5">
              {/* Summon type */}
              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] block mb-2">Summon Type</label>
                <div className="flex bg-[var(--glass-bg)] rounded-button p-1 border border-[var(--glass-border)]">
                  {[
                    { value: "default", label: "Default" },
                    { value: "role", label: "Role" },
                    { value: "tone", label: "Tone" },
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => onSummonChange(option.value)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                        summon === option.value
                          ? "bg-[var(--bg-surface-1)] text-[var(--text-primary)] shadow-sm"
                          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Role/Tone selection */}
              {summon === "role" && (
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] block mb-2">Role Preset</label>
                  <select
                    value={members[0]?.role || ""}
                    onChange={(e) => onUpdateMember(members[0]?.id, "role", e.target.value)}
                    className="input-base"
                  >
                    <option value="">Select role...</option>
                    {ROLES.map(role => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                  {members[0]?.role && ROLE_PRESETS[members[0].role] && (
                    <div className="mt-2 p-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-button text-xs text-[var(--text-muted)]">
                      {ROLE_PRESETS[members[0].role]}
                    </div>
                  )}
                </div>
              )}

              {summon === "tone" && (
                <div>
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] block mb-2">Tone Preset</label>
                  <select
                    value={members[0]?.tone || ""}
                    onChange={(e) => onUpdateMember(members[0]?.id, "tone", e.target.value)}
                    className="input-base"
                  >
                    <option value="">Select tone...</option>
                    {TONES.map(tone => (
                      <option key={tone} value={tone}>{tone}</option>
                    ))}
                  </select>
                  {members[0]?.tone && TONE_PRESETS[members[0].tone] && (
                    <div className="mt-2 p-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-button text-xs text-[var(--text-muted)]">
                      {TONE_PRESETS[members[0].tone]}
                    </div>
                  )}
                </div>
              )}

              {/* Rounds */}
              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] block mb-2">
                  Rounds: <span className="text-[var(--accent-mint)]">{rounds}</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={rounds}
                  onChange={(e) => onRoundsChange(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-[var(--border-subtle)] rounded-full appearance-none cursor-pointer accent-[var(--accent-mint)]"
                />
                <div className="flex justify-between text-[9px] text-[var(--text-muted)] mt-1">
                  <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
                </div>
              </div>

              {/* Deliberation Mode */}
              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] block mb-2">Reasoning Mode</label>
                <select
                  value={deliberationMode}
                  onChange={(e) => onDeliberationModeChange(e.target.value)}
                  className="input-base text-xs"
                  aria-label="Deliberation mode"
                >
                  <option value="standard">Standard — Council deliberation</option>
                  <option value="socratic">Socratic — Q&amp;A augmented context</option>
                  <option value="red_blue">Red / Blue — Adversarial debate</option>
                  <option value="hypothesis">Hypothesis — Propose, falsify, revise</option>
                  <option value="confidence">Confidence — Weighted by certainty</option>
                </select>
                <p className="mt-1.5 text-[10px] text-[var(--text-muted)] leading-relaxed">
                  {deliberationMode === "socratic" && "Agents generate clarifying questions before the main debate begins."}
                  {deliberationMode === "red_blue" && "Agents split into FOR and AGAINST factions; a neutral judge synthesizes."}
                  {deliberationMode === "hypothesis" && "Agents propose hypotheses, attack each other's, then revise in 3 rounds."}
                  {deliberationMode === "confidence" && "Each agent declares a confidence score; synthesis weights higher confidence more."}
                  {deliberationMode === "standard" && "All agents deliberate in parallel rounds and the master synthesizes a verdict."}
                </p>
              </div>

              {/* Members */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em]">Council Members</label>
                  <button
                    onClick={onAddMember}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-[var(--accent-mint)] hover:bg-[rgba(110,231,183,0.08)] rounded-button transition-colors border border-[rgba(110,231,183,0.15)]"
                  >
                    <Plus size={10} /> Add
                  </button>
                </div>
                <div className="space-y-2">
                  {members.map((member) => (
                    <div key={member.id} className="p-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-button space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Name"
                          value={member.name || ""}
                          onChange={(e) => onUpdateMember(member.id, "name", e.target.value)}
                          className="flex-1 px-2 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-mint)]/50 transition-colors"
                        />
                        <select
                          value={member.type || ""}
                          onChange={(e) => onUpdateMember(member.id, "type", e.target.value)}
                          className="flex-1 px-2 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-mint)]/50 transition-colors"
                        >
                          <option value="openai-compat">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="google">Google</option>
                        </select>
                        {members.length > 1 && (
                          <button
                            onClick={() => onRemoveMember(member.id)}
                            className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-coral)] hover:bg-[var(--glass-bg-hover)] rounded-md transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Model"
                          value={member.model || ""}
                          onChange={(e) => onUpdateMember(member.id, "model", e.target.value)}
                          className="flex-1 px-2 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-mint)]/50 transition-colors font-mono"
                        />
                        <ApiKeyInput
                          memberId={member.id}
                          hasKey={!!member.apiKey}
                          maskedKey={maskApiKey(member.apiKey)}
                          onUpdate={(value) => onUpdateMember(member.id, "apiKey", value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
