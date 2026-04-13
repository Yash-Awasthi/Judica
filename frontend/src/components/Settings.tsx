import React, { useState, useEffect, useCallback } from 'react';
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
  const { user } = useAuth();

  const [settings, setSettings] = useState<SettingsState>(loadSettings);

  const updateSetting = useCallback(<K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const { autoCouncil, debateRound, coldValidator, piiDetection, autoAnonymize } = settings;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-text mb-6">Settings</h2>

        <div className="space-y-6">
          {/* User Info */}
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="font-semibold text-text mb-3">Account</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Username</span>
                <span className="text-text">{user || 'Guest'}</span>
              </div>
            </div>
          </div>

          {/* Council Configuration */}
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="font-semibold text-text mb-3">Council Preferences</h3>
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
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="font-semibold text-text mb-3">Privacy & Safety</h3>
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
