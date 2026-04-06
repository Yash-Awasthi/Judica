import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../types/index.js";

interface MessageListProps {
  messages: ChatMessage[];
  playingAudioId: string | null;
  onPlayTTS: (msgId: string, text: string) => void;
  getMemberColor: (name: string) => { bg: string; shadow: string };
  visibleKeyIds: Record<string, boolean>;
  setVisibleKeyIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

const mdComponents = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code: ({ className, children, ...props }: any) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="bg-white/[0.04] border border-white/8 rounded-xl p-4 overflow-x-auto my-3 text-xs font-mono leading-relaxed scrollbar-custom">
            <code className={className} {...props}>{children}</code>
          </pre>
      );
    }
    return (
      <code className="bg-white/[0.06] border border-white/8 rounded px-1.5 py-0.5 text-accent/80 text-[0.85em] font-mono" {...props}>
        {children}
      </code>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ul: ({ children }: any) => <ul className="list-disc list-inside mb-3 space-y-1 text-text-muted">{children}</ul>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ol: ({ children }: any) => <ol className="list-decimal list-inside mb-3 space-y-1 text-text-muted">{children}</ol>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  li: ({ children }: any) => <li className="text-sm leading-relaxed">{children}</li>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strong: ({ children }: any) => <strong className="font-bold text-text">{children}</strong>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blockquote: ({ children }: any) => (
    <blockquote className="pl-4 border-l-2 border-accent/30 text-text-muted my-3 italic">{children}</blockquote>
  ),
};

