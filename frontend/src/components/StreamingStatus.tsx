interface StreamingStatusProps {
  isLoading: boolean;
  isStreaming: boolean;
}

export function StreamingStatus({ isLoading, isStreaming }: StreamingStatusProps) {
  return (
    <>
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-accent/15 border-t-accent rounded-full animate-spin shadow-glow" />
            <span className="text-xs text-accent font-black uppercase tracking-[0.2em] animate-pulse">
              Syncing Neural Link...
            </span>
          </div>
        </div>
      )}

      {/* Streaming indicator in header */}
      {isStreaming && !isLoading && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/[0.03] border border-white/8 text-[9px] font-black uppercase tracking-[0.2em] text-text-dim shrink-0">
          <span className="status-dot bg-accent text-accent animate-pulse" />
          Live Bridge
        </div>
      )}
    </>
  );
}
