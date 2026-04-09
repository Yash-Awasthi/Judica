import { useState } from "react";
import { Link2, Copy, Check, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface ShareModalProps {
  resourceType: "conversations" | "workflows" | "prompts";
  resourceId: string;
  onClose: () => void;
}

export function ShareModal({ resourceType, resourceId, onClose }: ShareModalProps) {
  const { fetchWithAuth } = useAuth();
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

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUnshare = async () => {
    await fetchWithAuth(`/api/share/${resourceType}/${resourceId}`, { method: "DELETE" });
    setShareToken(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Link2 size={18} /> Share
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {!shareToken ? (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Expires</span>
              <select
                className="mt-1 w-full px-3 py-2 border rounded"
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
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {sharing ? "Creating link..." : "Create Share Link"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 px-3 py-2 border rounded bg-gray-50 text-sm"
                value={shareUrl}
                readOnly
              />
              <button
                onClick={handleCopy}
                className="p-2 border rounded hover:bg-gray-50"
              >
                {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
              </button>
            </div>
            <button
              onClick={handleUnshare}
              className="w-full px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            >
              Remove Share Link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
