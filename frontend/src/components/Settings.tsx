import React from 'react';
import { useAuth } from '../context/AuthContext';

export const Settings: React.FC = () => {
  const { user } = useAuth();

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
                <input type="checkbox" className="rounded border-border" defaultChecked />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Enable Debate Round</span>
                <input type="checkbox" className="rounded border-border" defaultChecked />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Cold Validator</span>
                <input type="checkbox" className="rounded border-border" defaultChecked />
              </label>
            </div>
          </div>

          {/* PII Settings */}
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="font-semibold text-text mb-3">Privacy & Safety</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-sm text-text-muted">PII Detection</span>
                <input type="checkbox" className="rounded border-border" defaultChecked />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Auto-anonymize High Risk</span>
                <input type="checkbox" className="rounded border-border" />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
