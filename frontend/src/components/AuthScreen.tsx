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

          <div className="mt-4 space-y-2">
            <div className="text-center text-xs text-gray-400 my-2">or continue with</div>
            <a
              href="/api/auth/google"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </a>
            <a
              href="/api/auth/github"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              Continue with GitHub
            </a>
          </div>
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
