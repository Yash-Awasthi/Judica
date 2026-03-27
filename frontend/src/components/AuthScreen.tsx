import { useState } from "react";

interface AuthProps {
  onLogin: (token: string, username: string) => void;
}

export function AuthScreen({ onLogin }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json() as { token?: string; username?: string; message?: string; error?: string };

      if (!res.ok) {
        throw new Error(data.message || data.error || "Authentication failed");
      }

      onLogin(data.token!, data.username!);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to authenticate");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg relative overflow-hidden font-sans">
      {/* Animated background orbs */}
      <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-accent/4 rounded-full blur-[130px] pointer-events-none animate-glow-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-accent-3/5 rounded-full blur-[100px] pointer-events-none animate-glow-pulse" style={{ animationDelay: '1.5s' }} />

      <div className="w-full max-w-sm px-10 py-10 relative z-10 mx-4">
        {/* Glassmorphism card */}
        <div className="relative border border-white/[0.07] bg-white/[0.02] backdrop-blur-2xl rounded-2xl shadow-2xl overflow-hidden p-8">
          {/* Top glow line */}
          <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

          {/* Brand */}
          <div className="flex flex-col items-center mb-10">
            <div className="w-14 h-14 rounded-2xl bg-accent/8 border border-accent/15 flex items-center justify-center shadow-glow mb-6 relative">
              <span
                className="material-symbols-outlined text-accent text-3xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                gavel
              </span>
              <div className="absolute inset-0 rounded-2xl bg-accent/5 blur-sm" />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-text mb-1.5">
              AI <span className="gradient-text">COUNCIL</span>
            </h1>
            <p className="text-[10px] text-text-muted uppercase tracking-[0.25em] font-bold">
              {isLogin ? "Magistrate Login" : "Create Identity"}
            </p>
          </div>

          {/* Tab switcher */}
          <div className="flex mb-6 p-0.5 bg-white/[0.03] rounded-lg border border-white/5">
            {["Login", "Register"].map((tab) => {
              const active = (tab === "Login") === isLogin;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => { setIsLogin(tab === "Login"); setError(""); }}
                  className={`flex-1 py-2 text-xs font-bold rounded transition-all duration-200 ${
                    active
                      ? "bg-accent/10 text-accent border border-accent/15 shadow-glow-sm"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase tracking-[0.2em] text-text-dim ml-1">
                Username
              </label>
              <input
                id="auth-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="case identity..."
                required
                autoComplete="username"
                className="input-base"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase tracking-[0.2em] text-text-dim ml-1">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="secure protocol..."
                required
                autoComplete={isLogin ? "current-password" : "new-password"}
                className="input-base"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-danger/8 border border-danger/20 rounded-xl text-danger text-[11px] font-bold animate-fade-in">
                <span className="material-symbols-outlined text-sm flex-shrink-0">error</span>
                {error}
              </div>
            )}

            <button
              id="auth-submit"
              type="submit"
              disabled={loading}
              className="w-full relative overflow-hidden bg-accent hover:brightness-110 text-black font-black uppercase tracking-widest py-3.5 rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-glow text-xs mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-black/20 border-t-black/80 rounded-full animate-spin" />
                  Authenticating...
                </span>
              ) : (
                isLogin ? "Enter Council" : "Create Identity"
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <span className="text-[9px] font-bold text-white/15 uppercase tracking-[0.4em] select-none">
            Magistrate Protocol — v1.0
          </span>
        </div>
      </div>
    </div>
  );
}
