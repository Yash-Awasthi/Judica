import { useState, useRef, useEffect, useCallback } from "react";
import type { Route } from "./+types/chat";
import {
  deliberate,
  onOpinion,
  onVerdict,
  onDone,
  listThreads,
  createThread,
  deleteThread,
  getMessages,
  toggleGlass,
  type MoleculeOpinion,
  type MoleculeVerdict,
} from "~/lib/deliberate";
import {
  loadCouncilMembers,
  saveCouncilMembers,
  newMember,
  API_PROVIDERS,
  type CouncilMember,
} from "~/lib/council";
import { Plus, Settings2, Trash2, X, ChevronDown, ChevronRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MsgGroup {
  id: string;
  round: number;
  prompt: string;
  opinions: Record<string, string>; // member label → streamed text
  verdict: string;
  done: boolean;
}

interface Thread {
  id: string;
  title: string;
  updated_at: number;
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export function meta(_: Route.MetaArgs) {
  return [{ title: "Judica" }];
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
  bg:      "#080808",
  bgAlt:   "#050505",
  bgPanel: "#0a0a0a",
  border:  "#162a16",
  green:   "#00ff88",
  greenDim:"#4a8a4a",
  cyan:    "#00ccff",
  cyanDim: "#a0e8ff",
  text:    "#c8ffc8",
  textDim: "#3a5a3a",
  red:     "#ff4455",
} as const;

const MONO = "'JetBrains Mono','Fira Code','Cascadia Code',monospace";

// ─── Component ────────────────────────────────────────────────────────────────

export default function Chat() {
  const [council, setCouncil]           = useState<CouncilMember[]>(() => loadCouncilMembers());
  const [threads, setThreads]           = useState<Thread[]>([]);
  const [threadId, setThreadId]         = useState<string>("");
  const [groups, setGroups]             = useState<MsgGroup[]>([]);
  const [streaming, setStreaming]       = useState(false);
  const [input, setInput]               = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showThreads, setShowThreads]   = useState(false);
  const [glassOn, setGlassOn]           = useState(false);

  const colRefs    = useRef<Record<string, HTMLDivElement | null>>({});
  const verdictRef = useRef<HTMLDivElement | null>(null);
  const taRef      = useRef<HTMLTextAreaElement | null>(null);

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const raw = (await listThreads()) as Thread[];
      if (raw.length) {
        setThreads(raw);
        setThreadId(raw[0].id);
        await hydrateThread(raw[0].id);
      } else {
        const id = await createThread();
        const t: Thread = { id, title: "New deliberation", updated_at: Date.now() };
        setThreads([t]);
        setThreadId(id);
      }
    })();

    const offOpinion = onOpinion((data: MoleculeOpinion) => {
      setGroups(prev => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        const updated: MsgGroup = {
          ...last,
          opinions: { ...last.opinions, [data.label]: (last.opinions[data.label] ?? "") + data.text },
        };
        return [...prev.slice(0, -1), updated];
      });
      const col = colRefs.current[data.label];
      if (col) requestAnimationFrame(() => { col.scrollTop = col.scrollHeight; });
    });

    const offVerdict = onVerdict((data: MoleculeVerdict) => {
      setGroups(prev => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, verdict: last.verdict + data.text }];
      });
      if (verdictRef.current)
        requestAnimationFrame(() => { verdictRef.current!.scrollTop = verdictRef.current!.scrollHeight; });
    });

    const offDone = onDone(() => {
      setStreaming(false);
      setGroups(prev => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, done: true }];
      });
    });

    return () => { offOpinion(); offVerdict(); offDone(); };
  }, []);

  // ── Thread hydration ───────────────────────────────────────────────────────

  const hydrateThread = async (id: string) => {
    const msgs = (await getMessages(id)) as Array<{
      id: string; role: string; member: string | null; content: string; round: number;
    }>;
    const byRound: Record<number, MsgGroup> = {};
    for (const m of msgs) {
      if (!byRound[m.round])
        byRound[m.round] = { id: m.id, round: m.round, prompt: "", opinions: {}, verdict: "", done: true };
      if (m.role === "user")                         byRound[m.round].prompt            = m.content;
      if (m.role === "opinion" && m.member)          byRound[m.round].opinions[m.member] = m.content;
      if (m.role === "verdict")                      byRound[m.round].verdict            = m.content;
    }
    setGroups(Object.values(byRound).sort((a, b) => a.round - b.round));
  };

  // ── Thread actions ─────────────────────────────────────────────────────────

  const handleNewThread = async () => {
    const id = await createThread();
    const t: Thread = { id, title: "New deliberation", updated_at: Date.now() };
    setThreads(prev => [t, ...prev]);
    setThreadId(id);
    setGroups([]);
    setShowThreads(false);
  };

  const handleSelectThread = async (id: string) => {
    setThreadId(id);
    setGroups([]);
    setShowThreads(false);
    await hydrateThread(id);
  };

  const handleDeleteThread = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteThread(id);
    const next = threads.filter(t => t.id !== id);
    setThreads(next);
    if (threadId === id) {
      if (next.length) { setThreadId(next[0].id); await hydrateThread(next[0].id); }
      else {
        const nid = await createThread();
        setThreads([{ id: nid, title: "New deliberation", updated_at: Date.now() }]);
        setThreadId(nid);
        setGroups([]);
      }
    }
  };

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    setInput("");
    if (taRef.current) { taRef.current.style.height = "20px"; }

    const group: MsgGroup = {
      id: crypto.randomUUID(),
      round: groups.length + 1,
      prompt,
      opinions: {},
      verdict: "",
      done: false,
    };
    setGroups(prev => [...prev, group]);
    setStreaming(true);

    try {
      await deliberate({ threadId, message: prompt, round: group.round });
    } catch {
      setStreaming(false);
    }
  }, [input, streaming, threadId, groups.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "20px";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  };

  const handleGlass = async () => {
    const next = !glassOn;
    setGlassOn(next);
    await toggleGlass(next);
  };

  // ── Active members ─────────────────────────────────────────────────────────

  const activeMembers = council.filter(m => m.enabled);
  const currentThread = threads.find(t => t.id === threadId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: MONO, background: C.bg, color: C.text, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes blink { 50% { opacity: 0; } }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #162a16; border-radius: 2px; }
        textarea::placeholder { color: #3a5a3a; }
        input::placeholder { color: #3a5a3a; }
        select option { background: #0d0d0d; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 14px", borderBottom: `1px solid ${C.border}`, background: C.bgAlt, flexShrink: 0, position: "relative", zIndex: 30 }}>
        <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.3em", color: C.green }}>JUDICA</span>
        <span style={{ color: C.border }}>│</span>

        {/* Thread picker */}
        <button
          onClick={() => setShowThreads(p => !p)}
          style={{ display: "flex", alignItems: "center", gap: "6px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: "3px", padding: "3px 10px", fontFamily: MONO, fontSize: "10px", color: C.greenDim, cursor: "pointer", letterSpacing: "0.1em" }}
        >
          <span style={{ maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {currentThread?.title ?? "—"}
          </span>
          <ChevronDown size={9} />
        </button>

        {showThreads && (
          <div style={{ position: "absolute", top: "100%", left: "124px", background: "#0d0d0d", border: `1px solid ${C.border}`, borderRadius: "3px", minWidth: "240px", boxShadow: "0 8px 32px #000c" }}>
            <button
              onClick={handleNewThread}
              style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "8px 12px", background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, fontFamily: MONO, fontSize: "10px", color: C.green, cursor: "pointer", letterSpacing: "0.1em" }}
            >
              <Plus size={9} /> NEW THREAD
            </button>
            <div style={{ maxHeight: "260px", overflowY: "auto" }}>
              {threads.map(t => (
                <div
                  key={t.id}
                  onClick={() => handleSelectThread(t.id)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", cursor: "pointer", background: t.id === threadId ? "#162a1625" : "transparent", borderBottom: `1px solid ${C.border}20` }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#162a1615"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = t.id === threadId ? "#162a1625" : "transparent"; }}
                >
                  <span style={{ fontSize: "11px", color: t.id === threadId ? C.green : C.greenDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "185px", display: "flex", alignItems: "center", gap: "4px" }}>
                    {t.id === threadId && <ChevronRight size={9} />}
                    {t.title}
                  </span>
                  <button
                    onClick={e => handleDeleteThread(e, t.id)}
                    style={{ background: "transparent", border: "none", color: C.textDim, cursor: "pointer", padding: "2px", flexShrink: 0 }}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Right controls */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={handleGlass}
            style={{ background: "transparent", border: `1px solid ${glassOn ? C.green : C.border}`, borderRadius: "3px", padding: "3px 10px", fontFamily: MONO, fontSize: "10px", color: glassOn ? C.green : C.greenDim, cursor: "pointer", letterSpacing: "0.1em" }}
          >
            {glassOn ? "GLASS ●" : "GLASS ○"}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: "3px", padding: "4px 8px", cursor: "pointer", color: C.greenDim, display: "flex", alignItems: "center" }}
          >
            <Settings2 size={11} />
          </button>
        </div>
      </div>

      {/* Arena — AI columns */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", borderBottom: `1px solid ${C.border}` }}>
        {activeMembers.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim, fontSize: "11px", letterSpacing: "0.2em" }}>
            NO MEMBERS ENABLED — OPEN SETTINGS ⚙
          </div>
        ) : (
          activeMembers.map((m, idx) => (
            <div
              key={m.id}
              style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: idx < activeMembers.length - 1 ? `1px solid ${C.border}` : "none", overflow: "hidden", minWidth: 0 }}
            >
              {/* Column header */}
              <div style={{ padding: "5px 12px", borderBottom: `1px solid ${C.border}`, fontSize: "10px", letterSpacing: "0.15em", color: C.green, background: C.bgPanel, flexShrink: 0, display: "flex", alignItems: "center", gap: "7px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.green, display: "inline-block", opacity: 0.75, flexShrink: 0 }} />
                {m.label.toUpperCase()}
                <span style={{ marginLeft: "auto", fontSize: "9px", color: C.textDim, letterSpacing: "0.05em" }}>
                  {m.mode === "api" ? m.model : "browser"}
                </span>
              </div>

              {/* Column scroll body */}
              <div
                ref={el => { colRefs.current[m.label] = el; }}
                style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}
              >
                {groups.length === 0 && (
                  <span style={{ color: C.textDim, fontSize: "11px", letterSpacing: "0.1em" }}>awaiting prompt_</span>
                )}
                {groups.map((g, gi) => {
                  const text      = g.opinions[m.label] ?? "";
                  const isLast    = gi === groups.length - 1;
                  const isTicking = isLast && !g.done && streaming;
                  return (
                    <div key={g.id} style={{ marginBottom: "22px" }}>
                      <div style={{ fontSize: "9px", color: C.textDim, letterSpacing: "0.15em", marginBottom: "5px" }}>
                        RND {g.round}
                      </div>
                      <div style={{ fontSize: "11px", color: C.greenDim, marginBottom: "8px", paddingLeft: "8px", borderLeft: `2px solid ${C.border}`, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {g.prompt}
                      </div>
                      <div style={{ fontSize: "12px", lineHeight: 1.75, color: C.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {text || (!isTicking && <span style={{ color: C.textDim }}>—</span>)}
                        {isTicking && (
                          <span style={{ display: "inline-block", width: "7px", height: "13px", background: C.green, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom", marginLeft: text ? "2px" : 0 }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Synthesis/verdict strip */}
      <div style={{ borderBottom: `1px solid ${C.border}`, background: "#060c06", flexShrink: 0, maxHeight: "25vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "4px 12px", fontSize: "9px", letterSpacing: "0.2em", color: C.cyan, borderBottom: `1px solid #0a2533`, flexShrink: 0 }}>
          SYNTHESIS
        </div>
        <div
          ref={verdictRef}
          style={{ padding: "10px 14px", fontSize: "12px", lineHeight: 1.75, color: C.cyanDim, overflowY: "auto", flex: 1, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {(() => {
            const last = groups[groups.length - 1];
            if (!last) return <span style={{ color: C.textDim, fontSize: "11px", letterSpacing: "0.1em" }}>awaiting deliberation_</span>;
            if (!last.verdict && streaming)
              return <span style={{ display: "inline-block", width: "7px", height: "13px", background: C.cyan, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom", opacity: 0.6 }} />;
            return last.verdict || <span style={{ color: C.textDim }}>—</span>;
          })()}
        </div>
      </div>

      {/* Input row */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", padding: "10px 14px", background: C.bgAlt, flexShrink: 0 }}>
        <span style={{ color: C.green, fontSize: "15px", flexShrink: 0, marginBottom: "1px", opacity: 0.8 }}>›</span>
        <textarea
          ref={taRef}
          value={input}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          placeholder="enter prompt…"
          rows={1}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.text, fontFamily: MONO, fontSize: "13px", resize: "none", lineHeight: 1.5, minHeight: "20px", maxHeight: "120px", overflowY: "auto" }}
        />
        <button
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          style={{
            background: streaming || !input.trim() ? "transparent" : C.green,
            color: streaming || !input.trim() ? C.greenDim : "#050505",
            border: `1px solid ${streaming || !input.trim() ? C.border : C.green}`,
            borderRadius: "3px",
            padding: "6px 16px",
            fontFamily: MONO,
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.12em",
            cursor: streaming || !input.trim() ? "default" : "pointer",
            flexShrink: 0,
            transition: "all 0.15s",
          }}
        >
          {streaming ? "···" : "SEND"}
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          council={council}
          onSave={c => { setCouncil(c); saveCouncilMembers(c); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Click-away to close threads dropdown */}
      {showThreads && (
        <div style={{ position: "fixed", inset: 0, zIndex: 29 }} onClick={() => setShowThreads(false)} />
      )}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({
  council,
  onSave,
  onClose,
}: {
  council: CouncilMember[];
  onSave: (c: CouncilMember[]) => void;
  onClose: () => void;
}) {
  const [local, setLocal]       = useState<CouncilMember[]>(() => council.map(m => ({ ...m })));
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (id: string) => setLocal(prev => prev.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m));
  const update = (id: string, patch: Partial<CouncilMember>) => setLocal(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  const remove = (id: string) => setLocal(prev => prev.filter(m => m.id !== id));
  const add    = () => setLocal(prev => [...prev, newMember()]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.87)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0d0d0d", border: `1px solid ${C.border}`, borderRadius: "4px", width: "560px", maxHeight: "80vh", overflow: "auto", padding: "20px", fontFamily: MONO }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
          <span style={{ fontSize: "11px", letterSpacing: "0.22em", color: C.green }}>COUNCIL CONFIG</span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.greenDim, cursor: "pointer", padding: 0 }}>
            <X size={14} />
          </button>
        </div>

        {local.map(m => (
          <div key={m.id} style={{ marginBottom: "6px", border: `1px solid ${C.border}`, borderRadius: "3px", overflow: "hidden" }}>

            {/* Member row */}
            <div
              style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", background: C.bgPanel, cursor: "pointer" }}
              onClick={() => setExpanded(p => p === m.id ? null : m.id)}
            >
              <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: m.enabled ? C.green : C.textDim, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: "11px", color: m.enabled ? C.text : C.textDim, letterSpacing: "0.05em" }}>{m.label}</span>
              <span style={{ fontSize: "9px", color: C.textDim }}>{m.mode === "api" ? m.model : "browser"}</span>
              <button
                onClick={e => { e.stopPropagation(); toggle(m.id); }}
                style={{ background: "transparent", border: `1px solid ${m.enabled ? C.green : C.textDim}`, borderRadius: "2px", padding: "2px 8px", fontFamily: MONO, fontSize: "9px", color: m.enabled ? C.green : C.textDim, cursor: "pointer", letterSpacing: "0.1em" }}
              >
                {m.enabled ? "ON" : "OFF"}
              </button>
              <button
                onClick={e => { e.stopPropagation(); remove(m.id); }}
                style={{ background: "transparent", border: "none", color: C.textDim, cursor: "pointer", padding: "2px" }}
              >
                <Trash2 size={11} />
              </button>
            </div>

            {/* Expanded config */}
            {expanded === m.id && (
              <div style={{ padding: "12px 10px", background: "#080808", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: "9px" }}>
                <SettingsRow label="LABEL">
                  <input value={m.label} onChange={e => update(m.id, { label: e.target.value })} style={iStyle} />
                </SettingsRow>
                <SettingsRow label="MODE">
                  <select value={m.mode} onChange={e => update(m.id, { mode: e.target.value as "browser" | "api" })} style={iStyle}>
                    <option value="browser">browser</option>
                    <option value="api">api</option>
                  </select>
                </SettingsRow>
                {m.mode === "api" && (
                  <>
                    <SettingsRow label="PROVIDER">
                      <select
                        value={m.provider}
                        onChange={e => {
                          const p = API_PROVIDERS.find(x => x.id === e.target.value);
                          update(m.id, { provider: e.target.value, model: p?.defaultModel ?? m.model, baseUrl: p?.defaultBaseUrl ?? m.baseUrl });
                        }}
                        style={iStyle}
                      >
                        {API_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </SettingsRow>
                    <SettingsRow label="MODEL">
                      <input value={m.model} onChange={e => update(m.id, { model: e.target.value })} style={iStyle} />
                    </SettingsRow>
                    <SettingsRow label="API KEY">
                      <input type="password" value={m.apiKey} onChange={e => update(m.id, { apiKey: e.target.value })} style={iStyle} placeholder="sk-…" />
                    </SettingsRow>
                    {(m.provider === "ollama" || m.provider === "custom") && (
                      <SettingsRow label="BASE URL">
                        <input value={m.baseUrl} onChange={e => update(m.id, { baseUrl: e.target.value })} style={iStyle} />
                      </SettingsRow>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
          <button onClick={add}             style={{ ...bStyle, flex: 1 }}>+ ADD MEMBER</button>
          <button onClick={() => onSave(local)} style={{ ...bStyle, background: C.green, color: "#050505", border: `1px solid ${C.green}` }}>SAVE</button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <span style={{ fontSize: "9px", letterSpacing: "0.15em", color: C.textDim, width: "72px", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

const iStyle: React.CSSProperties = {
  width: "100%",
  background: "#0a0a0a",
  border: `1px solid ${C.border}`,
  borderRadius: "2px",
  padding: "4px 8px",
  fontFamily: MONO,
  fontSize: "11px",
  color: C.text,
  outline: "none",
  boxSizing: "border-box",
};

const bStyle: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${C.border}`,
  borderRadius: "3px",
  padding: "8px 14px",
  fontFamily: MONO,
  fontSize: "10px",
  color: C.greenDim,
  cursor: "pointer",
  letterSpacing: "0.1em",
};
