import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useAuth } from "~/context/AuthContext";

export default function SetupPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `user_${Date.now()}`;
    setUser({ id, username: trimmed });
    navigate("/chat", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <span className="text-3xl font-bold tracking-tight">
            Judica
          </span>
          <p className="text-sm text-muted-foreground">Multi-perspective AI deliberation</p>
        </div>

        <div className="space-y-4">
          <div className="text-center">
            <h2 className="text-lg font-semibold">Welcome</h2>
            <p className="text-sm text-muted-foreground mt-1">
              What should we call you?
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={!name.trim()}>
              Get started
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Your data stays on your device. Add AI provider keys in Settings.
        </p>
      </div>
    </div>
  );
}