export function MessageList({
  messages,
  playingAudioId,
  onPlayTTS,
  getMemberColor,
  visibleKeyIds,
  setVisibleKeyIds
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4 pt-20">
        <div className="w-20 h-20 bg-white/[0.02] border border-white/[0.05] rounded-2xl flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-[32px] text-accent/60">forum</span>
        </div>
        <h2 className="text-2xl font-semibold text-white/90 mb-3 tracking-tight">
          Ask the Council
        </h2>
        <p className="text-sm text-white/30 max-w-md leading-relaxed mb-8">
          Multiple AI agents will deliberate, debate, and reach mathematical consensus
          on your question.
        </p>
        <div className="flex flex-wrap justify-center gap-2 max-w-lg">
          {[
            "What are the trade-offs of microservices vs monoliths?",
            "Should startups prioritize speed or code quality?",
            "Analyze the future of open-source AI models",
          ].map((suggestion) => (
            <button
              key={suggestion}
              className="px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-white/40 hover:text-white/70 hover:border-white/[0.12] hover:bg-white/[0.05] transition-all duration-200"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {messages.map((msg, idx) => (
        <div key={msg.id || idx} className="max-w-3xl mx-auto space-y-6 animate-slide-up">

          {/* User question bubble */}
          <div className="flex justify-end">
            <div className="bg-[#1f1f1f] text-[#ececec] px-5 py-3.5 rounded-[24px] rounded-br-[4px] max-w-[85%] md:max-w-[70%] text-[15px] leading-[1.6] shadow-sm border border-white/[0.05]">
              {msg.question}
            </div>
          </div>

          {/* Opinions */}
          {(msg.opinions?.length ?? 0) > 0 && (
            <div className="space-y-8 mt-6">
              {msg.opinions?.map((op, i) => {
                const color = getMemberColor(op.name);
                return (
                  <div
                    key={i}
                    className="animate-slide-up group"
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    {/* Member header */}
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center border border-white/10"
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
                          <span className="text-[10px] uppercase tracking-wider text-text-muted">
                            • {op.archetype}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => onPlayTTS(`${msg.id}-${op.name}`, op.opinion)}
                        className="p-1.5 text-text-dim hover:text-text hover:bg-white/5 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Play TTS"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {playingAudioId === `${msg.id}-${op.name}` ? "pause" : "play_arrow"}
                        </span>
                      </button>
                    </div>

                    {/* Opinion content */}
                    <div className={`glass-panel p-4 rounded-xl border border-white/[0.04] ${i === msg.opinions.length - 1 && !msg.verdict ? 'streaming-cursor' : ''}`}>
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

          {/* Verdict */}
          {msg.verdict && (
            <div className="animate-slide-up mt-8" style={{ animationDelay: "300ms" }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-[#1f1f1f] border border-white/10 rounded-full flex items-center justify-center shadow-sm">
                  <span className="material-symbols-outlined text-[16px] text-accent">gavel</span>
                </div>
                <div className="text-[14px] font-medium text-text flex items-center">
                  Final Response
                  {msg.cacheHit && (
                    <span className="ml-3 px-2 py-0.5 bg-green-500/10 text-green-400 rounded-md text-[10px] uppercase font-bold tracking-wider">
                      Cache Hit
                    </span>
                  )}
                </div>
                <button
                  onClick={() => msg.verdict && onPlayTTS(msg.id, msg.verdict)}
                  className="p-1.5 text-text-muted hover:text-text hover:bg-white/5 rounded-lg transition-colors ml-auto"
                  title="Play TTS"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {playingAudioId === msg.id ? "pause" : "play_arrow"}
                  </span>
                </button>
              </div>

              <div className="pl-11 pr-4">
                <div className="text-[15px] leading-[1.7] text-text whitespace-pre-wrap">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={mdComponents}
                  >
                    {msg.verdict}
                  </ReactMarkdown>
                </div>
              </div>

              {/* Cost breakdown */}
              {msg.costs && msg.costs.length > 0 && (
                <div className="pl-11 mt-4 flex flex-wrap gap-2">
                  {msg.costs.map((cost, i) => (
                    <div
                      key={i}
                      className="px-2.5 py-1 bg-[#1f1f1f] border border-white/5 rounded-md text-[11px] font-mono text-text-muted"
                      title={`Tokens: ${cost.tokensIn}→${cost.tokensOut} • Latency: ${cost.latencyMs}ms`}
                    >
                      {cost.model}: ${cost.costUsd.toFixed(4)}
                    </div>
                  ))}
                  {msg.totalCostUsd && (
                    <div className="px-2.5 py-1 bg-accent/10 border border-accent/10 rounded-md text-[11px] font-mono text-accent font-medium">
                      Total: ${msg.totalCostUsd.toFixed(4)}
                    </div>
                  )}
                </div>
              )}

              {/* Duration */}
              {msg.durationMs && (
                <div className="pl-11 mt-2 text-[12px] text-text-dim flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">timer</span>
                  Completed in {(msg.durationMs / 1000).toFixed(1)}s
                </div>
              )}
            </div>
          )}

          {/* Peer reviews */}
          {msg.peerReviews && msg.peerReviews.length > 0 && (
            <div className="space-y-4 animate-slide-up" style={{ animationDelay: "400ms" }}>
              <div className="text-xs font-black text-text-dim uppercase tracking-[0.2em] mb-3">
                Peer Reviews
              </div>
              {msg.peerReviews.map((review, i) => {
                const color = getMemberColor(review.reviewer);
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
                        {review.reviewer} Review
                      </div>
                      <button
                        onClick={() => setVisibleKeyIds(prev => ({ ...prev, [`${msg.id}-${review.reviewer}`]: !prev[`${msg.id}-${review.reviewer}`] }))}
                        className="p-1.5 text-text-dim hover:text-text hover:bg-white/5 rounded-lg transition-colors ml-auto"
                        title="Toggle details"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {visibleKeyIds[`${msg.id}-${review.reviewer}`] ? "visibility" : "visibility_off"}
                        </span>
                      </button>
                    </div>

                    <div className="space-y-3">
                      {visibleKeyIds[`${msg.id}-${review.reviewer}`] && (
                        <>
                          <div>
                            <div className="text-xs font-black text-text-dim uppercase tracking-[0.2em] mb-1">
                              Ranking
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {review.ranking.map((ranked, j) => (
                                <span key={j} className="px-2 py-1 bg-white/[0.03] border border-white/[0.08] rounded-lg text-[10px] text-text-dim">
                                  {j + 1}. {ranked}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-black text-text-dim uppercase tracking-[0.2em] mb-1">
                              Critique
                            </div>
                            <div className="text-sm leading-relaxed text-text-muted">
                              <ReactMarkdown 
                                remarkPlugins={[remarkGfm]}
                                components={mdComponents}
                              >
                                {review.critique}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Scored opinions */}
          {msg.scored && msg.scored.length > 0 && (
            <div className="space-y-4 animate-slide-up" style={{ animationDelay: "500ms" }}>
              <div className="text-xs font-black text-text-dim uppercase tracking-[0.2em] mb-3">
                Final Scoring
              </div>
              {msg.scored.map((scored, i) => {
                const color = getMemberColor(scored.name);
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
                        <span className="text-[10px] font-black">{scored.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="text-xs font-black text-text-dim uppercase tracking-[0.2em]">
                        {scored.name} Score
                      </div>
                      <div className="ml-auto text-xs font-mono text-accent">
                        {scored.scores.final.toFixed(2)}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="text-text-dim">Confidence</div>
                      <div className="font-mono">{scored.scores.confidence.toFixed(2)}</div>
                      <div className="text-text-dim">Agreement</div>
                      <div className="font-mono">{scored.scores.agreement.toFixed(2)}</div>
                      <div className="text-text-dim">Peer Rank</div>
                      <div className="font-mono">#{scored.scores.peerRanking}</div>
                      <div className="text-text-dim">Final</div>
                      <div className="font-mono text-accent font-bold">{scored.scores.final.toFixed(2)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
