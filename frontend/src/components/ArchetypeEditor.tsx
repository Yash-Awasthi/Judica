import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';

interface Archetype {
  id?: string;
  name: string;
  thinkingStyle: string;
  asks: string;
  blindSpot: string;
  systemPrompt: string;
  tools?: string[];
}

interface ArchetypeEditorProps {
  archetype: Archetype | null;
  onClose: () => void;
  onSave: (archetype: Archetype) => void;
}

export function ArchetypeEditor({ archetype, onClose, onSave }: ArchetypeEditorProps) {
  const { fetchWithAuth } = useAuth();
  const [formData, setFormData] = useState<Archetype>({
    id: archetype?.id,
    name: archetype?.name || '',
    thinkingStyle: archetype?.thinkingStyle || '',
    asks: archetype?.asks || '',
    blindSpot: archetype?.blindSpot || '',
    systemPrompt: archetype?.systemPrompt || '',
    tools: archetype?.tools || []
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTools = ['web_search', 'execute_code', 'read_webpage', 'calculator', 'get_current_time'];

  useEffect(() => {
    if (archetype) {
      setFormData({
        id: archetype.id,
        name: archetype.name || '',
        thinkingStyle: archetype.thinkingStyle || '',
        asks: archetype.asks || '',
        blindSpot: archetype.blindSpot || '',
        systemPrompt: archetype.systemPrompt || '',
        tools: archetype.tools || []
      });
    } else {
      setFormData({
        id: '',
        name: '',
        thinkingStyle: '',
        asks: '',
        blindSpot: '',
        systemPrompt: '',
        tools: []
      });
    }
  }, [archetype]);

  const handleToolToggle = (tool: string) => {
    setFormData(prev => {
      const tools = prev.tools || [];
      if (tools.includes(tool)) {
        return { ...prev, tools: tools.filter(t => t !== tool) };
      } else {
        return { ...prev, tools: [...tools, tool] };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetchWithAuth('/api/archetypes', {
        method: 'POST',
        body: JSON.stringify({
          archetypeId: formData.id || undefined,
          ...formData
        })
      });

      if (res.ok) {
        const data = await res.json();
        onSave(data.archetype || formData);
        onClose();
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to save archetype');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-bg border border-white/10 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-slide-up">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-text">
            {formData.id ? 'Edit Archetype' : 'Create Custom Archetype'}
          </h2>
          <button onClick={onClose} className="p-2 text-text-muted hover:text-text rounded-lg hover:bg-white/5 transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Name / Role</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10"
              placeholder="e.g. Skeptic, Legal Advisor..."
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Thinking Style</label>
            <textarea
              required
              value={formData.thinkingStyle}
              onChange={e => setFormData({ ...formData, thinkingStyle: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10 h-20 resize-y"
              placeholder="How does this archetype approach problems?"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">What to Ask</label>
            <textarea
              required
              value={formData.asks}
              onChange={e => setFormData({ ...formData, asks: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10 h-20 resize-y"
              placeholder="What questions does this archetype typically ask?"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Blind Spot</label>
            <textarea
              required
              value={formData.blindSpot}
              onChange={e => setFormData({ ...formData, blindSpot: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10 h-20 resize-y"
              placeholder="What does this archetype naturally overlook?"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">System Prompt</label>
            <textarea
              required
              value={formData.systemPrompt}
              onChange={e => setFormData({ ...formData, systemPrompt: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10 font-mono text-xs h-32 resize-y"
              placeholder="You are a... Your goal is to..."
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Allowed Tools</label>
            <div className="flex flex-wrap gap-2">
              {availableTools.map(tool => (
                <button
                  key={tool}
                  type="button"
                  onClick={() => handleToolToggle(tool)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    (formData.tools || []).includes(tool)
                      ? 'bg-accent/20 border-accent/40 text-accent'
                      : 'bg-white/5 border-white/10 text-text-muted hover:border-white/20 hover:text-text'
                  }`}
                >
                  {tool}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl text-sm font-bold bg-accent text-[#000000] hover:brightness-110 disabled:opacity-50 transition-all shadow-glow-sm"
            >
              {loading ? 'Saving...' : 'Save Archetype'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
