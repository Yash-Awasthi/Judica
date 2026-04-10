import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../types/index.js";

interface TabbedMessageProps {
  msg: ChatMessage;
  isStreaming: boolean;
  playingAudioId: string | null;
  onPlayTTS: (msgId: string, text: string) => void;
  getMemberColor: (name: string) => { bg: string; shadow: string };
  visibleKeyIds: Record<string, boolean>;
  setVisibleKeyIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  mdComponents: any;
}

type TabType = "council" | "debate" | "verdict" | "cost" | "config";

export function TabbedMessage({
  msg,
  isStreaming,
  playingAudioId,
  onPlayTTS,
  getMemberColor,
  visibleKeyIds,
  setVisibleKeyIds,
  mdComponents
}: TabbedMessageProps) {
  const [activeTab, setActiveTab] = useState<TabType>("council");

  const hasOpinions = (msg.opinions?.length ?? 0) > 0;
  const hasDebate = (msg.peerReviews?.length ?? 0) > 0;
  const hasVerdict = !!msg.verdict || (msg.scored?.length ?? 0) > 0;
  const hasCost = (msg.costs?.length ?? 0) > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-slide-up mb-12">
      {/* User question bubble */}
      <div className="flex justify-end mb-4">
        <div className="bg-[#1f1f1f] text-[#ececec] px-5 py-3.5 rounded-[24px] rounded-br-[4px] max-w-[85%] md:max-w-[70%] text-[15px] leading-[1.6] shadow-sm border border-white/[0.05]">
          {msg.question}
        </div>
      </div>

      {/* Tabs Header */}
      {hasOpinions && (
        <div className="flex items-center gap-1 border-b border-white/[0.05] mb-6 overflow-x-auto no-scrollbar pb-1">
          <button
            onClick={() => setActiveTab("council")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === "council" ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            Council
          </button>

          <button
            onClick={() => setActiveTab("debate")}
            disabled={!hasDebate}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              !hasDebate ? "opacity-50 cursor-not-allowed border-transparent text-text-muted" :
              activeTab === "debate" ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            Debate {hasDebate && <span className="ml-1 text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">{msg.peerReviews?.length}</span>}
          </button>

          <button
            onClick={() => setActiveTab("verdict")}
            disabled={!hasVerdict}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              !hasVerdict ? "opacity-50 cursor-not-allowed border-transparent text-text-muted" :
              activeTab === "verdict" ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            Verdict
          </button>

          <button
            onClick={() => setActiveTab("cost")}
            disabled={!hasCost}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              !hasCost ? "opacity-50 cursor-not-allowed border-transparent text-text-muted" :
              activeTab === "cost" ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            Cost & Audit
          </button>

          <button
            onClick={() => setActiveTab("config")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === "config" ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            Config
          </button>
        </div>
      )}

      {/* Tab Content */}
      <div className="tab-content">
        {/* COUNCIL TAB */}
        {activeTab === "council" && hasOpinions && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {msg.opinions?.map((op, i) => {
              const color = getMemberColor(op.name);
              const isActive = isStreaming && !msg.verdict && i === msg.opinions!.length - 1;
              return (
                <div
                  key={i}
                  className="animate-slide-up group flex flex-col h-full"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  {/* Member header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center border border-white/10 ${isActive ? 'animate-pulse' : ''}`}
                      style={{ backgroundColor: `${color.bg}20` }}
                    >
                      <span className="text-xs font-semibold" style={{ color: color.bg }}>
                        {op.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="font-medium text-[14px] text-text">
                        {op.name}
                      </span>
                      {op.archetype && (
                        <span className="text-[10px] uppercase tracking-wider text-text-muted bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                          {op.archetype}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => onPlayTTS(`${msg.id}-${op.name}`, op.opinion)}
                      className="p-1.5 text-text-dim hover:text-text hover:bg-white/5 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      title={playingAudioId === `${msg.id}-${op.name}` ? "Playing..." : "Play audio"}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {playingAudioId === `${msg.id}-${op.name}` ? "volume_up" : "play_circle"}
                      </span>
                    </button>
                  </div>

                  {/* Member response */}
                  <div className={`glass-panel p-4 rounded-xl border border-white/[0.04] flex-1 ${isActive ? 'streaming-cursor ring-1 ring-accent/30' : ''}`}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={mdComponents}
                    >
                      {op.opinion}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* DEBATE TAB */}
        {activeTab === "debate" && hasDebate && (
          <div className="space-y-4">
            {msg.peerReviews?.map((review, i) => {
              const color = getMemberColor(review.reviewer);
              const isVisible = visibleKeyIds[`${msg.id}-${review.reviewer}`];
              return (
                <div key={i} className="glass-panel p-4 rounded-xl border border-white/[0.04]">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="member-avatar"
                      style={{
                        backgroundColor: color.bg,
                        boxShadow: `0 0 12px -3px ${color.shadow}`
                      }}
                    >
                      <span className="text-[10px] font-black">{review.reviewer.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="text-xs font-black text-text-dim uppercase tracking-[0.2em]">
                      {review.reviewer} Critique
                    </div>
                    <button
                      onClick={() => setVisibleKeyIds(prev => ({ ...prev, [`${msg.id}-${review.reviewer}`]: !prev[`${msg.id}-${review.reviewer}`] }))}
                      className="p-1.5 text-text-dim hover:text-text hover:bg-white/5 rounded-lg transition-colors ml-auto"
                      title="Toggle details"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {isVisible ? "expand_less" : "expand_more"}
                      </span>
                    </button>
                  </div>

                  {isVisible && (
                    <div className="mt-4 pt-4 border-t border-white/[0.04]">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <span className="text-xs font-medium text-text-muted">Rankings:</span>
                          <ol className="list-decimal list-inside text-xs space-y-1 text-text-dim">
                            {review.ranking?.map((r, ri) => <li key={ri}>{r}</li>)}
                          </ol>
                        </div>
                        <div className="space-y-2">
                          <span className="text-xs font-medium text-text-muted">Critique:</span>
                          <p className="text-xs text-text-dim italic bg-white/[0.02] p-2 rounded-lg border border-white/[0.05]">
                            "{review.critique}"
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* VERDICT TAB */}
        {activeTab === "verdict" && hasVerdict && (
          <div className="space-y-6">
            {msg.verdict && (
              <div className="animate-slide-up">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-[#1f1f1f] border border-white/10 rounded-full flex items-center justify-center shadow-sm">
                    <span className="material-symbols-outlined text-[16px] text-accent">gavel</span>
                  </div>
                  <div className="text-[14px] font-medium text-text flex items-center">
                    Master Synthesis
                    {msg.cacheHit && (
                      <span className="ml-3 px-2 py-0.5 bg-green-500/10 text-green-400 rounded-md text-[10px] uppercase font-bold tracking-wider">
                        Cache Hit
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => msg.verdict && onPlayTTS(msg.id, msg.verdict)}
                    className="ml-auto p-1.5 text-text-dim hover:text-text hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {playingAudioId === msg.id ? "volume_up" : "play_circle"}
                    </span>
                  </button>
                </div>

                <div className={`glass-panel p-6 sm:p-8 rounded-2xl border border-accent/20 bg-accent/[0.02] shadow-[0_0_40px_-15px_rgba(94,234,212,0.1)] relative overflow-hidden ${isStreaming && msg.verdict && !msg.durationMs ? 'streaming-cursor' : ''}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={mdComponents}
                  >
                    {msg.verdict}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {msg.scored && msg.scored.length > 0 && (
              <div className="mt-8 space-y-4 animate-slide-up">
                <div className="text-xs font-black text-text-dim uppercase tracking-[0.2em] mb-3">
                  Final Scoring Breakdown
                </div>
                {msg.scored.map((scored, i) => {
                  const color = getMemberColor(scored.name);
                  return (
                    <div key={i} className="glass-panel p-4 rounded-xl border border-white/[0.04] bg-black/20">
                      <div className="flex items-center gap-3 mb-3">
                        <div
                          className="member-avatar"
                          style={{
                            backgroundColor: color.bg,
                            boxShadow: `0 0 12px -3px ${color.shadow}`
                          }}
                        >
                          <span className="text-[10px] font-black">{scored.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="text-xs font-black text-text uppercase tracking-[0.1em]">
                          {scored.name}
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-[10px] text-text-dim uppercase tracking-wider">Final Score</span>
                          <span className={`text-sm font-mono font-bold ${
                            scored.scores.final > 0.8 ? 'text-green-400' :
                            scored.scores.final > 0.6 ? 'text-amber-400' :
                            'text-red-400'
                          }`}>
                            {scored.scores.final.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-white/[0.02] p-3 rounded-lg">
                        <div>
                          <div className="text-text-dim mb-1">Confidence</div>
                          <div className="font-mono text-white/80">{scored.scores.confidence.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-text-dim mb-1">Agreement</div>
                          <div className="font-mono text-white/80">{scored.scores.agreement.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-text-dim mb-1">Peer Ranking</div>
                          <div className="font-mono text-white/80">{scored.scores.peerRanking.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* COST & AUDIT TAB */}
        {activeTab === "cost" && hasCost && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="glass-panel p-4 rounded-xl border border-white/[0.04]">
                <div className="text-xs font-medium text-text-dim uppercase mb-1">Total Cost</div>
                <div className="text-2xl font-mono text-accent">${msg.totalCostUsd?.toFixed(4) || "0.0000"}</div>
              </div>
              <div className="glass-panel p-4 rounded-xl border border-white/[0.04]">
                <div className="text-xs font-medium text-text-dim uppercase mb-1">Total Latency</div>
                <div className="text-2xl font-mono text-text">{(msg.durationMs ? msg.durationMs / 1000 : 0).toFixed(1)}s</div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs font-black text-text-dim uppercase tracking-[0.2em] mb-2">Model Breakdown</div>
              {msg.costs?.map((cost, i) => (
                <div key={i} className="glass-panel p-3 rounded-lg border border-white/[0.04] flex items-center justify-between text-sm">
                  <div className="font-medium text-white/80">{cost.model}</div>
                  <div className="flex items-center gap-6 text-xs font-mono">
                    <span className="text-text-dim">In: {cost.tokensIn}</span>
                    <span className="text-text-dim">Out: {cost.tokensOut}</span>
                    <span className="text-accent">${cost.costUsd?.toFixed(4) || "0.0000"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONFIG TAB */}
        {activeTab === "config" && (
          <div className="space-y-4">
            <div className="glass-panel p-5 rounded-xl border border-white/[0.04]">
              <div className="text-sm font-medium text-text mb-4">Council Configuration used for this deliberation</div>
              <div className="space-y-3">
                {msg.opinions?.map((op, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded bg-white/5 flex items-center justify-center text-xs border border-white/10">
                        {op.name.charAt(0)}
                      </div>
                      <span className="text-sm font-medium">{op.name}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-xs px-2 py-1 bg-white/5 rounded-md text-text-muted">{op.archetype || 'default'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
