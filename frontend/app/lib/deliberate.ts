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
