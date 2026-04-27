import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("molecule", {
  // Threads
  listThreads: () => ipcRenderer.invoke("threads:list"),
  createThread: () => ipcRenderer.invoke("threads:create"),
  deleteThread: (id: string) => ipcRenderer.invoke("threads:delete", id),
  getMessages: (threadId: string) =>
    ipcRenderer.invoke("threads:messages", threadId),

  // Deliberation
  deliberate: (args: { threadId: string; message: string; round: number }) =>
    ipcRenderer.invoke("deliberate", args),

  // Glass mode
  toggleGlass: (on: boolean) => ipcRenderer.invoke("glass:toggle", on),

  // Providers (legacy)
  listProviders: () => ipcRenderer.invoke("providers:list"),
  setProviders: (providers: string[]) =>
    ipcRenderer.invoke("providers:set", providers),

  // Council members — unified config
  getCouncilMembers: () => ipcRenderer.invoke("council:getMembers"),
  setCouncilMembers: (members: unknown[]) =>
    ipcRenderer.invoke("council:setMembers", members),

  // Memory
  getMemory: () => ipcRenderer.invoke("memory:get"),
  setMemory: (value: string) => ipcRenderer.invoke("memory:set", value),

  // Browser provider connection
  connectProvider: (provider: string) => ipcRenderer.invoke("provider:connect", provider),
  isProviderConnected: (provider: string) => ipcRenderer.invoke("provider:isConnected", provider),

  // Events from main → renderer
  on: (
    channel:
      | "deliberation:started"
      | "deliberation:opinion"
      | "deliberation:verdict"
      | "deliberation:done",
    cb: (data: any) => void
  ) => {
    ipcRenderer.on(channel, (_event, data) => cb(data));
    return () => ipcRenderer.removeAllListeners(channel);
  },
});

// Type declaration for use in React
declare global {
  interface Window {
    molecule: typeof import("./preload");
  }
}
