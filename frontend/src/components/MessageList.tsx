import * as React from 'react';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import type { Easing } from "framer-motion";
import { Volume2, Pause, Eye, EyeOff, Gavel, Timer, DollarSign } from "lucide-react";
import type { ChatMessage } from "../types/index.js";

interface MessageListProps {
  messages: ChatMessage[];
  playingAudioId: string | null;
  onPlayTTS: (msgId: string, text: string) => void;
  getMemberColor: (name: string) => { bg: string; shadow: string };
  visibleKeyIds: Record<string, boolean>;
  setVisibleKeyIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSuggestionClick?: (suggestion: string) => void;
}

const mdComponents = {
   
  code: ({ className, children, ...props }: any) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="bg-[var(--code-bg)] border border-[var(--code-border)] rounded-xl p-4 overflow-x-auto my-3 text-xs font-mono leading-relaxed scrollbar-custom">
            <code className={className} {...props}>{children}</code>
          </pre>
      );
    }
    return (
      <code className="bg-[var(--code-bg)] border border-[var(--code-border)] rounded px-1.5 py-0.5 text-[var(--accent-mint)] text-[0.85em] font-mono" {...props}>
        {children}
      </code>
    );
  },
   
  p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
   
  ul: ({ children }: any) => <ul className="list-disc list-inside mb-3 space-y-1 text-[var(--text-secondary)]">{children}</ul>,
   
  ol: ({ children }: any) => <ol className="list-decimal list-inside mb-3 space-y-1 text-[var(--text-secondary)]">{children}</ol>,
   
  li: ({ children }: any) => <li className="text-sm leading-relaxed">{children}</li>,
   
  strong: ({ children }: any) => <strong className="font-bold text-[var(--text-primary)]">{children}</strong>,
   
  blockquote: ({ children }: any) => (
    <blockquote className="pl-4 border-l-2 border-[var(--accent-mint)]/30 text-[var(--text-secondary)] my-3 italic">{children}</blockquote>
  ),
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.35, ease: "easeOut" as Easing }
  }),
};

