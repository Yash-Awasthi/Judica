import React, { useRef } from "react";

interface InputAreaProps {
  input: string;
  setInput: (value: string) => void;
  isStreaming: boolean;
  useStream: boolean;
  setUseStream: (value: boolean) => void;
  onSend: () => void;
  placeholder?: string;
}

export function InputArea({
  input, setInput, isStreaming, useStream, setUseStream, onSend, placeholder
}: InputAreaProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    onSend();
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

  return (
    <div className="p-4 pt-2 w-full max-w-3xl mx-auto">
      <div className="relative group">
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Ask the council anything..."}
          disabled={isStreaming}
          className="w-full px-5 py-4 pr-28 bg-[#0a0a0a] border border-white/[0.08] group-hover:border-white/[0.15] rounded-2xl text-[15px] leading-relaxed text-text placeholder-text-dim focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10 transition-all resize-none shadow-lg"
          rows={1}
          style={{ minHeight: "60px", maxHeight: "200px" }}
        />
        <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
          <button
            onClick={() => setUseStream(!useStream)}
            className={`p-2.5 rounded-xl transition-all ${
              useStream
                ? "text-accent bg-accent/5 hover:bg-accent/10"
                : "text-text-muted hover:text-text hover:bg-white/[0.06]"
            }`}
            title={useStream ? "Streaming enabled" : "Streaming disabled"}
          >
            <span className="material-symbols-outlined text-[18px]">
              {useStream ? "waves" : "bolt"}
            </span>
          </button>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className={`flex items-center justify-center p-2.5 rounded-xl transition-all duration-300 ${
              isStreaming || !input.trim()
                ? "bg-white/[0.04] text-white/30 cursor-not-allowed"
                : "bg-accent text-[#000000] hover:bg-accent/90 hover:scale-105 shadow-glow-sm"
            }`}
          >
            {isStreaming ? (
              <div className="w-[18px] h-[18px] border-[2px] border-white/20 border-t-white/80 rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined text-[20px] font-medium leading-none">
                arrow_upward
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
