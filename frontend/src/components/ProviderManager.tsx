import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, ShieldCheck, RefreshCw, Server, AlertCircle, CheckCircle2, Globe, Key, Settings, Cpu } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface CustomProvider {
  id: string;
  name: string;
  type: 'builtin' | 'custom';
  baseUrl?: string;
  authType?: string;
  models?: string[];
  available: boolean;
}

interface ProviderForm {
  name: string;
  base_url: string;
  auth_type: 'none' | 'bearer' | 'key-header';
  auth_key: string;
  auth_header_name: string;
  models: string;
}

const INITIAL_FORM: ProviderForm = {
  name: '',
  base_url: '',
  auth_type: 'bearer',
  auth_key: '',
  auth_header_name: 'Authorization',
  models: 'gpt-4o, gpt-3.5-turbo'
};

export const ProviderManager: React.FC = () => {
  const { token, fetchWithAuth } = useAuth();
  const [providers, setProviders] = useState<CustomProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<ProviderForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string }>>({});

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetchWithAuth('/api/custom-providers');
      if (res.ok) {
        const data = await res.json();
        setProviders(data.providers);
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (token) loadProviders();
  }, [token, loadProviders]);

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetchWithAuth('/api/custom-providers/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          models: form.models.split(',').map(m => m.trim()).filter(m => m),
        }),
      });

      if (res.ok) {
        setForm(INITIAL_FORM);
        setShowAddForm(false);
        loadProviders();
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.error || 'Failed to add provider'}`);
      }
    } catch (err) {
      console.error('Submit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteProvider = async (id: string) => {
    const rawId = id.replace('custom_', '');
    if (!confirm('Are you sure you want to delete this custom provider?')) return;
    
    try {
      const res = await fetchWithAuth(`/api/custom-providers/custom/${rawId}`, {
        method: 'DELETE',
      });
      if (res.ok) loadProviders();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleTestProvider = async (id: string) => {
    const rawId = id.replace('custom_', '');
    setTestResults(prev => ({ ...prev, [id]: { success: false, error: 'Testing...' } }));
    
    try {
      const res = await fetchWithAuth(`/api/custom-providers/custom/${rawId}/test`, {
        method: 'POST',
      });
      const data = await res.json();
      setTestResults(prev => ({ 
        ...prev, 
        [id]: { success: data.success, error: data.error } 
      }));
    } catch (_err) {
      setTestResults(prev => ({ 
        ...prev, 
        [id]: { success: false, error: 'Network error' } 
      }));
    }
  };

  const setupOllama = () => {
    setForm({
      name: 'Ollama Local',
      base_url: 'http://localhost:11434/v1',
      auth_type: 'none',
      auth_key: '',
      auth_header_name: '',
      models: 'llama3, mistral'
    });
    setShowAddForm(true);
  };


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            Provider Hub
          </h3>
          <p className="text-sm text-zinc-400">Manage custom LLM endpoints and local instances.</p>
        </div>
        <div className="flex gap-2">
            <button 
                onClick={setupOllama}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors text-xs font-medium text-zinc-300"
            >
                <Cpu className="w-3.5 h-3.5" />
                Quick Ollama
            </button>
            <button 
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-sm font-semibold shadow-lg shadow-blue-900/20"
            >
                {showAddForm ? <Settings className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {showAddForm ? 'View All' : 'Add Custom'}
            </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showAddForm ? (
          <motion.form 
            key="add-form"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onSubmit={handleAddProvider}
            className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-6 space-y-4 backdrop-blur-sm shadow-2xl"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Provider Name</label>
                <input 
                  type="text" 
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  placeholder="e.g. My Private API"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-blue-500 outline-none transition-all"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Base URL (OpenAI Compatible)</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-2.5 w-4 h-4 text-zinc-600" />
                  <input 
                    type="url" 
                    value={form.base_url}
                    onChange={e => setForm({...form, base_url: e.target.value})}
                    placeholder="https://api.yourprovider.com/v1"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-white focus:border-blue-500 outline-none transition-all"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Auth Type</label>
                <select 
                  value={form.auth_type}
                  onChange={e => setForm({...form, auth_type: e.target.value as any})}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-blue-500 outline-none transition-all"
                >
                  <option value="none">None (Local/Public)</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="key-header">API Key Header</option>
                </select>
              </div>
              
              {form.auth_type !== 'none' && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                      {form.auth_type === 'bearer' ? 'Access Token' : 'API Key'}
                    </label>
                    <div className="relative">
                      <Key className="absolute left-3 top-2.5 w-4 h-4 text-zinc-600" />
                      <input 
                        type="password" 
                        value={form.auth_key}
                        onChange={e => setForm({...form, auth_key: e.target.value})}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-white focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                  {form.auth_type === 'key-header' && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Header Name</label>
                      <input 
                        type="text" 
                        value={form.auth_header_name}
                        onChange={e => setForm({...form, auth_header_name: e.target.value})}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Supported Models (Comma separated)</label>
              <textarea 
                value={form.models}
                onChange={e => setForm({...form, models: e.target.value})}
                rows={2}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-blue-500 outline-none transition-all font-mono text-sm"
              />
            </div>

            <div className="pt-2 flex justify-end gap-3">
              <button 
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-sm font-medium text-zinc-300"
              >
                Cancel
              </button>
              <button 
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-sm font-semibold disabled:opacity-50 disabled:cursor-wait"
              >
                {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Initialize Provider
              </button>
            </div>
          </motion.form>
        ) : (
          <motion.div 
            key="provider-list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            {loading ? (
              [1, 2, 3, 4].map(i => (
                <div key={i} className="h-32 bg-zinc-900 animate-pulse rounded-xl border border-zinc-800" />
              ))
            ) : (
              <>
                {providers.map((p) => (
                  <motion.div 
                    layoutId={p.id}
                    key={p.id}
                    className={`group relative overflow-hidden bg-zinc-900 border ${p.available ? 'border-zinc-800' : 'border-red-900/30'} rounded-xl p-5 hover:border-zinc-700 transition-all shadow-lg`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${p.type === 'builtin' ? 'bg-blue-900/20 text-blue-400' : 'bg-purple-900/20 text-purple-400'}`}>
                          {p.type === 'builtin' ? <Server className="w-5 h-5" /> : <Globe className="w-5 h-5" />}
                        </div>
                        <div>
                          <h4 className="font-bold text-white leading-tight">{p.name}</h4>
                          <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                            {p.type} {p.baseUrl && `• ${new URL(p.baseUrl).hostname}`}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.type === 'custom' && (
                          <button 
                            onClick={() => handleDeleteProvider(p.id)}
                            className="p-2 rounded-md hover:bg-red-900/20 text-zinc-500 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        {p.available ? (
                          <div className="px-2 py-0.5 rounded-full bg-green-900/20 border border-green-500/20 text-[10px] font-bold text-green-400 uppercase">Active</div>
                        ) : (
                          <div className="flex items-center gap-1 text-red-400 text-[10px] font-bold uppercase">
                            <AlertCircle className="w-3 h-3" /> Offline
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-4">
                      {p.models?.slice(0, 3).map(m => (
                        <span key={m} className="px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-400">
                          {m}
                        </span>
                      ))}
                      {(p.models?.length || 0) > 3 && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] text-zinc-600">
                          +{(p.models?.length || 0) - 3} more
                        </span>
                      )}
                    </div>

                    {p.type === 'custom' && (
                      <div className="mt-4 pt-4 border-t border-zinc-800/50 flex items-center justify-between">
                        <div className="text-[10px] flex items-center gap-2">
                          {testResults[p.id]?.success === true && <span className="text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Connection OK</span>}
                          {testResults[p.id]?.success === false && <span className="text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {testResults[p.id]?.error}</span>}
                          {!testResults[p.id] && <span className="text-zinc-600">Untested</span>}
                        </div>
                        <button 
                          onClick={() => handleTestProvider(p.id)}
                          className="text-[10px] font-bold text-blue-400 hover:text-blue-300 uppercase tracking-tighter"
                        >
                          Ping Test
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))}
                
                {providers.length === 0 && (
                  <div className="col-span-full py-12 text-center bg-zinc-900/20 rounded-2xl border-2 border-dashed border-zinc-800">
                    <Server className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                    <p className="text-zinc-500">No custom providers configured yet.</p>
                    <button 
                        onClick={() => setShowAddForm(true)}
                        className="mt-4 text-sm text-blue-400 hover:underline"
                    >
                        Register your first model
                    </button>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
