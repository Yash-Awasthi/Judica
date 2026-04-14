import { useRef, useEffect } from "react";
import { Send, Zap, ZapOff } from "lucide-react";

interface InputAreaProps {
  input: string;
  setInput: (val: string) => void;
  useStream: boolean;
  setUseStream: (val: boolean) => void;
  isStreaming: boolean;
  onSend: () => void;
  placeholder?: string;
}

export function InputArea({
  input,
  setInput,
  useStream,
  setUseStream,
  isStreaming,
  onSend,
  placeholder,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, [input]);

  return (
    <div className="w-full max-w-3xl mx-auto px-4">
      <div className="relative surface-card rounded-2xl p-2 flex items-end gap-2 transition-all focus-within:shadow-glow-sm">
        {/* Stream toggle */}
        <button
          onClick={() => setUseStream(!useStream)}
          aria-label={useStream ? "Disable streaming" : "Enable streaming"}
          className={`shrink-0 p-2 rounded-xl transition-all duration-200 ${
            useStream
              ? "text-[var(--accent-mint)] bg-[rgba(110,231,183,0.08)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)]"
          }`}
          title={useStream ? "Streaming enabled" : "Streaming disabled"}
        >
          {useStream ? <Zap size={16} /> : <ZapOff size={16} />}
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Chat message input"
          aria-keyshortcuts="Enter"
          rows={1}
          className="flex-1 bg-transparent text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] outline-none resize-none max-h-40 py-2 leading-relaxed"
        />

        {/* Send button */}
        <button
          onClick={onSend}
          disabled={!input.trim() || isStreaming}
          aria-label="Send message"
          className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${
            input.trim() && !isStreaming
              ? "bg-[var(--accent-mint)] text-black shadow-glow-sm hover:shadow-glow"
              : "bg-[var(--glass-bg)] text-[var(--text-muted)]"
          } disabled:opacity-40`}
        >
          {isStreaming ? (
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send size={15} />
          )}
        </button>
      </div>

      {/* Bottom hint */}
      <div className="flex items-center justify-between px-2 mt-2">
        <p className="text-[10px] text-[var(--text-muted)]">
          <kbd className="px-1 py-0.5 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded text-[9px] font-mono">Enter</kbd> to send • <kbd className="px-1 py-0.5 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded text-[9px] font-mono">Shift+Enter</kbd> new line
        </p>
        <p className="text-[10px] text-[var(--text-muted)]">
          {useStream ? "⚡ Streaming" : "Batch mode"}
        </p>
      </div>
    </div>
  );
}
