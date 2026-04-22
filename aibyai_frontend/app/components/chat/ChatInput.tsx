import { useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { Button } from "~/components/ui/button";
import { Send, StopCircle, Lightbulb } from "lucide-react";
import { cn } from "~/lib/utils";

const SUGGESTED_PROMPTS = [
  "What are the pros and cons of microservices vs monoliths?",
  "Help me design a notification system for a mobile app",
  "Compare React, Vue, and Svelte for a large enterprise app",
  "What is the best approach to implement real-time collaboration?",
];

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  maxLength?: number;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  maxLength = 4000,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [value]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSubmit(trimmed);
  }, [value, isStreaming, onSubmit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleSuggestedPrompt = useCallback(
    (prompt: string) => {
      onChange(prompt);
      // Submit on next tick so the value is set
      setTimeout(() => onSubmit(prompt), 0);
    },
    [onChange, onSubmit]
  );

  const showSuggestions = !value.trim() && !isStreaming;

  return (
    <div className="space-y-3">
      {showSuggestions && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleSuggestedPrompt(prompt)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
            >
              <Lightbulb className="w-3 h-3" />
              <span className="truncate max-w-[250px]">{prompt}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the council a question..."
          maxLength={maxLength}
          rows={1}
          disabled={isStreaming}
          className={cn(
            "flex-1 resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-muted-foreground outline-none min-h-[36px] max-h-[200px] py-1.5 px-2",
            isStreaming && "opacity-50"
          )}
        />

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              "text-[10px] tabular-nums text-muted-foreground transition-colors",
              value.length > maxLength * 0.9 && "text-destructive"
            )}
          >
            {value.length}/{maxLength}
          </span>

          {isStreaming ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={onStop}
              className="h-8"
            >
              <StopCircle className="w-4 h-4 mr-1" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!value.trim()}
              className="h-8"
            >
              <Send className="w-4 h-4 mr-1" />
              Send
            </Button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        Press <kbd className="px-1 py-0.5 rounded border border-border bg-muted text-[10px]">Ctrl</kbd>+<kbd className="px-1 py-0.5 rounded border border-border bg-muted text-[10px]">Enter</kbd> to send
      </p>
    </div>
  );
}
