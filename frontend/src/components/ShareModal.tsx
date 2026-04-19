import { useState } from "react";
import { Link2, Copy, Check, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface ShareModalProps {
  resourceType: "conversations" | "workflows" | "prompts";
  resourceId: string;
  onClose: () => void;
}

export function ShareModal({ resourceType, resourceId, onClose }: ShareModalProps) {
  const { fetchWithAuth } = useAuth();
  const trapRef = useFocusTrap(onClose);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [expiry, setExpiry] = useState("never");
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    setSharing(true);
    try {
      const res = await fetchWithAuth(`/api/share/${resourceType}/${resourceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: expiry === "never" ? null : expiry }),
      });
      if (res.ok) {
        const data = await res.json();
        setShareToken(data.shareToken);
      }
    } catch (err) {
      console.error("Share failed", err);
    } finally {
      setSharing(false);
    }
  };

  const shareUrl = shareToken
    ? `${window.location.origin}/share/${shareToken}`
    : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard", err);
    }
  };

  const handleUnshare = async () => {
    try {
      await fetchWithAuth(`/api/share/${resourceType}/${resourceId}`, { method: "DELETE" });
      setShareToken(null);
      onClose();
    } catch (err) {
      console.error("Unshare failed", err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-label="Share">
      <div ref={trapRef} className="bg-[var(--bg-surface-1)] rounded-xl shadow-xl p-6 max-w-md w-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg flex items-center gap-2 text-[var(--text-primary)]">
            <Link2 size={18} /> Share
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X size={18} /></button>
        </div>

        {!shareToken ? (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-[var(--text-secondary)]">Expires</span>
              <select
                className="mt-1 w-full px-3 py-2 border border-[var(--border-subtle)] rounded bg-[var(--bg)] text-[var(--text-primary)]"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              >
                <option value="never">Never</option>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </label>
            <button
              onClick={handleShare}
              disabled={sharing}
              className="w-full px-4 py-2 btn-pill-primary disabled:opacity-50"
            >
              {sharing ? "Creating link..." : "Create Share Link"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 px-3 py-2 border border-[var(--border-subtle)] rounded bg-[var(--bg)] text-sm text-[var(--text-primary)]"
                value={shareUrl}
                readOnly
              />
              <button
                onClick={handleCopy}
                className="p-2 border border-[var(--border-subtle)] rounded hover:bg-[var(--glass-bg-hover)]"
              >
                {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} className="text-[var(--text-secondary)]" />}
              </button>
            </div>
            <button
              onClick={handleUnshare}
              className="w-full px-4 py-2 text-sm text-red-400 border border-red-400/20 rounded-lg hover:bg-red-400/10"
            >
              Remove Share Link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
