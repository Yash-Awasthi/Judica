/**
 * Deliberation bridge — calls Electron IPC via window.molecule
 */

export interface MoleculeOpinion {
  provider: string;
  label: string;   // display name from council config
  text: string;
  summary: string;
  round: number;
}

export interface MoleculeVerdict {
  text: string;
  summary: string;
  round: number;
}

function isMolecule(): boolean {
  return typeof window !== "undefined" && "molecule" in window;
}

export async function deliberate(args: {
  threadId: string;
  message: string;
  round: number;
}): Promise<void> {
  if (!isMolecule()) {
    throw new Error("Molecule desktop app required.");
  }
  return (window as any).molecule.deliberate(args);
}

export async function listThreads() {
  if (!isMolecule()) return [];
  return (window as any).molecule.listThreads();
}

export async function createThread(): Promise<string> {
  if (!isMolecule()) return crypto.randomUUID();
  return (window as any).molecule.createThread();
}

export async function deleteThread(id: string) {
  if (!isMolecule()) return;
  return (window as any).molecule.deleteThread(id);
}

export async function getMessages(threadId: string) {
  if (!isMolecule()) return [];
  return (window as any).molecule.getMessages(threadId);
}

export async function getMemory(): Promise<string> {
  if (!isMolecule()) return localStorage.getItem("molecule_memory") ?? "";
  return (window as any).molecule.getMemory();
}

export async function setMemory(value: string) {
  if (!isMolecule()) { localStorage.setItem("molecule_memory", value); return; }
  return (window as any).molecule.setMemory(value);
}

export async function toggleGlass(on: boolean) {
  if (!isMolecule()) return;
  return (window as any).molecule.toggleGlass(on);
}

export function onOpinion(cb: (data: MoleculeOpinion) => void): () => void {
  if (!isMolecule()) return () => {};
  return (window as any).molecule.on("deliberation:opinion", cb);
}

export function onVerdict(cb: (data: MoleculeVerdict) => void): () => void {
  if (!isMolecule()) return () => {};
  return (window as any).molecule.on("deliberation:verdict", cb);
}

export function onDone(cb: (data: { round: number }) => void): () => void {
  if (!isMolecule()) return () => {};
  return (window as any).molecule.on("deliberation:done", cb);
}

const PROVIDER_WEB_URLS: Record<string, string> = {
  chatgpt: "https://chat.openai.com",
  gemini: "https://gemini.google.com/app",
  claude: "https://claude.ai",
};

/** Open a login window for a browser-mode provider. Resolves when window closes. */
export async function connectProvider(provider: string): Promise<void> {
  if (!isMolecule()) {
    // Web fallback — open in new tab so user can log in
    window.open(PROVIDER_WEB_URLS[provider] ?? `https://${provider}.com`, "_blank");
    return;
  }
  return (window as any).molecule.connectProvider(provider);
}

/** Returns true if the provider has a saved session (cookies present). */
export async function isProviderConnected(provider: string): Promise<boolean> {
  if (!isMolecule()) return false;
  return (window as any).molecule.isProviderConnected(provider);
}
