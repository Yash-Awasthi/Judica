interface StreamingStatusProps {
  isLoading: boolean;
  isStreaming: boolean;
}

export function StreamingStatus({ isLoading, isStreaming }: StreamingStatusProps) {
  return (
    <>
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--bg)]/80 backdrop-blur-sm" role="status" aria-live="assertive">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-[rgba(110,231,183,0.15)] border-t-[var(--accent-mint)] rounded-full animate-spin shadow-glow-sm" aria-hidden="true" />
            <span className="text-xs text-[var(--accent-mint)] font-bold uppercase tracking-[0.2em] animate-pulse">
              Syncing Neural Link...
            </span>
          </div>
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && !isLoading && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-pill bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)] shrink-0" role="status" aria-live="polite">
          <span
            className="w-1.5 h-1.5 rounded-full bg-[var(--accent-mint)] animate-pulse"
            style={{ boxShadow: '0 0 6px var(--accent-mint)' }}
            aria-hidden="true"
          />
          Live
        </div>
      )}
    </>
  );
}
