import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: { section: string; items: Shortcut[] }[] = [
  {
    section: "Navigation",
    items: [
      { keys: ["?"], description: "Toggle this help panel" },
      { keys: ["Ctrl", "K"], description: "Open command palette" },
      { keys: ["Ctrl", "B"], description: "Toggle sidebar" },
      { keys: ["Ctrl", "Shift", "N"], description: "New conversation" },
    ],
  },
  {
    section: "Chat",
    items: [
      { keys: ["Enter"], description: "Send message" },
      { keys: ["Shift", "Enter"], description: "New line in message" },
      { keys: ["Ctrl", "↑"], description: "Edit last message" },
      { keys: ["Esc"], description: "Cancel / close" },
    ],
  },
  {
    section: "Deliberation",
    items: [
      { keys: ["Ctrl", "D"], description: "Start debate council" },
      { keys: ["Ctrl", "R"], description: "Retry last deliberation" },
    ],
  },
];

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsPanel({ open, onClose }: KeyboardShortcutsPanelProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="kbd-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[9000] bg-black/50 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            key="kbd-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-0 z-[9001] flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="glass-panel pointer-events-auto w-full max-w-lg p-6 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Keyboard Shortcuts
                </h2>
                <button
                  onClick={onClose}
                  aria-label="Close keyboard shortcuts"
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] transition-colors"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              {/* Shortcut groups */}
              <div className="space-y-4">
                {SHORTCUTS.map(({ section, items }) => (
                  <div key={section}>
                    <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      {section}
                    </p>
                    <ul className="space-y-1.5" role="list">
                      {items.map(({ keys, description }) => (
                        <li
                          key={description}
                          className="flex items-center justify-between gap-4"
                        >
                          <span className="text-sm text-[var(--text-secondary)]">
                            {description}
                          </span>
                          <span className="flex items-center gap-1 shrink-0">
                            {keys.map((k, i) => (
                              <kbd
                                key={i}
                                className="inline-flex items-center justify-center min-w-[1.75rem] px-1.5 h-6 text-xs font-mono rounded border border-[var(--border-medium)] bg-[var(--bg-surface-2)] text-[var(--text-secondary)]"
                              >
                                {k}
                              </kbd>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <p className="text-xs text-[var(--text-muted)]">
                Press <kbd className="inline-flex items-center justify-center px-1 h-5 text-xs font-mono rounded border border-[var(--border-medium)] bg-[var(--bg-surface-2)]">?</kbd> or <kbd className="inline-flex items-center justify-center px-1 h-5 text-xs font-mono rounded border border-[var(--border-medium)] bg-[var(--bg-surface-2)]">Esc</kbd> to close
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
