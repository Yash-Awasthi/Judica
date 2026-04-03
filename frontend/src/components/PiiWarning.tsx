import React, { useState, useEffect } from 'react';

interface PiiDetection {
  found: boolean;
  types: string[];
  riskScore: number;
  anonymized: string;
}

interface PiiWarningProps {
  text: string;
  onProceed: () => void;
  onCancel: () => void;
  onAnonymize?: (anonymizedText: string) => void;
}

export const PiiWarning: React.FC<PiiWarningProps> = ({
  text,
  onProceed,
  onCancel,
  onAnonymize,
}) => {
  const [detection, setDetection] = useState<PiiDetection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkPii = async () => {
      try {
        const response = await fetch('/api/pii/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (response.ok) {
          const data = await response.json();
          setDetection(data);
        }
      } catch (error) {
        console.error('PII check failed:', error);
      } finally {
        setLoading(false);
      }
    };

    checkPii();
  }, [text]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-card rounded-xl p-6 border border-border max-w-md w-full mx-4">
          <div className="flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full" />
            <span className="text-text">Checking for sensitive data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!detection?.found) {
    onProceed();
    return null;
  }

  const severity = detection.riskScore >= 70 ? 'high' : detection.riskScore >= 30 ? 'medium' : 'low';
  const severityColors = {
    high: 'border-red-500/30 bg-red-500/10 text-red-400',
    medium: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    low: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className={`bg-card rounded-xl p-6 border max-w-lg w-full mx-4 ${severityColors[severity]}`}>
        <div className="flex items-start gap-3 mb-4">
          <span className="material-symbols-outlined text-2xl">
            {severity === 'high' ? 'gpp_maybe' : 'warning'}
          </span>
          <div>
            <h3 className="font-bold text-lg mb-1">
              {severity === 'high' ? 'High Risk PII Detected' : 'Sensitive Information Found'}
            </h3>
            <p className="text-sm opacity-80">
              Detected {detection.types.join(', ')} in your message.
              Risk Score: {detection.riskScore}/100
            </p>
          </div>
        </div>

        <div className="bg-black/20 rounded-lg p-3 mb-4 text-sm">
          <p className="font-medium mb-2">Anonymized version:</p>
          <p className="opacity-70 font-mono text-xs">{detection.anonymized}</p>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text transition-colors"
          >
            Cancel
          </button>
          {onAnonymize && (
            <button
              onClick={() => onAnonymize(detection.anonymized)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
            >
              Use Anonymized
            </button>
          )}
          <button
            onClick={onProceed}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors
              ${severity === 'high' 
                ? 'bg-red-500/80 hover:bg-red-500' 
                : 'bg-amber-500/80 hover:bg-amber-500'
              }`}
          >
            Proceed Anyway
          </button>
        </div>
      </div>
    </div>
  );
};
