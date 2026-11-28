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

// ---------------------------------------------------------------------------
// ui_config.json – the Settings lists
//   desktop: read/written by the native app next to VisionStudio.exe
//   server:  web mode – the exe serves /api/ui-config; only its own PC may save
//   browser: no backend (dev server, static hosting) – kept in this browser
// ---------------------------------------------------------------------------
export type UiConfigBackend = "desktop" | "server" | "browser";

export interface UiConfigState {
  backend: UiConfigBackend;
  path: string | null;
  text: string | null;
  modified: number | null;
  canSave: boolean;
  error: string | null;
}

export class UiConfigConflict extends Error {
  constructor(message: string, public current: UiConfigState) { super(message); }
}

const BROWSER_KEY = "vision-studio.catalog";

interface FileDto { path: string; text: string | null; modified: number | null; canSave: boolean; error: string | null }
interface SaveErrorDto { kind: string; message: string; current?: FileDto | null }
const fromDto = (backend: UiConfigBackend, f: FileDto): UiConfigState =>
  ({ backend, path: f.path, text: f.text ?? null, modified: f.modified ?? null, canSave: !!f.canSave, error: f.error ?? null });

export async function loadUiConfig(): Promise<UiConfigState> {
  if (isDesktop) {
    const { invoke } = await import("@tauri-apps/api/core");
    return fromDto("desktop", await invoke<FileDto>("ui_config_load"));
  }
  try {
    const r = await fetch("api/ui-config", { cache: "no-store" });
    if (r.ok && (r.headers.get("content-type") ?? "").includes("application/json")) {
      const f = await r.json();
      if (f && typeof f.path === "string") return fromDto("server", f);
    }
  } catch { /* no backend */ }
  return { backend: "browser", path: null, text: storage.get(BROWSER_KEY), modified: null, canSave: true, error: null };
}

/** Save the lists. Throws UiConfigConflict when the file changed since `state` was loaded. */
export async function saveUiConfig(state: UiConfigState, text: string): Promise<UiConfigState> {
  if (state.backend === "browser") {
    storage.set(BROWSER_KEY, text);
    return { ...state, text };
  }
  if (state.backend === "desktop") {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return fromDto("desktop", await invoke<FileDto>("ui_config_save", { text, baseModified: state.modified }));
    } catch (e) {
      const err = e as SaveErrorDto;
      if (err?.kind === "conflict" && err.current) throw new UiConfigConflict(err.message, fromDto("desktop", err.current));
      throw new Error(err?.message ?? String(e));
    }
  }
  const r = await fetch("api/ui-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Vision-Studio": "1" },
    body: JSON.stringify({ text, baseModified: state.modified }),
  });
  const body = await r.json().catch(() => null);
  if (r.ok) return fromDto("server", body);
  if (r.status === 409 && body?.current) throw new UiConfigConflict(body.message, fromDto("server", { ...body.current, canSave: state.canSave }));
  throw new Error(body?.message ?? `Saving failed (HTTP ${r.status})`);
}

// ---------------------------------------------------------------------------
// Bench folders (INI [app] *_dir):
//   project / tester: configurations – File › Save writes <name>_v<version>.json there
//   bitfile / datalogger: listed for the tester's Bit File / Datalogger dropdowns
//   desktop: the native app reads and writes them; server: web mode (local API);
//   browser: no backend (dev server, static hosting) – Save downloads the file
// ---------------------------------------------------------------------------
export type FolderKind = "project" | "tester" | "bitfile" | "datalogger";
export interface ProjectEntry { name: string; modified: number | null; size: number }
export interface ProjectListing {
  backend: "desktop" | "server";
  kind: FolderKind;
  dir: string;
  files: ProjectEntry[];
  canSave: boolean;
  error: string | null;
}
/** Handle of a document that lives in a configuration folder. */
export interface ProjectHandle { project: string; kind?: FolderKind }
export const isProjectHandle = (h: unknown): h is ProjectHandle =>
  !!h && typeof h === "object" && typeof (h as ProjectHandle).project === "string";

export class ProjectFileError extends Error {
  constructor(public kind: string, message: string) { super(message); }
}
const toError = (e: unknown) => {
  const x = e as { kind?: string; message?: string };
  return new ProjectFileError(x?.kind ?? "io", x?.message ?? String(e));
};

/** A bench folder, or null when there is no backend (plain browser). */
export async function listFolder(kind: FolderKind): Promise<ProjectListing | null> {
  if (isDesktop) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return { backend: "desktop", kind, ...(await invoke<Omit<ProjectListing, "backend" | "kind">>("files_list", { kind })) };
    } catch (e) { throw toError(e); }
  }
  try {
    const r = await fetch(`api/files/${kind}`, { cache: "no-store" });
    if (r.ok && (r.headers.get("content-type") ?? "").includes("application/json")) {
      const l = await r.json();
      if (l && typeof l.dir === "string" && Array.isArray(l.files)) return { backend: "server", kind, ...l };
    }
  } catch { /* no backend */ }
  return null;
}
export const listProjects = () => listFolder("project");

export async function readProject(listing: ProjectListing, name: string): Promise<string> {
  if (listing.backend === "desktop") {
    const { invoke } = await import("@tauri-apps/api/core");
    try { return await invoke<string>("file_read", { kind: listing.kind, name }); } catch (e) { throw toError(e); }
  }
  const r = await fetch(`api/files/${listing.kind}/${encodeURIComponent(name)}`, { cache: "no-store" });
  if (r.ok) return r.text();
  throw toError(await r.json().catch(() => ({ message: `HTTP ${r.status}` })));
}

/** Save into the folder. Throws ProjectFileError kind "exists" unless `overwrite`. */
export async function saveProject(listing: ProjectListing, name: string, text: string, overwrite: boolean): Promise<{ name: string; path: string }> {
  if (listing.backend === "desktop") {
    const { invoke } = await import("@tauri-apps/api/core");
    try { return await invoke("file_save", { kind: listing.kind, name, text, overwrite }); } catch (e) { throw toError(e); }
  }
  const r = await fetch(`api/files/${listing.kind}/${encodeURIComponent(name)}${overwrite ? "?overwrite=1" : ""}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Vision-Studio": "1" },
    body: JSON.stringify({ text }),
  });
  const body = await r.json().catch(() => null);
  if (r.ok) return body;
  throw toError(body ?? { message: `Saving failed (HTTP ${r.status})` });
}

/** No folder to write to (plain browser, or another PC in web mode): download `name`. */
export async function downloadJson(text: string, name: string): Promise<boolean> {
  const dl = await hostDownloads;
  if (dl) {
    try {
      await dl.save({ filename: name, data: text });
      return true;
    } catch (e: any) {
      if (e?.code === "declined" || e?.code === "rate_limited") return false;
    }
  }
  download(text, name);
  return true;
}

/** Desktop: pick a JSON file anywhere, starting in the project folder. */
export async function browseFile(startDir?: string): Promise<OpenResult | null> {
  if (isDesktop) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, directory: false, filters: [JSON_FILTER], defaultPath: startDir });
    if (!path || Array.isArray(path)) return null;
    return { text: await readTextFile(path as string), name: baseName(path as string), handle: path };
  }
  return openFile();
}
