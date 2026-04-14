import React, { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const SETTINGS_KEY = 'council_settings';

// Known limitation: Settings are stored only in localStorage and are not synced
// to the backend. They will be lost if the user clears browser data or switches devices.

interface SettingsState {
  autoCouncil: boolean;
  debateRound: boolean;
  coldValidator: boolean;
  piiDetection: boolean;
  autoAnonymize: boolean;
}

const DEFAULT_SETTINGS: SettingsState = {
  autoCouncil: true,
  debateRound: true,
  coldValidator: true,
  piiDetection: true,
  autoAnonymize: false,
};

function loadSettings(): SettingsState {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // ignore corrupt data
  }
  return DEFAULT_SETTINGS;
}

export const Settings: React.FC = () => {
  const { user, token, fetchWithAuth } = useAuth();

  const [settings, setSettings] = useState<SettingsState>(loadSettings);
  const [syncing, setSyncing] = useState(false);

  // Load settings from server on mount
  useEffect(() => {
    if (!token) return;
    fetchWithAuth("/api/auth/settings")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && typeof data === "object" && Object.keys(data).length > 0) {
          const merged = { ...DEFAULT_SETTINGS, ...data } as SettingsState;
          setSettings(merged);
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
        }
      })
      .catch(() => { /* use local fallback */ });
  }, [token, fetchWithAuth]);

  const updateSetting = useCallback(<K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      // Always cache locally
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      // Sync to server (fire-and-forget)
      if (token) {
        setSyncing(true);
        fetchWithAuth("/api/auth/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }).finally(() => setSyncing(false));
      }
      return next;
    });
  }, [token, fetchWithAuth]);

  const { autoCouncil, debateRound, coldValidator, piiDetection, autoAnonymize } = settings;

  return (
    <div className="h-full overflow-y-auto p-6" role="form" aria-label="Settings">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-text mb-6">
          Settings
          {syncing && <span className="ml-2 text-sm text-text-muted font-normal">Saving...</span>}
        </h2>

        <div className="space-y-6">
          {/* User Info */}
          <div className="bg-card rounded-lg border border-border p-4" role="group" aria-labelledby="settings-account-heading">
            <h3 id="settings-account-heading" className="font-semibold text-text mb-3">Account</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Username</span>
                <span className="text-text">{user || 'Guest'}</span>
              </div>
            </div>
          </div>

          {/* Council Configuration */}
          <div className="bg-card rounded-lg border border-border p-4" role="group" aria-labelledby="settings-council-heading">
            <h3 id="settings-council-heading" className="font-semibold text-text mb-3">Council Preferences</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Auto-Council Mode</span>
                <input type="checkbox" className="rounded border-border" checked={autoCouncil} onChange={(e) => updateSetting('autoCouncil', e.target.checked)} />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Enable Debate Round</span>
                <input type="checkbox" className="rounded border-border" checked={debateRound} onChange={(e) => updateSetting('debateRound', e.target.checked)} />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Cold Validator</span>
                <input type="checkbox" className="rounded border-border" checked={coldValidator} onChange={(e) => updateSetting('coldValidator', e.target.checked)} />
              </label>
            </div>
          </div>

          {/* PII Settings */}
          <div className="bg-card rounded-lg border border-border p-4" role="group" aria-labelledby="settings-privacy-heading">
            <h3 id="settings-privacy-heading" className="font-semibold text-text mb-3">Privacy & Safety</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-sm text-text-muted">PII Detection</span>
                <input type="checkbox" className="rounded border-border" checked={piiDetection} onChange={(e) => updateSetting('piiDetection', e.target.checked)} />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Auto-anonymize High Risk</span>
                <input type="checkbox" className="rounded border-border" checked={autoAnonymize} onChange={(e) => updateSetting('autoAnonymize', e.target.checked)} />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
