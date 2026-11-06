import { contextBridge, ipcRenderer } from "electron";

const api = {
  shot: () => ipcRenderer.invoke("shot") as Promise<{ png: Uint8Array; scale: number; lang: "en" | "es"; aiReady: boolean } | null>,
  claim: () => ipcRenderer.invoke("claim"),
  close: () => ipcRenderer.invoke("close"),
  copy: (png: Uint8Array) => ipcRenderer.invoke("copy", png),
  copyText: (text: string) => ipcRenderer.invoke("copy-text", text),
  save: (png: Uint8Array) => ipcRenderer.invoke("save", png),
  pin: (png: Uint8Array, width: number, height: number) => ipcRenderer.invoke("pin", png, width, height),
  pinImage: () => ipcRenderer.invoke("pin-image") as Promise<Uint8Array | null>,
  pinClose: () => ipcRenderer.invoke("pin-close"),
  translate: (texts: string[], target: string) => ipcRenderer.invoke("translate", texts, target) as Promise<string[] | null>,
  onLocked: (fn: () => void) => void ipcRenderer.on("locked", () => fn()),
};

export type SnapApi = typeof api;
contextBridge.exposeInMainWorld("snap", api);
