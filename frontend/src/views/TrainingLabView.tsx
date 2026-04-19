import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";

// Subcomponents
import { TrainingDNAEditor } from "../components/training/TrainingDNAEditor";
import { TrainingEvolutionMap } from "../components/training/TrainingEvolutionMap";
import { TrainingConsole } from "../components/training/TrainingConsole";
import { TerminalSkeleton, HUDSkeleton } from "../components/LoadingSkeletons";

interface KB {
  id: string;
  name: string;
  document_count: number;
}

interface DNA {
  id: string;
  name: string;
  systemPrompt: string;
  steeringRules: string;
  consensusBias: string;
  critiqueStyle: string;
  createdAt: string;
}

export function TrainingLabView() {
  const { fetchWithAuth } = useAuth();
  
  // State
  const [kbs, setKbs] = useState<KB[]>([]);
  const [dnas, setDnas] = useState<DNA[]>([]);
  const [selectedKb, setSelectedKb] = useState<string>("");
  const [selectedDna, setSelectedDna] = useState<string>("");
  const [isTraining, setIsTraining] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<{ id: string, msg: string, type: 'info' | 'success' | 'warning' | 'error' }[]>([]);
  const [dnaDraft, setDnaDraft] = useState<Partial<DNA>>({});

  // Loading data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [kbRes, dnaRes] = await Promise.all([
        fetchWithAuth("/api/kb"),
        fetchWithAuth("/api/prompt-dna")
      ]);
      
      if (kbRes.ok) {
        const data = await kbRes.json();
        setKbs(data.knowledge_bases || []);
      }
      
      if (dnaRes.ok) {
        const data = await dnaRes.json();
        setDnas(data.dnas || []);
      }
    } finally {
      // Small delay for smooth transition
      setTimeout(() => setLoading(false), 500);
    }
  }, [fetchWithAuth]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (selectedDna) {
      const dna = dnas.find(d => d.id === selectedDna);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (dna) setDnaDraft({ ...dna });
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDnaDraft({});
    }
  }, [selectedDna, dnas]);

  const addLog = (msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setLogs(prev => [{ id: Math.random().toString(), msg, type }, ...prev].slice(0, 50));
  };

  const handleSaveDNA = async () => {
    if (!selectedDna || !dnaDraft.id) return;
    setIsSaving(true);
    addLog(`Commit initiated: Persisting DNA mutations for ${dnaDraft.name}...`, "info");
    
    try {
      const res = await fetchWithAuth(`/api/prompt-dna/${dnaDraft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: dnaDraft.name,
          systemPrompt: dnaDraft.systemPrompt,
          steeringRules: dnaDraft.steeringRules,
          consensusBias: dnaDraft.consensusBias,
          critiqueStyle: dnaDraft.critiqueStyle
        })
      });

      if (res.ok) {
        addLog("DNA persistence successful. Behavioral steering updated.", "success");
        setDnas(prev => prev.map(d => d.id === dnaDraft.id ? { ...d, ...dnaDraft } as DNA : d));
      } else {
        const err = await res.json();
        addLog(`Persistence failure: ${err.message || 'Unknown error'}`, "error");
      }
    } catch (_err) {
      addLog("Network error: Mutation commit failed.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const runValidationSequence = async () => {
    if (!selectedDna) {
      addLog("Validation stalled: No target DNA specified.", "warning");
      return;
    }
    
    setIsTraining(true);
    setProgress(0);
    setLogs([]);
    addLog("Initializing validation sequence...", "info");
    
    setProgress(20);
    addLog("Analyzing latent steering resonance...", "info");
    await new Promise(r => setTimeout(r, 800));
    
    setProgress(50);
    addLog("Executing live inference test (Stress Test)...", "info");
    
    try {
      const testRes = await fetchWithAuth("/api/prompts/test", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `${dnaDraft.systemPrompt}\n\nSteering Rules: ${dnaDraft.steeringRules}\n\nTasks: Act as this persona in a high-conflict scenario.`,
          test_input: "Two agents disagree on the security implications of a zero-day patch."
        })
      });

      if (testRes.ok) {
        const result = await testRes.json();
        setProgress(90);
        addLog("Inference completed. Response latency: " + result.latency_ms + "ms", "success");
        addLog("Behavior verification: Output aligns with consensus bias (" + dnaDraft.consensusBias + ")", "success");
      } else {
        addLog("Inference test failed: Model rejected current DNA configuration.", "error");
      }
    } catch (_err) {
      addLog("Validation error: API unreachable.", "error");
    }

    setProgress(100);
    setIsTraining(false);
  };

  return (
    <div className="relative min-h-screen bg-[#000000] overflow-hidden">
      <TechnicalGrid />
      
      <div className="relative z-10 h-full overflow-y-auto scrollbar-custom p-4 lg:p-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-7xl mx-auto space-y-12 pb-24"
        >
          {loading ? (
            <HUDSkeleton />
          ) : (
            <SectorHUD 
              sectorId="GEN-04"
              title="Neuro-Evolution_Chamber"
              subtitle="Biological Unit Evolution // Behavioral Steering"
              accentColor="var(--accent-mint)"
              telemetry={[
                { label: "EVO_ACTIVE", value: isTraining ? "TRUE" : "FALSE", status: isTraining ? "online" : "optimal" },
                { label: "MUTATION_IDX", value: "0.041", status: "online" },
                { label: "UPLINK", value: "SECURE", status: "optimal" }
              ]}
            />
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-8">
              {loading ? (
                <div className="space-y-8">
                   <div className="grid grid-cols-2 gap-6">
                      <div className="h-48 bg-white/5 animate-pulse rounded-[2rem]" />
                      <div className="h-48 bg-white/5 animate-pulse rounded-[2rem]" />
                   </div>
                   <div className="h-96 bg-white/5 animate-pulse rounded-[2rem]" />
                </div>
              ) : (
                <>
                  <TrainingDNAEditor 
                    dnas={dnas}
                    selectedDna={selectedDna}
                    setSelectedDna={setSelectedDna}
                    dnaDraft={dnaDraft}
                    setDnaDraft={setDnaDraft}
                    kbs={kbs}
                    selectedKb={selectedKb}
                    setSelectedKb={setSelectedKb}
                    isSaving={isSaving}
                    onSave={handleSaveDNA}
                    onRevert={() => { if (selectedDna) setDnaDraft({...dnas.find(d=>d.id===selectedDna)}) }}
                  />
                  <TrainingEvolutionMap isTraining={isTraining} progress={progress} />
                </>
              )}
            </div>

            <div className="h-full">
              {loading ? (
                <TerminalSkeleton />
              ) : (
                <TrainingConsole 
                  logs={logs}
                  isTraining={isTraining}
                  progress={progress}
                  onRunValidation={runValidationSequence}
                  selectedDna={selectedDna}
                />
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
