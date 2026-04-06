import React, { useRef } from "react";

interface InputAreaProps {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  summon: string;
  setSummon: React.Dispatch<React.SetStateAction<string>>;
  rounds: number;
  setRounds: React.Dispatch<React.SetStateAction<number>>;
  useStream: boolean;
  setUseStream: React.Dispatch<React.SetStateAction<boolean>>;
  isStreaming: boolean;
  onSendMessage: () => void;
  defaultSummon?: string;
  members: any[];
  onUpdateMembers: (members: any[]) => void;
  showMemberConfig: boolean;
  setShowMemberConfig: React.Dispatch<React.SetStateAction<boolean>>;
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

export function InputArea({
  input,
  setInput,
  summon,
  setSummon,
  rounds,
  setRounds,
  useStream,
  setUseStream,
  isStreaming,
  onSendMessage,
  members,
  onUpdateMembers,
  showMemberConfig,
  setShowMemberConfig
}: InputAreaProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    onSendMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 130) + "px";
  };

  const addMember = () => {
    const newMember = {
      name: `Member ${members.length + 1}`,
      type: "openai-compat",
      apiKey: "",
      model: "gpt-4o"
    };
    onUpdateMembers([...members, newMember]);
  };

  const removeMember = (index: number) => {
    onUpdateMembers(members.filter((_, i) => i !== index));
  };

  const updateMember = (index: number, field: string, value: string) => {
    const updated = [...members];
    updated[index] = { ...updated[index], [field]: value };
    onUpdateMembers(updated);
  };

  return (
    <div className="fixed bottom-0 right-0 left-0 md:left-[var(--sidebar-w,16rem)] bg-black/95 backdrop-blur-xl border-t border-white/[0.04] z-30">
      
      {/* Member config panel */}
      {showMemberConfig && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMemberConfig(false)} />
          <div className="absolute bottom-full right-4 mb-4 w-96 glass-panel rounded-xl shadow-2xl z-50 p-6 border border-white/8 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-black text-text-dim uppercase tracking-[0.2em]">Council Configuration</div>
              <button
                onClick={() => setShowMemberConfig(false)}
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
                  onChange={(e) => setSummon(e.target.value)}
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
                    onChange={(e) => updateMember(0, "role", e.target.value)}
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
                    onChange={(e) => updateMember(0, "tone", e.target.value)}
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
                  onChange={(e) => setRounds(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
                  className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>

              {/* Members */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-black text-text-dim uppercase tracking-[0.2em">Council Members</label>
                  <button
                    onClick={addMember}
                    className="px-2 py-1 bg-accent/10 border border-accent/20 rounded-lg text-[10px] text-accent hover:bg-accent/20 transition-colors"
                  >
                    Add Member
                  </button>
                </div>
                <div className="space-y-2">
                  {members.map((member, index) => (
                    <div key={index} className="flex items-center gap-2 p-3 bg-white/[0.02] border border-white/[0.06] rounded-lg">
                      <input
                        type="text"
                        placeholder="Name"
                        value={member.name || ""}
                        onChange={(e) => updateMember(index, "name", e.target.value)}
                        className="flex-1 px-2 py-1 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
                      />
                      <select
                        value={member.type || ""}
                        onChange={(e) => updateMember(index, "type", e.target.value)}
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
                        onChange={(e) => updateMember(index, "apiKey", e.target.value)}
                        className="flex-1 px-2 py-1 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
                      />
                      <input
                        type="text"
                        placeholder="Model"
                        value={member.model || ""}
                        onChange={(e) => updateMember(index, "model", e.target.value)}
                        className="flex-1 px-2 py-1 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-text focus:outline-none focus:border-accent/50 transition-colors"
                      />
                      {members.length > 1 && (
                        <button
                          onClick={() => removeMember(index)}
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
      )}

      {/* Input controls */}
      <div className="flex items-end gap-3 p-4">
        <div className="flex-1 min-w-0">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask the council anything..."
            disabled={isStreaming}
            className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.08] rounded-xl text-sm leading-relaxed text-text placeholder-text-dim focus:outline-none focus:border-accent/50 transition-colors resize-none"
            rows={1}
            style={{ maxHeight: "130px" }}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Stream toggle */}
          <button
            onClick={() => setUseStream(!useStream)}
            className={`p-3 rounded-xl transition-all border ${
              useStream
                ? "bg-accent/10 border-accent/20 text-accent"
                : "border-white/[0.06] text-text-muted hover:border-white/10 hover:text-text"
            }`}
            title={useStream ? "Streaming enabled" : "Streaming disabled"}
          >
            <span className="material-symbols-outlined text-[18px]">
              {useStream ? "waves" : "bolt"}
            </span>
          </button>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="px-4 py-3 bg-accent text-white rounded-xl font-medium text-sm hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-glow"
          >
            {isStreaming ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Thinking</span>
              </div>
            ) : (
              <span>Send</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
