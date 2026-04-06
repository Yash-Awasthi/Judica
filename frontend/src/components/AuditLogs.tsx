import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface AuditLog {
  id: number;
  modelName: string;
  prompt: string;
  response: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  createdAt: string;
  metadata?: {
    success?: boolean;
    requestType?: string;
  };
}

export const AuditLogs: React.FC = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;

    const fetchLogs = async () => {
      try {
        const response = await fetch('/api/audit/logs?limit=50');
        if (response.ok) {
          const data = await response.json();
          setLogs(data.logs || []);
        }
      } catch (error) {
        console.error('Failed to fetch audit logs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-text mb-6">Audit Logs</h2>

        {logs.length === 0 ? (
          <div className="text-center text-text-muted py-12">
            <span className="material-symbols-outlined text-4xl mb-2">fact_check</span>
            <p>No audit logs found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="bg-card rounded-lg border border-border overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <span className={`w-2 h-2 rounded-full ${
                      log.metadata?.success !== false ? 'bg-green-500' : 'bg-red-500'
                    }`} />
                    <div className="text-left">
                      <p className="font-medium text-text">{log.modelName}</p>
                      <p className="text-xs text-text-muted">
                        {new Date(log.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-text-muted">
                    <span>{log.tokensIn + log.tokensOut} tokens</span>
                    <span>{log.latencyMs}ms</span>
                    <span className="material-symbols-outlined">
                      {expandedId === log.id ? 'expand_less' : 'expand_more'}
                    </span>
                  </div>
                </button>

                {expandedId === log.id && (
                  <div className="px-4 pb-4 border-t border-border bg-muted/10">
                    <div className="grid grid-cols-2 gap-4 mt-3 text-xs">
                      <div>
                        <p className="font-medium text-text-muted mb-1">Prompt:</p>
                        <p className="font-mono bg-black/20 rounded p-2 max-h-32 overflow-y-auto">
                          {log.prompt.slice(0, 500)}{log.prompt.length > 500 && '...'}
                        </p>
                      </div>
                      <div>
                        <p className="font-medium text-text-muted mb-1">Response:</p>
                        <p className="font-mono bg-black/20 rounded p-2 max-h-32 overflow-y-auto">
                          {log.response.slice(0, 500)}{log.response.length > 500 && '...'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
