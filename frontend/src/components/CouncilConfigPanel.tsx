import { useState, useEffect } from "react";
import { ArchetypeEditor } from "./ArchetypeEditor.js";
import { useAuth } from "../context/AuthContext.js";
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
  const { fetchWithAuth } = useAuth();
  const [archetypes, setArchetypes] = useState<Record<string, any>>({});
  const [editingArchetypeId, setEditingArchetypeId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchWithAuth('/api/archetypes')
        .then(res => res.json())
        .then(data => {
          if (data.archetypes) {
            setArchetypes(data.archetypes);
          }
        })
        .catch(err => console.error("Failed to fetch archetypes", err));
    }
  }, [isOpen, fetchWithAuth]);

  if (!isOpen) return null;

  const roleOptions = Object.keys(archetypes).length > 0
    ? Object.values(archetypes).map(a => a.name)
    : ROLES;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full right-4 mb-4 w-96 glass-panel rounded-xl shadow-2xl z-50 p-6 border border-white/8 max-h-[60vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-black text-text-dim uppercase tracking-[0.2em] flex-1">Council Configuration</div>
          <button
            onClick={() => setEditingArchetypeId("new")}
            className="px-3 py-1 mr-2 bg-accent/10 hover:bg-accent/20 text-accent text-xs font-bold rounded-lg transition-colors border border-accent/20"
          >
            + Archetype
          </button>
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

          {/* Rounds */}
          <div>
            <label className="text-xs font-black text-text-dim uppercase tracking-[0.2em] block mb-2">Debate Rounds: {rounds}</label>
            <input
              type="range"
              min="1"
              max="5"
              value={rounds}
              onChange={(e) => onRoundsChange(parseInt(e.target.value))}
              className="w-full accent-accent bg-white/10"
            />
          </div>

          {/* Role/Tone selection */}
          {summon === "role" && (
            <div>
              <label className="text-xs font-black text-text-dim uppercase tracking-[0.2em] block mb-2">Role Preset</label>
              <div className="flex gap-2">
                <select
                  value={members[0]?.role || ""}
                  onChange={(e) => onUpdateMember(members[0]?.id, "role", e.target.value)}
                  className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
                >
                  <option value="">Select role...</option>
                  {roleOptions.map(role => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                  {members[0]?.role === "Default" && <option value="Default">Default</option>}
                </select>
                {Object.values(archetypes).find(a => a.name === members[0]?.role) && (
                  <button
                    onClick={() => setEditingArchetypeId(Object.values(archetypes).find(a => a.name === members[0]?.role)?.id || null)}
                    className="px-3 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg text-xs font-bold text-text-muted hover:text-text transition-colors shrink-0"
                  >
                    Edit
                  </button>
                )}
              </div>
              {members[0]?.role && (Object.values(archetypes).find(a => a.name === members[0]?.role)?.systemPrompt || ROLE_PRESETS[members[0]?.role]) && (
                <div className="mt-2 p-3 bg-white/[0.02] border border-white/[0.06] rounded-lg text-xs text-text-muted">
                  {Object.values(archetypes).find(a => a.name === members[0]?.role)?.systemPrompt || ROLE_PRESETS[members[0]?.role]}
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

          {/* Members (only show for default summon to save space, or make collapsible) */}
          {summon === "default" && (
            <div className="pt-4 border-t border-white/10">
              <div className="flex items-center justify-between mb-4">
                <label className="text-xs font-black text-text-dim uppercase tracking-[0.2em]">Council Members</label>
                <button
                  onClick={onAddMember}
                  className="p-1 text-accent hover:bg-accent/10 rounded transition-colors"
                  title="Add Member"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                </button>
              </div>

              <div className="space-y-2">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center gap-2 bg-white/[0.02] p-2 rounded-lg border border-white/[0.05]">
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={member.name}
                        onChange={(e) => onUpdateMember(member.id, "name", e.target.value)}
                        className="w-full px-2 py-1 bg-transparent text-sm text-text font-medium focus:outline-none focus:bg-white/5 rounded"
                      />
                      <select
                        value={member.type}
                        onChange={(e) => onUpdateMember(member.id, "type", e.target.value as any)}
                        className="w-full px-2 py-1 bg-black/40 text-xs text-text-muted border border-white/5 rounded focus:outline-none"
                      >
                        <option value="openai">OpenAI (GPT)</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="google">Google (Gemini)</option>
                        <option value="openai-compat">Local/Custom API</option>
                      </select>
                      {member.type === "openai-compat" && (
                        <input
                          type="text"
                          value={member.baseUrl || ""}
                          onChange={(e) => onUpdateMember(member.id, "baseUrl", e.target.value)}
                          placeholder="Base URL (e.g. http://localhost:11434)"
                          className="w-full px-2 py-1 bg-black/40 text-xs text-text-muted border border-white/5 rounded focus:outline-none"
                        />
                      )}
                    </div>
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
          )}
        </div>
      </div>
      {editingArchetypeId && (
        <ArchetypeEditor
          archetype={editingArchetypeId === 'new' ? null : Object.values(archetypes).find((a: any) => a.id === editingArchetypeId) || null}
          onClose={() => setEditingArchetypeId(null)}
          onSave={(newArchetype) => {
            setArchetypes(prev => ({ ...prev, [newArchetype.id!]: newArchetype }));
            if (editingArchetypeId === 'new' && members.length > 0) {
              onUpdateMember(members[0].id, 'role', newArchetype.name);
            }
          }}
        />
      )}
    </>
  );
}
