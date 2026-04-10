import React from "react";
import type { ChatMessage } from "../types/index.js";
import { TabbedMessage } from "./TabbedMessage.js";

interface MessageListProps {
  messages: ChatMessage[];
  playingAudioId: string | null;
  onPlayTTS: (msgId: string, text: string) => void;
  getMemberColor: (name: string) => { bg: string; shadow: string };
  visibleKeyIds: Record<string, boolean>;
  setVisibleKeyIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  isStreaming?: boolean;
  onSuggestionClick?: (text: string) => void;
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
  setVisibleKeyIds,
  isStreaming = false,
  onSuggestionClick
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
              onClick={() => onSuggestionClick && onSuggestionClick(suggestion)}
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
        <TabbedMessage
          key={msg.id || idx}
          msg={msg}
          isStreaming={isStreaming && idx === messages.length - 1}
          playingAudioId={playingAudioId}
          onPlayTTS={onPlayTTS}
          getMemberColor={getMemberColor}
          visibleKeyIds={visibleKeyIds}
          setVisibleKeyIds={setVisibleKeyIds}
          mdComponents={mdComponents}
        />
      ))}
    </div>
  );
}
