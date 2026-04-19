import { useRef, useEffect } from "react";
import { Send, Zap, ZapOff, Paperclip, X, FileText, Music } from "lucide-react";

export interface AttachedFile {
  id: string;
  name: string;
  mimeType: string;
  previewUrl?: string; // object URL for images
}

interface InputAreaProps {
  input: string;
  setInput: (val: string) => void;
  useStream: boolean;
  setUseStream: (val: boolean) => void;
  isStreaming: boolean;
  onSend: () => void;
  placeholder?: string;
  attachedFiles?: AttachedFile[];
  onAttach?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;
}

const ACCEPT = "image/*,audio/*,application/pdf,text/plain,text/csv,text/markdown";

function AttachmentChip({
  file,
  onRemove,
}: {
  file: AttachedFile;
  onRemove: () => void;
}) {
  const isImage = file.mimeType.startsWith("image/");
  const isAudio = file.mimeType.startsWith("audio/");

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-xs text-[var(--text-secondary)] max-w-[160px]">
      {isImage && file.previewUrl ? (
        <img
          src={file.previewUrl}
          alt=""
          aria-hidden="true"
          className="w-5 h-5 rounded object-cover shrink-0"
        />
      ) : isAudio ? (
        <Music size={13} className="shrink-0 text-[var(--accent-blue)]" aria-hidden="true" />
      ) : (
        <FileText size={13} className="shrink-0 text-[var(--accent-mint)]" aria-hidden="true" />
      )}
      <span className="truncate">{file.name}</span>
      <button
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        <X size={11} />
      </button>
    </div>
  );
}

export function InputArea({
  input,
  setInput,
  useStream,
  setUseStream,
  isStreaming,
  onSend,
  placeholder,
  attachedFiles = [],
  onAttach,
  onRemoveAttachment,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0 && onAttach) {
      onAttach(e.dataTransfer.files);
    }
  };

  const canSend = (input.trim() || attachedFiles.length > 0) && !isStreaming;

  return (
    <div
      className="w-full max-w-3xl mx-auto px-4"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Attachment chips */}
      {attachedFiles.length > 0 && (
        <div
          className="flex flex-wrap gap-2 mb-2 px-2"
          role="list"
          aria-label="Attached files"
        >
          {attachedFiles.map((f) => (
            <div key={f.id} role="listitem">
              <AttachmentChip
                file={f}
                onRemove={() => onRemoveAttachment?.(f.id)}
              />
            </div>
          ))}
        </div>
      )}

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

        {/* Attachment button */}
        {onAttach && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach file"
              className="shrink-0 p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--accent-mint)] hover:bg-[rgba(110,231,183,0.08)] transition-all duration-200"
              title="Attach image, audio, or document"
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              aria-hidden="true"
              className="hidden"
              onChange={(e) => e.target.files && onAttach(e.target.files)}
            />
          </>
        )}

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
          disabled={!canSend}
          aria-label="Send message"
          className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${
            canSend
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
          <kbd className="px-1 py-0.5 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded text-[9px] font-mono">Enter</kbd> to send •{" "}
          <kbd className="px-1 py-0.5 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded text-[9px] font-mono">Shift+Enter</kbd> new line
          {onAttach && (
            <> • drag &amp; drop files to attach</>
          )}
        </p>
        <p className="text-[10px] text-[var(--text-muted)]">
          {useStream ? "⚡ Streaming" : "Batch mode"}
        </p>
      </div>
    </div>
  );
}
