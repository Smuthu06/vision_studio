/**
 * Platform abstraction: the same UI runs in a browser and inside Tauri (desktop).
 *  - Desktop: native open/save dialogs + direct file writes (plugin-dialog / plugin-fs).
 *  - Web:     File System Access API where available (Chrome/Edge – real "Save"),
 *             otherwise <input type=file> for opening and a download for saving.
 */
export const isDesktop: boolean = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const platformName = isDesktop ? "Desktop" : "Web";

export interface OpenResult { text: string; name: string; handle: unknown }
export interface SaveResult { name: string; handle: unknown; downloaded?: boolean }

const JSON_FILTER = { name: "Configuration JSON", extensions: ["json"] };
const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/* eslint-disable @typescript-eslint/no-explicit-any */
const w = (typeof window !== "undefined" ? window : {}) as any;
const fsAccess = (): boolean => {
  try {
    return typeof w.showOpenFilePicker === "function" && window.self === window.top;
  } catch {
    return false;
  }
};

function pickWithInput(): Promise<OpenResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.onchange = async () => {
      const f = input.files?.[0];
      input.remove();
      resolve(f ? { text: await f.text(), name: f.name, handle: null } : null);
    };
    input.oncancel = () => { input.remove(); resolve(null); };
    document.body.appendChild(input);
    input.click();
  });
}

export async function openFile(): Promise<OpenResult | null> {
  if (isDesktop) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, directory: false, filters: [JSON_FILTER] });
    if (!path || Array.isArray(path)) return null;
    return { text: await readTextFile(path as string), name: baseName(path as string), handle: path };
  }
  if (fsAccess()) {
    try {
      const [h] = await w.showOpenFilePicker({ types: [{ description: "Configuration JSON", accept: { "application/json": [".json"] } }] });
      const f = await h.getFile();
      return { text: await f.text(), name: f.name, handle: h };
    } catch (e: any) {
      if (e?.name === "AbortError") return null;
    }
  }
  return pickWithInput();
}

/** Hosted-artifact viewers expose a `downloads` capability (plain downloads are sandboxed there). */
const hostDownloads: Promise<any | null> = (async () => {
  const c = w.claude;
  if (!c || typeof c.use !== "function") return null;
  try {
    return await Promise.race([c.use("downloads"), new Promise((r) => setTimeout(() => r(null), 10000))]);
  } catch {
    return null;
  }
})();

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Save `text`. With a handle it overwrites in place; otherwise it asks where (Save As). */
export async function saveFile(text: string, suggestedName: string, handle: unknown, forceAsk = false): Promise<SaveResult | null> {
  if (isDesktop) {
    let path = !forceAsk && typeof handle === "string" ? handle : null;
    if (!path) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      path = await save({ defaultPath: suggestedName, filters: [JSON_FILTER] });
      if (!path) return null;
      if (!/\.[^\\/]+$/.test(path)) path += ".json";
    }
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, text);
    return { name: baseName(path), handle: path };
  }
  if (fsAccess()) {
    try {
      let h = !forceAsk && handle && typeof (handle as any).createWritable === "function" ? handle : null;
      if (!h) h = await w.showSaveFilePicker({ suggestedName, types: [{ description: "Configuration JSON", accept: { "application/json": [".json"] } }] });
      const ws = await (h as any).createWritable();
      await ws.write(text);
      await ws.close();
      return { name: (h as any).name ?? suggestedName, handle: h };
    } catch (e: any) {
      if (e?.name === "AbortError") return null;
      // fall through to download (e.g. permissions blocked)
    }
  }
  const dl = await hostDownloads;
  if (dl) {
    try {
      await dl.save({ filename: suggestedName.endsWith(".json") ? suggestedName : `${suggestedName}.json`, data: text });
      return { name: suggestedName, handle: null, downloaded: true };
    } catch (e: any) {
      if (e?.code === "declined" || e?.code === "rate_limited") return null;
      // otherwise fall back to a plain download
    }
  }
  download(text, suggestedName);
  return { name: suggestedName, handle: null, downloaded: true };
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (isDesktop) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitle(title);
    } catch { /* ignore */ }
  }
}

/** Ask before closing with unsaved changes. Returns an unsubscribe function. */
export function guardClose(isDirty: () => boolean, confirm: () => Promise<boolean>): () => void {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ""; }
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  let unlisten: (() => void) | null = null;
  let disposed = false;
  if (isDesktop) {
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const un = await win.onCloseRequested(async (event) => {
        if (isDirty()) {
          event.preventDefault();
          if (await confirm()) await win.destroy();
        }
      });
      if (disposed) un(); else unlisten = un;
    }).catch(() => undefined);
  }
  return () => {
    disposed = true;
    window.removeEventListener("beforeunload", onBeforeUnload);
    unlisten?.();
  };
}

export const storage = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
  remove(key: string) {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  },
};
