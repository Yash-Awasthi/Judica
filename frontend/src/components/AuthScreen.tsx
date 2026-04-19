import { useState, useCallback, FormEvent, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Lock, User, ArrowRight, ShieldCheck, Activity, Database, Cpu } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export function AuthScreen() {
  const { login, register, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [initStep, setInitStep] = useState(0);

  const initSteps = [
    { label: "Establishing Neural Link...", icon: <Cpu size={14} /> },
    { label: "Validating Biometric Hash...", icon: <ShieldCheck size={14} /> },
    { label: "Syncing Knowledge Repos...", icon: <Database size={14} /> },
    { label: "Initializing Mission Control...", icon: <Activity size={14} /> },
  ];

  useEffect(() => {
    if (loading) {
      const interval = setInterval(() => {
         
        setInitStep((prev) => (prev + 1) % initSteps.length);
      }, 800);
      return () => clearInterval(interval);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitStep(0);
    }
  }, [loading, initSteps.length]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        await register(username, password);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
      setLoading(false);
    }
  }, [mode, username, password, login, register]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] relative overflow-hidden px-4">
      {/* Background ambient orbs */}
      <div className="absolute w-[600px] h-[600px] rounded-full top-[-20%] left-[-10%] blur-[120px] opacity-[0.04] bg-[var(--accent-mint)] animate-drift pointer-events-none" />
      <div className="absolute w-[500px] h-[500px] rounded-full bottom-[-15%] right-[-10%] blur-[120px] opacity-[0.04] bg-[var(--accent-blue)] animate-drift-slow pointer-events-none" />

      <AnimatePresence mode="wait">
        {!loading ? (
          <motion.div
            key="auth-form"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-full max-w-[420px] z-10"
          >
            <div className="relative holographic-panel p-10 rounded-[2.5rem] border-white/[0.03] bg-[#0a0a0a]/80 backdrop-blur-3xl overflow-hidden group">
              {/* Corner Accents */}
              <div className="absolute top-0 left-0 w-8 h-[1px] bg-[var(--accent-mint)] opacity-30" />
              <div className="absolute top-0 left-0 w-[1px] h-8 bg-[var(--accent-mint)] opacity-30" />
              <div className="absolute bottom-0 right-0 w-8 h-[1px] bg-[var(--accent-mint)] opacity-30" />
              <div className="absolute bottom-0 right-0 w-[1px] h-8 bg-[var(--accent-mint)] opacity-30" />

              {/* Logo */}
              <div className="text-center mb-10">
                <motion.div 
                  initial={{ rotate: -10 }}
                  animate={{ rotate: 0 }}
                  className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-[var(--accent-mint)] via-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(110,231,183,0.3)] relative group/logo"
                >
                  <div className="absolute inset-0 bg-white/20 opacity-0 group-hover/logo:opacity-100 transition-opacity rounded-[1.5rem]" />
                  <span className="text-black text-2xl font-black">A</span>
                </motion.div>
                <div className="flex items-center justify-center gap-3 mb-2">
                  <div className="h-[1px] w-6 bg-[var(--accent-mint)] opacity-20" />
                  <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[var(--accent-mint)] opacity-60">Sector-00 // Init</span>
                  <div className="h-[1px] w-6 bg-[var(--accent-mint)] opacity-20" />
                </div>
                <h1 className="text-3xl font-black tracking-tighter text-white">
                  AIBY<span className="text-[var(--accent-mint)] font-black">AI</span>
                </h1>
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
                  Access
                </button>
                <button
                  onClick={() => setMode("register")}
                  className={`relative z-10 flex-1 py-2 text-sm font-semibold rounded-pill transition-colors ${
                    mode === "register" ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                  }`}
                >
                  Enlist
                </button>
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mb-4 px-4 py-3 rounded-button bg-[var(--accent-coral)]/8 border border-[var(--accent-coral)]/15 text-[var(--accent-coral)] text-xs font-bold uppercase tracking-wide"
                    role="alert"
                    aria-live="assertive"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Terminal ID (Username)"
                    aria-label="Username"
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
                    placeholder="Passkey"
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
                  className="btn-pill-primary w-full justify-center text-xs font-black uppercase tracking-[0.2em] py-4 disabled:opacity-40 shadow-[0_0_20px_rgba(110,231,183,0.1)] active:scale-95 transition-all"
                >
                  <span className="flex items-center gap-2">
                    {mode === "login" ? "Initialize Access" : "Create Neural ID"}
                    <ArrowRight size={14} />
                  </span>
                </button>

                <div className="relative flex items-center justify-center py-2">
                  <div className="absolute inset-0 flex items-center px-2">
                    <div className="w-full border-t border-[rgba(255,255,255,0.05)]"></div>
                  </div>
                  <span className="relative z-10 px-4 bg-[#16161A] text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">
                    External Verification
                  </span>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    setError("");
                    setLoading(true);
                    try {
                      await loginWithGoogle();
                    } catch (err: unknown) {
                      setError(err instanceof Error ? err.message : "Google Authentication failed");
                      setLoading(false);
                    }
                  }}
                  className="flex items-center justify-center gap-3 w-full py-3 rounded-pill bg-[#1A1A20] hover:bg-[#202026] border border-[rgba(255,255,255,0.03)] text-sm font-semibold text-[var(--text-secondary)] transition-all hover:border-[rgba(255,255,255,0.1)] group"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  <span>Verify with Neural ID (Google)</span>
                </button>
              </form>

              {/* Footer */}
              <p className="text-center text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mt-8">
                {mode === "login" ? "Unauthorized?" : "Already Authorized?"}
                <button
                  onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
                  className="ml-2 text-[var(--accent-mint)] hover:underline"
                >
                  {mode === "login" ? "Enlist" : "Access"}
                </button>
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="auth-loading"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-8 z-10"
          >
            <div className="relative">
              <div className="w-24 h-24 rounded-3xl border border-[rgba(110,231,183,0.2)] bg-[rgba(110,231,183,0.02)] flex items-center justify-center mx-auto mb-8 relative overflow-hidden">
                <motion.div 
                   animate={{ rotate: 360 }}
                   transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                   className="absolute inset-0 border-t-2 border-[var(--accent-mint)] opacity-40 rounded-full"
                />
                <DnaSpinner />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black text-[var(--text-primary)] tracking-widest uppercase italic">
                System Initializing
              </h2>
              <div className="flex items-center justify-center gap-3 text-[var(--accent-mint)] font-mono text-[10px] bg-[rgba(110,231,183,0.05)] py-2 px-4 rounded-pill border border-[rgba(110,231,183,0.1)]">
                {initSteps[initStep].icon}
                <span className="tracking-[0.1em]">{initSteps[initStep].label}</span>
              </div>
            </div>

            <div className="w-48 h-1 bg-[var(--glass-bg)] mx-auto rounded-full overflow-hidden">
               <motion.div 
                 initial={{ width: 0 }}
                 animate={{ width: "100%" }}
                 transition={{ duration: 3, repeat: Infinity }}
                 className="h-full bg-[var(--accent-mint)]"
               />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DnaSpinner() {
  return (
    <div className="flex gap-1.5 items-end h-8">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={i}
          animate={{ height: [8, 32, 8] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
          className="w-1.5 bg-[var(--accent-mint)] rounded-full shadow-[0_0_10px_var(--accent-mint)]"
        />
      ))}
    </div>
  );
}