export function MessageList({
  messages,
  playingAudioId,
  onPlayTTS,
  getMemberColor,
  visibleKeyIds,
  setVisibleKeyIds,
  onSuggestionClick
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4 pt-20">
        <div className="w-20 h-20 rounded-2xl bg-[var(--glass-bg)] border border-[var(--glass-border)] flex items-center justify-center mb-6">
          <Gavel size={32} className="text-[var(--accent-mint)] opacity-60" />
        </div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-3 tracking-tight">
          Ask the Council
        </h2>
        <p className="text-sm text-[var(--text-muted)] max-w-md leading-relaxed mb-8">
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
              onClick={() => onSuggestionClick?.(suggestion)}
              className="px-4 py-2 rounded-pill bg-[var(--glass-bg)] border border-[var(--glass-border)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-mint)]/30 hover:bg-[var(--glass-bg-hover)] transition-all duration-200"
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
        <motion.div
          key={msg.id || idx}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="max-w-3xl mx-auto space-y-6"
        >
          {/* User question bubble */}
          <div className="flex justify-end">
            <div className="bg-[var(--accent-mint)] text-black px-5 py-3.5 rounded-[20px] rounded-br-[4px] max-w-[85%] md:max-w-[70%] text-[15px] leading-[1.6] shadow-glow-sm font-medium">
              {msg.question}
            </div>
          </div>

          {/* Opinions */}
          {(msg.opinions?.length ?? 0) > 0 && (
            <div className="space-y-6 mt-6" aria-live="polite" aria-atomic="false">
              {msg.opinions?.map((op, i) => {
                const color = getMemberColor(op.name);
                return (
                  <motion.div
                    key={i}
                    custom={i}
                    variants={staggerItem}
                    initial="hidden"
                    animate="visible"
                    className="group"
                  >
                    {/* Member header */}
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center border border-[var(--glass-border)]"
                        style={{ backgroundColor: `${color.bg}20`, boxShadow: `0 0 10px -4px ${color.shadow}` }}
                      >
                        <span className="text-xs font-bold" style={{ color: color.bg }}>
                          {op.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="font-medium text-[14px] text-[var(--text-primary)]">
                          {op.name}
                        </span>
                        {op.archetype && (
                          <span className="px-2 py-0.5 text-[9px] uppercase tracking-wider font-semibold rounded-pill bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-muted)]">
                            {op.archetype}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => onPlayTTS(`${msg.id}-${op.name}`, op.opinion)}
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Play TTS"
                      >
                        {playingAudioId === `${msg.id}-${op.name}` ? <Pause size={14} /> : <Volume2 size={14} />}
                      </button>
                    </div>

                    {/* Opinion content */}
                    <div className={`glass-panel p-4 text-sm text-[var(--text-secondary)] leading-relaxed ${i === (msg.opinions?.length ?? 0) - 1 && !msg.verdict ? 'streaming-cursor' : ''}`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={mdComponents}
                      >
                        {op.opinion}
                      </ReactMarkdown>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Verdict */}
          {msg.verdict && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="mt-8"
              aria-live="polite"
              aria-label="Council verdict"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--accent-mint)] to-emerald-500 flex items-center justify-center shadow-glow-sm">
                  <Gavel size={14} className="text-black" />
                </div>
                <div className="text-[14px] font-semibold text-[var(--text-primary)] flex items-center">
                  Final Response
                  {msg.cacheHit && (
                    <span className="ml-3 px-2 py-0.5 bg-[rgba(110,231,183,0.1)] text-[var(--accent-mint)] rounded-pill text-[10px] uppercase font-bold tracking-wider">
                      Cache Hit
                    </span>
                  )}
                </div>
                <button
                  onClick={() => msg.verdict && onPlayTTS(msg.id, msg.verdict)}
                  className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] rounded-lg transition-colors ml-auto"
                  title="Play TTS"
                >
                  {playingAudioId === msg.id ? <Pause size={14} /> : <Volume2 size={14} />}
                </button>
              </div>

              <div className="verdict-box p-5">
                <div className="text-[15px] leading-[1.7] text-[var(--text-primary)]">
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
                <div className="flex flex-wrap gap-2 mt-4">
                  {msg.costs.map((cost, i) => (
                    <div
                      key={i}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-pill text-[11px] font-mono text-[var(--text-muted)]"
                      title={`Tokens: ${cost.tokensIn}→${cost.tokensOut} • Latency: ${cost.latencyMs}ms`}
                    >
                      <DollarSign size={10} />
                      {cost.model}: ${cost.costUsd.toFixed(4)}
                    </div>
                  ))}
                  {msg.totalCostUsd && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[rgba(110,231,183,0.08)] border border-[rgba(110,231,183,0.15)] rounded-pill text-[11px] font-mono text-[var(--accent-mint)] font-semibold">
                      Total: ${msg.totalCostUsd.toFixed(4)}
                    </div>
                  )}
                </div>
              )}

              {/* Duration */}
              {msg.durationMs && (
                <div className="mt-2 text-[12px] text-[var(--text-muted)] flex items-center gap-1.5">
                  <Timer size={12} />
                  Completed in {(msg.durationMs / 1000).toFixed(1)}s
                </div>
              )}
            </motion.div>
          )}

          {/* Peer reviews */}
          {msg.peerReviews && msg.peerReviews.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="space-y-4"
            >
              <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] mb-3">
                Peer Reviews
              </div>
              {msg.peerReviews.map((review, i) => {
                const color = getMemberColor(review.reviewer);
                return (
                  <div key={i} className="glass-panel p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="member-avatar"
                        style={{
                          backgroundColor: color.bg,
                          boxShadow: `0 0 12px -3px ${color.shadow}`
                        }}
                      >
                        <span className="text-[10px] font-bold">{review.reviewer.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-[0.15em]">
                        {review.reviewer} Review
                      </div>
                      <button
                        onClick={() => setVisibleKeyIds(prev => ({ ...prev, [`${msg.id}-${review.reviewer}`]: !prev[`${msg.id}-${review.reviewer}`] }))}
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] rounded-lg transition-colors ml-auto"
                        title="Toggle details"
                      >
                        {visibleKeyIds[`${msg.id}-${review.reviewer}`] ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                    </div>

                    <AnimatePresence>
                      {visibleKeyIds[`${msg.id}-${review.reviewer}`] && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="space-y-3 overflow-hidden"
                        >
                          <div>
                            <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] mb-1">
                              Ranking
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {review.ranking.map((ranked, j) => (
                                <span key={j} className="px-2 py-1 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-button text-[10px] text-[var(--text-muted)]">
                                  {j + 1}. {ranked}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] mb-1">
                              Critique
                            </div>
                            <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={mdComponents}
                              >
                                {review.critique}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </motion.div>
          )}

          {/* Scored opinions */}
          {msg.scored && msg.scored.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="space-y-4"
            >
              <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] mb-3">
                Final Scoring
              </div>
              {msg.scored.map((scored, i) => {
                const color = getMemberColor(scored.name);
                return (
                  <div key={i} className="glass-panel p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="member-avatar"
                        style={{
                          backgroundColor: color.bg,
                          boxShadow: `0 0 12px -3px ${color.shadow}`
                        }}
                      >
                        <span className="text-[10px] font-bold">{scored.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-[0.15em]">
                        {scored.name}
                      </div>
                      <div className="ml-auto text-sm font-mono text-[var(--accent-mint)] font-bold">
                        {scored.scores.final.toFixed(2)}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="text-[var(--text-muted)]">Confidence</div>
                      <div className="font-mono text-[var(--text-secondary)]">{scored.scores.confidence.toFixed(2)}</div>
                      <div className="text-[var(--text-muted)]">Agreement</div>
                      <div className="font-mono text-[var(--text-secondary)]">{scored.scores.agreement.toFixed(2)}</div>
                      <div className="text-[var(--text-muted)]">Peer Rank</div>
                      <div className="font-mono text-[var(--text-secondary)]">#{scored.scores.peerRanking}</div>
                      <div className="text-[var(--text-muted)]">Final</div>
                      <div className="font-mono text-[var(--accent-mint)] font-bold">{scored.scores.final.toFixed(2)}</div>
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}
        </motion.div>
      ))}
    </div>
  );
}
