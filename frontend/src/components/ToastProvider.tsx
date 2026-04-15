import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, AlertCircle, Info, LucideIcon } from "lucide-react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  duration?: number;
}

interface ToastContextType {
  toast: (message: string, options?: Omit<Toast, "id" | "message">) => void;
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
};

const TOAST_ICONS: Record<ToastType, LucideIcon> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertCircle,
};

const TOAST_COLORS: Record<ToastType, string> = {
  success: "var(--accent-mint)",
  error: "var(--accent-coral)",
  info: "var(--accent-blue)",
  warning: "var(--accent-gold)",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, options?: Omit<Toast, "id" | "message">) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = {
      id,
      message,
      type: options?.type || "info",
      description: options?.description,
      duration: options?.duration || 4000,
    };

    setToasts((prev) => [...prev, newToast]);

    if (newToast.duration !== Infinity) {
      setTimeout(() => removeToast(id), newToast.duration);
    }
  }, [removeToast]);

  const success = (message: string, description?: string) => toast(message, { type: "success", description });
  const error = (message: string, description?: string) => toast(message, { type: "error", description });

  return (
    <ToastContext.Provider value={{ toast, success, error }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none w-full max-w-sm">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => {
            const Icon = TOAST_ICONS[t.type];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 20, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                className="pointer-events-auto"
              >
                <div className="glass-panel p-4 flex items-start gap-3 relative overflow-hidden group">
                  {/* Accent bar */}
                  <div 
                    className="absolute left-0 top-0 bottom-0 w-1" 
                    style={{ backgroundColor: TOAST_COLORS[t.type] }} 
                  />
                  
                  <div 
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `color-mix(in srgb, ${TOAST_COLORS[t.type]} 10%, transparent)`, color: TOAST_COLORS[t.type] }}
                  >
                    <Icon size={18} />
                  </div>

                  <div className="flex-1 min-w-0 py-0.5">
                    <h4 className="text-sm font-bold text-[var(--text-primary)] leading-tight">
                      {t.message}
                    </h4>
                    {t.description && (
                      <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                        {t.description}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => removeToast(t.id)}
                    className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg)] transition-all opacity-0 group-hover:opacity-100"
                  >
                    <X size={14} />
                  </button>
                  
                  {/* Progress bar */}
                  {t.duration !== Infinity && (
                    <motion.div
                      initial={{ width: "100%" }}
                      animate={{ width: "0%" }}
                      transition={{ duration: (t.duration || 4000) / 1000, ease: "linear" }}
                      className="absolute bottom-0 left-0 h-0.5"
                      style={{ backgroundColor: TOAST_COLORS[t.type], opacity: 0.3 }}
                    />
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
