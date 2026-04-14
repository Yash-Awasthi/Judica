import { useState, useCallback, FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Mail, Lock, User, ArrowRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(username, email, password);
      }
    } catch (err: any) {
      setError(err?.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }, [mode, email, password, username, login, register]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] relative overflow-hidden px-4">
      {/* Background ambient orbs */}
      <div className="absolute w-[600px] h-[600px] rounded-full top-[-20%] left-[-10%] blur-[120px] opacity-[0.04] bg-[var(--accent-mint)] animate-drift pointer-events-none" />
      <div className="absolute w-[500px] h-[500px] rounded-full bottom-[-15%] right-[-10%] blur-[120px] opacity-[0.04] bg-[var(--accent-blue)] animate-drift-slow pointer-events-none" />
      <div className="absolute w-[400px] h-[400px] rounded-full top-[30%] right-[20%] blur-[120px] opacity-[0.03] bg-[var(--accent-gold)] animate-drift pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-[420px]"
      >
        <div className="surface-card p-8 rounded-modal">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--accent-mint)] to-emerald-500 flex items-center justify-center mx-auto mb-4 shadow-glow">
              <span className="text-black text-xl font-black">A</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              AIBY<span className="text-[var(--accent-mint)]">AI</span>
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1.5">
              Multimodal Multi-Agent Deliberative Intelligence
            </p>
          </div>

          {/* Mode Tabs */}
          <div className="relative flex bg-[var(--glass-bg)] rounded-pill p-1 mb-6 border border-[var(--glass-border)]">
            <motion.div
              className="absolute inset-y-1 rounded-pill bg-[var(--bg-surface-1)] shadow-sm"
              animate={{
                left: mode === "login" ? "4px" : "50%",
                right: mode === "login" ? "50%" : "4px",
              }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
            <button
              onClick={() => setMode("login")}
              className={`relative z-10 flex-1 py-2 text-sm font-semibold rounded-pill transition-colors ${
                mode === "login" ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => setMode("register")}
              className={`relative z-10 flex-1 py-2 text-sm font-semibold rounded-pill transition-colors ${
                mode === "register" ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-4 px-4 py-3 rounded-button bg-[var(--accent-coral)]/8 border border-[var(--accent-coral)]/15 text-[var(--accent-coral)] text-sm"
                role="alert"
                aria-live="assertive"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <AnimatePresence mode="wait">
              {mode === "register" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="relative mb-4">
                    <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Username"
                      aria-label="Username"
                      aria-required="true"
                      className="input-base pl-11"
                      required
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative">
              <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                aria-label="Email address"
                aria-required="true"
                className="input-base pl-11"
                required
              />
            </div>

            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                aria-label="Password"
                aria-required="true"
                className="input-base pl-11 pr-11"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-pill-primary w-full justify-center text-base py-3 disabled:opacity-40 disabled:transform-none"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  {mode === "login" ? "Signing in..." : "Creating account..."}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  {mode === "login" ? "Sign In" : "Create Account"}
                  <ArrowRight size={16} />
                </span>
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="text-center text-xs text-[var(--text-muted)] mt-6">
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}
            <button
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
              className="ml-1 text-[var(--accent-mint)] font-semibold hover:underline"
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>

        {/* Trust badge */}
        <p className="text-center text-[10px] text-[var(--text-muted)] mt-6 tracking-wider uppercase">
          Multi-Agent Consensus Intelligence Platform
        </p>
      </motion.div>
    </div>
  );
}
