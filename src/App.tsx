import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeSteps, type BuildStep } from "./core/guide";
import {
  canDelete, childOptions, defOf, docKind, documentFromJson, documentFromText, documentToJson, documentToText, LoadError,
  newDocument, newTesterDocument, nodeLabel, nodeToJson, TreeIndex, validateTree, walk, type ChildOption, type CNode, type Issue,
} from "./core/model";
import { RANK, type Severity } from "./core/schema";
import {
  browseFile, downloadJson, guardClose, isDesktop, isProjectHandle, listFolder, loadUiConfig, platformName, ProjectFileError,
  readProject, saveProject, saveUiConfig, setWindowTitle, storage, type FolderKind, type ProjectEntry, type ProjectListing,
  UiConfigConflict, type UiConfigState,
} from "./platform";
import { initialState, useAppStore } from "./state/store";
import { Editor, type FocusRequest } from "./ui/Editor";
import { AppLogo, Icon } from "./ui/icons";
import { Menu, OverlayProvider, useOverlay, type MenuItem, type MenuState } from "./ui/overlays";
import { BottomPanel, BuildGuide } from "./ui/Panels";
import { Tree } from "./ui/Tree";
import { DetailsPane, parseInputId, type ActiveInput } from "./ui/DetailsPane";
import sample from "./assets/sample.json";
import { applyRenames, catalogUsage, defaultCatalog, normalizeCatalog, usageKey, type Catalog, type Rename, type SettingsSection, type TesterContext } from "./core/catalog";
import { SettingsWindow } from "./ui/Settings";
import { OpenDialog } from "./ui/OpenDialog";
import { PickProjectDialog } from "./ui/PickProjectDialog";
import { configFileName } from "./core/filename";

/** Without a backend (plain browser) the built-in sample stands in for the project folder. */
const SAMPLE_NAME = configFileName(documentFromJson(sample).root);
const KIND_LABEL: Record<"project" | "tester", string> = { project: "project", tester: "tester" };

const APP = "Vision Studio";
const DRAFT_KEY = "vision-studio.draft";
const CATALOG_KEY = "vision-studio.catalog";

function loadCatalog(): Catalog {
  const raw = storage.get(CATALOG_KEY);
  if (!raw) return defaultCatalog();
  try { return normalizeCatalog(JSON.parse(raw)).catalog; } catch { return defaultCatalog(); }
}
const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

interface Draft { time: number; fileName: string | null; json: unknown }

export default function App() {
  return <OverlayProvider><Studio /></OverlayProvider>;
}

function Studio() {
  const { confirm, toast } = useOverlay();
  const { state, dispatch, mutate } = useAppStore(() => initialState());
  const root = state.doc.root;
  const kind = docKind(root);
  const idx = useMemo(() => new TreeIndex(root), [root]);
  const [baseCatalog, setCatalog] = useState<Catalog>(loadCatalog);
  const [testerCtx, setTesterCtx] = useState<TesterContext | null>(null);
  // the lists behind the dropdowns: Settings lists + (tester) the referenced project and bench folders
  const catalog = useMemo<Catalog>(() => (kind === "tester" && testerCtx ? { ...baseCatalog, ctx: testerCtx } : baseCatalog), [baseCatalog, kind, testerCtx]);
  const [settingsAt, setSettingsAt] = useState<SettingsSection | null>(null);
  const [uiFile, setUiFile] = useState<UiConfigState | null>(null);   // where the lists live (ui_config.json)
  const [folders, setFolders] = useState<Partial<Record<FolderKind, ProjectListing | null>>>({}); // null = plain browser
  const projects = folders[kind] ?? null;                                  // where Save writes the open document
  const [openList, setOpenList] = useState<ProjectListing | null>(null); // File › Open dialog
  const [pickProject, setPickProject] = useState<{ dir: string | null; files: ProjectEntry[]; error?: string | null } | null>(null);
  const issues = useMemo(() => validateTree(root, idx, catalog), [root, idx, catalog]);
  const steps = useMemo(() => computeSteps(root, issues, idx), [root, issues, idx]);
  const selected = idx.get(state.selectedId) ?? root;

  const [theme, setTheme] = useState<string>(() => storage.get("vision-studio.theme")
    ?? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [bottomTab, setBottomTab] = useState<"problems" | "json" | null>(null);
  const [bottomH, setBottomH] = useState(230);
  const [guideOpen, setGuideOpen] = useState(true);
  const [sidebarW, setSidebarW] = useState(310);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [revealAll, setRevealAll] = useState(false);              // show every issue (after Validate / Save / opening a file)
  const [touched, setTouched] = useState<Set<string>>(new Set()); // inputs the user has edited or left
  const [dragOver, setDragOver] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(() => {
    const v = storage.get("vision-studio.details");
    return v === null ? window.innerWidth >= 1200 : v === "open";
  });
  const [detailsW, setDetailsW] = useState(() => Number(storage.get("vision-studio.detailsWidth")) || 360);
  const [activeInput, setActiveInput] = useState<ActiveInput | null>(null);
  const [draftOffer, setDraftOffer] = useState<Draft | null>(() => {
    try {
      const d = JSON.parse(storage.get(DRAFT_KEY) ?? "null") as Draft | null;
      return d && d.json ? d : null;
    } catch { return null; }
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const baseCatalogRef = useRef(baseCatalog);
  baseCatalogRef.current = baseCatalog;

  // ---- gentle validation: only show what the user has touched, until they validate/save ---------
  const visibleIssues = useMemo(() => {
    if (revealAll) return issues;
    const touchedNodes = new Set([...touched].map((k) => k.split(":")[1]));
    const required = (i: Issue) => / is required$/.test(i.message);
    return issues.filter((i) => {
      if (i.field !== undefined && i.table === undefined)
        return touched.has(`f:${i.nodeId}:${i.field}`) || (touchedNodes.has(i.nodeId) && !required(i));
      if (i.table !== undefined && i.row !== undefined) {
        if (i.column && touched.has(`c:${i.nodeId}:${i.table}:${i.row}:${i.column}`)) return true;
        return !required(i) && [...touched].some((k) => k.startsWith(`c:${i.nodeId}:${i.table}:${i.row}:`));
      }
      return false; // node-level / cross-node findings wait for Validate
    });
  }, [issues, revealAll, touched]);
  const markTouched = (id: string) => {
    const a = parseInputId(id, selected.id);
    if (!a) return;
    const key = a.kind === "field" ? `f:${selected.id}:${a.key}` : `c:${selected.id}:${a.tableId}:${a.row}:${a.column}`;
    setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));
  };
  const resetValidationView = (reveal: boolean) => { setRevealAll(reveal); setTouched(new Set()); };

  // ---- derived issue maps ------------------------------------------------
  const { subtreeSev, ownCount, byNode } = useMemo(() => {
    const byNode = new Map<string, Issue[]>();
    for (const i of visibleIssues) byNode.set(i.nodeId, [...(byNode.get(i.nodeId) ?? []), i]);
    const ownCount = new Map<string, { count: number; sev: Severity }>();
    byNode.forEach((list, id) => ownCount.set(id, { count: list.length, sev: list.some((i) => i.severity === "error") ? "error" : "warning" }));
    const subtreeSev = new Map<string, Severity>();
    const visit = (n: CNode): Severity | null => {
      let w: Severity | null = ownCount.get(n.id)?.sev ?? null;
      for (const c of n.children) { const cw = visit(c); if (RANK[cw ?? "none"] > RANK[w ?? "none"]) w = cw; }
      if (w) subtreeSev.set(n.id, w);
      return w;
    };
    visit(root);
    return { subtreeSev, ownCount, byNode };
  }, [visibleIssues, root]);
  const guideSteps = useMemo(() => (revealAll ? steps : steps.map((s) => (s.status === "attention" ? { ...s, status: "todo" as const } : s))), [steps, revealAll]);
  const guideComplete = steps.every((s) => s.status === "done" || s.status === "optional");
  const wasComplete = useRef(guideComplete);
  useEffect(() => { // fold the guide away once everything is done, giving the tree the space
    if (guideComplete && !wasComplete.current) setGuideOpen(false);
    if (!guideComplete && wasComplete.current) setGuideOpen(true);
    wasComplete.current = guideComplete;
  }, [guideComplete]);
  const nErr = issues.filter((i) => i.severity === "error").length;
  const nWarn = issues.length - nErr;

  // ---- effects -------------------------------------------------------------
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storage.set("vision-studio.theme", theme);
  }, [theme]);

  useEffect(() => { storage.set("vision-studio.details", detailsOpen ? "open" : "closed"); }, [detailsOpen]);
  useEffect(() => {
    const on = (e: Event) => setSettingsAt(((e as CustomEvent).detail?.section as SettingsSection) ?? "features");
    window.addEventListener("cce:open-settings", on);
    return () => window.removeEventListener("cce:open-settings", on);
  }, []);

  const fileName = (f: UiConfigState | null) => (f?.path ? f.path.split(/[\\/]/).pop()! : "ui_config.json");

  /** Use a loaded ui_config.json; returns false when it could not be used. */
  const adoptUiFile = (f: UiConfigState, announce = false): boolean => {
    setUiFile(f);
    if (f.error) { toast(`${f.error} – using the built-in lists; fix the file or Apply new settings to replace it.`, "error"); return false; }
    if (!f.text) return true;
    try {
      const { catalog: c, warnings } = normalizeCatalog(JSON.parse(f.text));
      setCatalog(c);
      if (warnings.length) toast(`${fileName(f)}: ${warnings.length} entr${warnings.length > 1 ? "ies" : "y"} ignored – ${warnings[0]}`, "info");
      else if (announce) toast(`Reloaded ${fileName(f)}`, "success");
      return true;
    } catch (e) {
      toast(`${fileName(f)} could not be read: ${(e as Error).message}`, "error");
      return false;
    }
  };

  const reloadUiConfig = async (announce = true) => {
    try {
      let f = await loadUiConfig();
      // first start next to the exe: create the file from the current lists so it can be found and shared
      if (!f.text && !f.error && f.backend !== "browser" && f.canSave) {
        try { f = await saveUiConfig(f, JSON.stringify(baseCatalogRef.current, null, 2) + "\n"); } catch { /* read-only folder: keep defaults */ }
      }
      adoptUiFile(f, announce);
    } catch (e) {
      toast(`Could not load the dropdown lists: ${(e as Error).message}`, "error");
    }
  };
  useEffect(() => { void reloadUiConfig(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Apply edited settings: save ui_config.json, then update the dropdowns (and, if wanted, renamed values). */
  const applySettings = async (next: Catalog, renames: Rename[]) => {
    const use = catalogUsage(root);
    const used = renames.map((r) => ({ r, n: use.get(usageKey(r.source, r.from, r.manufacturer ?? "", r.model ?? "")) ?? 0 })).filter((x) => x.n > 0);
    let doRename = false;
    if (used.length) {
      const answer = await confirm({
        title: "Update the open configuration?",
        confirmLabel: "Update values", cancelLabel: "Keep old values",
        message: (<>
          <p style={{ marginTop: 0 }}>You renamed values that this configuration uses:</p>
          <ul className="rename-list">{used.map(({ r, n }, i) => <li key={i}><code>{r.from}</code> → <code>{r.to}</code> <span className="muted">({n}×)</span></li>)}</ul>
          <p style={{ marginBottom: 0 }}>Update them to the new names? Keeping them flags the old values for review.</p>
        </>),
      });
      doRename = answer === "confirm";
    }

    const text = JSON.stringify(next, null, 2) + "\n";
    const base: UiConfigState = uiFile ?? { backend: "browser", path: null, text: null, modified: null, canSave: true, error: null };
    let saved: UiConfigState;
    try {
      saved = await saveUiConfig(base, text);
    } catch (e) {
      if (!(e instanceof UiConfigConflict)) { toast(`Settings not saved: ${(e as Error).message}`, "error"); return; }
      const answer = await confirm({
        title: `${fileName(base)} was changed`,
        message: <>Someone else saved <code>{base.path}</code> after you opened Settings. Replace their lists with yours, or load their version and discard your changes?</>,
        confirmLabel: "Replace with mine", extraLabel: "Load their version", cancelLabel: "Back to Settings", danger: true,
      });
      if (answer === "extra") { adoptUiFile(e.current, true); setSettingsAt(null); return; }
      if (answer !== "confirm") { setUiFile(e.current); return; }
      try { saved = await saveUiConfig(e.current, text); } catch (e2) { toast(`Settings not saved: ${(e2 as Error).message}`, "error"); return; }
    }
    setUiFile(saved);
    setCatalog(next);
    let updated = 0;
    if (doRename) {
      dispatch({ type: "mutateDoc", recipe: (r) => { applyRenames(r, renames); } });
      updated = used.reduce((a, x) => a + x.n, 0);
    }
    setSettingsAt(null);
    const where = saved.backend === "browser" ? "in this browser" : `to ${fileName(saved)}`;
    toast(`Settings saved ${where}${updated ? ` – ${updated} value(s) updated in this configuration` : ""}`, "success");
  };
  useEffect(() => { storage.set("vision-studio.detailsWidth", String(detailsW)); }, [detailsW]);
  useEffect(() => { setActiveInput(null); }, [state.selectedId]);

  useEffect(() => {
    setWindowTitle(`${state.dirty ? "● " : ""}${state.fileName ?? "Untitled"} — ${APP}`);
  }, [state.dirty, state.fileName]);

  useEffect(() => { // autosave a recovery draft (never blocks the UI)
    if (!state.dirty) return;
    const t = setTimeout(() => storage.set(DRAFT_KEY, JSON.stringify({ time: Date.now(), fileName: state.fileName, json: documentToJson(state.doc) })), 600);
    return () => clearTimeout(t);
  }, [state.doc, state.dirty, state.fileName]);

  const askDiscard = useCallback(async (): Promise<boolean> => {
    if (!stateRef.current.dirty) return true;
    const r = await confirm({
      title: "Unsaved changes", message: `Save changes to “${stateRef.current.fileName ?? "Untitled"}” before continuing?`,
      confirmLabel: "Save", extraLabel: "Don't save",
    });
    if (r === "extra") return true;
    if (r === "confirm") return save();
    return false;
  }, [confirm]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => guardClose(() => stateRef.current.dirty, askDiscard), [askDiscard]);

  // ---- tree / structure actions -------------------------------------------
  const expand = (id: string) => setCollapsed((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
  const toggle = (id: string, open?: boolean) => setCollapsed((s) => {
    const n = new Set(s);
    const willOpen = open ?? n.has(id);
    if (willOpen) n.delete(id); else n.add(id);
    return n;
  });
  const select = (id: string) => { dispatch({ type: "select", id }); setMenu(null); };

  const addChild = (parent: CNode, opt: ChildOption) => {
    if (!opt.enabled) return;
    const node = opt.create();
    dispatch({ type: "add", parentId: parent.id, node });
    expand(parent.id);
  };

  const deleteNode = async (node: CNode) => {
    if (!canDelete(node, idx)) { toast(`${defOf(node).title} cannot be deleted`, "info"); return; }
    const n = [...walk(node)].length - 1;
    const r = await confirm({ title: "Delete node", danger: true, confirmLabel: "Delete",
      message: <>Delete <b>{nodeLabel(node)}</b>{n ? ` and its ${n} child node${n > 1 ? "s" : ""}` : ""}? You can undo this with {MOD}Z.</> });
    if (r === "confirm") dispatch({ type: "delete", id: node.id });
  };

  const duplicate = (node: CNode) => {
    if (!defOf(node).duplicable) return;
    dispatch({ type: "duplicate", id: node.id });
  };

  const openContext = (node: CNode, x: number, y: number) => {
    const items: MenuItem[] = [{ kind: "header", label: nodeLabel(node), nodeIcon: defOf(node).icon }];
    const opts = childOptions(node, idx, catalog);
    for (const o of opts) items.push({ label: o.label, nodeIcon: o.icon, hint: o.enabled ? o.description : o.reason, disabled: !o.enabled, onSelect: () => addChild(node, o) });
    if (opts.length) items.push({ kind: "separator" });
    const parent = idx.parentOf(node);
    if (!opts.length && parent) {
      const popts = childOptions(parent, idx, catalog).filter((o) => o.type === node.type || o.enabled);
      if (popts.length) {
        items.push({ kind: "header", label: `Add to ${nodeLabel(parent)}`, nodeIcon: defOf(parent).icon });
        for (const o of popts) items.push({ label: o.label, nodeIcon: o.icon, hint: o.enabled ? o.description : o.reason, disabled: !o.enabled, onSelect: () => addChild(parent, o) });
        items.push({ kind: "separator" });
      }
    }
    if (defOf(node).duplicable) items.push({ label: "Duplicate", icon: "copy", shortcut: `${MOD}D`, onSelect: () => duplicate(node) });
    items.push({ label: "Delete", icon: "trash", shortcut: "Del", danger: true, disabled: !canDelete(node, idx), onSelect: () => deleteNode(node) });
    if (node.children.length) {
      items.push({ kind: "separator" });
      const ids = [...walk(node)].filter((n) => n.children.length).map((n) => n.id);
      items.push({ label: "Expand all below", icon: "expand", onSelect: () => setCollapsed((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }) });
      items.push({ label: "Collapse all below", icon: "collapse", onSelect: () => setCollapsed((s) => new Set([...s, ...ids])) });
    }
    setMenu({ x, y, items, minWidth: 260 });
  };

  /** Select a node, reveal it in the tree and open its right-click menu next to its row. */
  const openMenuFor = (node: CNode) => {
    select(node.id);
    idx.path(node).forEach((n) => expand(n.id));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`.tree-row[data-id="${node.id}"]`);
      row?.scrollIntoView({ block: "nearest" });
      const r = row?.querySelector(".tree-label")?.getBoundingClientRect() ?? row?.getBoundingClientRect();
      openContext(node, r ? r.left + 8 : 240, r ? r.bottom + 2 : 160);
    }));
  };


  // ---- issues / guide -------------------------------------------------------
  const gotoIssue = (i: Issue) => {
    select(i.nodeId);
    idx.path(idx.get(i.nodeId)!).forEach((n) => expand(n.id));
    setFocus({ issue: i, nonce: Date.now() });
  };

  const runStep = (s: BuildStep) => {
    if (s.id === "validate") { validate(); return; }
    const a = s.action;
    if (!a) return;
    if (a.kind === "select") { select(a.nodeId); return; }
    const parent = idx.get(a.parentId);
    if (!parent) return;
    openMenuFor(parent); // adding always happens through the node's right-click menu
  };

  const validate = () => {
    setRevealAll(true);
    setBottomTab("problems");
    if (nErr) {
      toast(`Validation found ${nErr} error(s) and ${nWarn} warning(s)`, "error");
      const first = issues.find((i) => i.severity === "error");
      if (first) gotoIssue(first);
    } else toast(nWarn ? `Configuration is valid – ${nWarn} warning(s)` : "Configuration is valid ✓", "success");
  };

  // ---- files ------------------------------------------------------------------
  const load = (text: string, name: string | null, handle: unknown) => {
    try {
      const doc = documentFromText(text);
      dispatch({ type: "load", doc, fileName: name, handle });
      setCollapsed(new Set());
      resetValidationView(true);
      storage.remove(DRAFT_KEY);
      const n = validateTree(doc.root, new TreeIndex(doc.root), catalogRef.current).filter((i) => i.severity === "error").length;
      toast(`Opened ${name ?? "file"}${n ? ` – ${n} validation error(s)` : ""}`, n ? "error" : "success");
    } catch (e) {
      toast(e instanceof LoadError ? `Could not open ${name ?? "file"}: ${e.message}` : `Could not open file: ${(e as Error).message}`, "error");
    }
  };

  const newDoc = async () => {
    if (!(await askDiscard())) return;
    dispatch({ type: "load", doc: newDocument(), fileName: null, handle: null });
    setCollapsed(new Set());
    storage.remove(DRAFT_KEY);
    resetValidationView(false);
  };
  const refreshFolder = async (k: FolderKind) => {
    try { const l = await listFolder(k); setFolders((f) => ({ ...f, [k]: l })); return l; } catch { return null; }
  };
  useEffect(() => { void refreshFolder("project"); void refreshFolder("tester"); }, []);

  /** File › New › Tester: pick the project first; cancelling ends the request. */
  const newTester = async () => {
    if (!(await askDiscard())) return;
    const l = await refreshFolder("project");
    setPickProject(l ? { dir: l.dir, files: l.files, error: l.error } : { dir: null, files: [{ name: SAMPLE_NAME, modified: null, size: 0 }] });
  };
  const createTester = (projectFile: string) => {
    setPickProject(null);
    const doc = newTesterDocument(projectFile);
    dispatch({ type: "load", doc, fileName: null, handle: null });
    setCollapsed(new Set());
    storage.remove(DRAFT_KEY);
    resetValidationView(false);
    toast(`New tester configuration for ${projectFile} – right-click the tester to add a mode`, "success");
  };

  // ---- tester: load the project it refers to and list the bench folders -----------------
  const testerProject = kind === "tester" ? String(root.params.project ?? "") : null;
  const loadTesterContext = useCallback(async (projectFile: string) => {
    const [pl, bl, dl, il] = await Promise.all([refreshFolder("project"), refreshFolder("bitfile"), refreshFolder("datalogger"), refreshFolder("i2c")]);
    const names = (l: ProjectListing | null) => (l ? l.files.map((f) => f.name) : null);
    let project: TesterContext["project"] = null;
    if (projectFile) {
      try {
        const text = pl ? await readProject(pl, projectFile) : projectFile === SAMPLE_NAME ? JSON.stringify(sample) : null;
        if (text === null) project = { name: projectFile, root: null, error: `${projectFile} is not available here` };
        else {
          const d = documentFromText(text);
          project = d.root.type === "project" ? { name: projectFile, root: d.root } : { name: projectFile, root: null, error: `${projectFile} is not a project configuration` };
        }
      } catch (e) { project = { name: projectFile, root: null, error: (e as Error).message }; }
    }
    setTesterCtx({
      projectFiles: pl ? names(pl) : [SAMPLE_NAME], project, bitfiles: names(bl), dataloggers: names(dl), i2cFiles: names(il),
      dirs: { project: pl?.dir, bitfile: bl?.dir, datalogger: dl?.dir, i2c: il?.dir },
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (testerProject === null) { setTesterCtx(null); return; }
    void loadTesterContext(testerProject);
    const onFocus = () => void loadTesterContext(testerProject); // files added while away show up
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [testerProject, loadTesterContext]);
  useEffect(() => { // the project file could not be read: say so once
    if (testerCtx?.project?.error) toast(`Project configuration: ${testerCtx.project.error}`, "error");
  }, [testerCtx?.project?.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const browse = async () => {
    const l = openList;
    setOpenList(null);
    try {
      const r = await browseFile(l?.files.length ? l.dir : undefined); // the folder exists once something was saved
      if (r) load(r.text, r.name, r.handle);
    } catch (e) { toast(`Open failed: ${(e as Error).message}`, "error"); }
  };
  const open = async (k: "project" | "tester" = kind) => {
    if (!(await askDiscard())) return;
    const l = await refreshFolder(k);
    if (l) setOpenList(l); else await browse();
  };
  const openFromFolder = async (name: string) => {
    const l = openList;
    setOpenList(null);
    if (!l) return;
    try {
      load(await readProject(l, name), name, { project: name, kind: l.kind });
    } catch (e) { toast(`Open failed: ${(e as Error).message}`, "error"); }
  };
  const openSample = async () => {
    if (!(await askDiscard())) return;
    dispatch({ type: "load", doc: documentFromJson(sample), fileName: null, handle: null });
    setCollapsed(new Set());
    resetValidationView(true);
    toast("Loaded the sample project – give it your project name and version before saving", "success");
  };

  async function save(): Promise<boolean> {
    const st = stateRef.current;
    setRevealAll(true);
    const errs = validateTree(st.doc.root, new TreeIndex(st.doc.root), catalogRef.current).filter((i) => i.severity === "error").length;
    if (errs) {
      const r = await confirm({ title: "Configuration has errors", confirmLabel: "Save anyway",
        message: `${errs} validation error(s) remain. The file will not conform to the schema until they are fixed.` });
      if (r !== "confirm") { setBottomTab("problems"); return false; }
    }
    // The name always comes from the configuration: <project|tester>_v<version>.json in its folder.
    const docK = docKind(st.doc.root);
    const name = configFileName(st.doc.root);
    const text = documentToText(st.doc);
    try {
      const folder = await refreshFolder(docK);
      if (!folder || !folder.canSave) { // plain browser, or another PC in web mode
        if (!(await downloadJson(text, name))) return false;
        dispatch({ type: "saved", fileName: name, handle: null });
        storage.remove(DRAFT_KEY);
        toast(folder ? `Downloaded ${name} – only the PC running Vision Studio saves to ${folder.dir}` : `Downloaded ${name}`, "success");
        return true;
      }
      // Re-saving the file that is open replaces it; any other file of that name needs a yes.
      const own = isProjectHandle(st.fileHandle) && (st.fileHandle.kind ?? "project") === docK && st.fileHandle.project.toLowerCase() === name.toLowerCase();
      const who = docK === "tester" ? st.doc.root.params.testerName : st.doc.root.params.project;
      const askReplace = async () => (await confirm({ title: `Replace ${name}?`, confirmLabel: "Replace", danger: true,
          message: <>A configuration for {KIND_LABEL[docK]} <b>{String(who || "Untitled")}</b> version <b>{String(st.doc.root.params.version || "–")}</b> is already saved in <code>{folder.dir}</code>. Replace it with this one? To keep both, change the {KIND_LABEL[docK]} version first.</> })) === "confirm";
      const exists = folder.files.some((f) => f.name.toLowerCase() === name.toLowerCase());
      if (exists && !own && !(await askReplace())) return false;
      let saved;
      try {
        saved = await saveProject(folder, name, text, own || exists);
      } catch (e) { // created by someone else since the folder was listed
        if (!(e instanceof ProjectFileError) || e.kind !== "exists") throw e;
        if (!(await askReplace())) return false;
        saved = await saveProject(folder, name, text, true);
      }
      dispatch({ type: "saved", fileName: saved.name, handle: { project: saved.name, kind: docK } });
      storage.remove(DRAFT_KEY);
      void refreshFolder(docK);
      toast(`Saved ${saved.path}`, "success");
      return true;
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, "error");
      return false;
    }
  }

  const restoreDraft = () => {
    if (!draftOffer) return;
    try {
      dispatch({ type: "load", doc: documentFromJson(draftOffer.json), fileName: draftOffer.fileName, handle: null, dirty: true });
      resetValidationView(true);
      toast("Restored your unsaved work", "success");
    } catch { toast("The recovery draft could not be restored", "error"); }
    setDraftOffer(null);
  };
  const discardDraft = () => { storage.remove(DRAFT_KEY); setDraftOffer(null); };

  // ---- keyboard shortcuts ---------------------------------------------------------
  const handlers = useRef<Record<string, () => void>>({});
  handlers.current = {
    save: () => void save(), open: () => void open(), new: () => void newDoc(),
    undo: () => dispatch({ type: "undo" }), redo: () => dispatch({ type: "redo" }), validate,
    duplicate: () => duplicate(selected),
    details: () => setDetailsOpen((o) => !o),
    settings: () => setSettingsAt((s) => s ?? "features"),
    menu: () => openMenuFor(selected),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const h = handlers.current;
      const run = (name: string) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur?.(); h[name](); };
      if (e.key === "F5" || (mod && e.key === "Enter")) return run("validate");
      if (e.key === "F1") { e.preventDefault(); h.details(); return; }
      if (!mod) { if (e.key === "Insert") { e.preventDefault(); h.menu(); } return; }
      if (k === "s") return run("save");
      if (k === "o") return run("open");
      if (k === "n" && (e.altKey || isDesktop)) return run("new");
      if (k === "z" && !e.shiftKey) { e.preventDefault(); h.undo(); return; }
      if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); h.redo(); return; }
      if (k === "d") return run("duplicate");
      if (e.key === ",") return run("settings");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- drag & drop a JSON file onto the window --------------------------------------
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (!(await askDiscard())) return;
    load(await f.text(), f.name, null);
  };

  const startSidebarDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = sidebarW;
    const move = (ev: MouseEvent) => setSidebarW(Math.max(220, Math.min(560, w0 + ev.clientX - x0)));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const targetName = configFileName(root);
  const renamed = !!state.fileName && isProjectHandle(state.fileHandle) && state.fileName.toLowerCase() !== targetName.toLowerCase();
  const sep = projects?.dir.includes("\\") ? "\\" : "/";

  return (
    <div className="app" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }} onDrop={onDrop}>
      {/* ------------------------------------------------ toolbar */}
      <header className="toolbar">
        <div className="brand"><AppLogo size={26} /><div><b>{APP}</b><span>Camera Configuration Editor</span></div></div>
        <div className="tb-group">
          <button className="tb" id="file-menu-btn" aria-haspopup="menu" onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4, minWidth: 250, items: [
              { kind: "submenu", label: "New", icon: "file", items: [
                { label: "Project", nodeIcon: "project", hint: "Project configuration", shortcut: `${isDesktop ? MOD : "Alt+" + MOD}N`, onSelect: () => void newDoc() },
                { label: "Tester", nodeIcon: "tester", hint: "Tester configuration for a project", onSelect: () => void newTester() },
              ] },
              { kind: "submenu", label: "Open", icon: "folder", items: [
                { label: "Project…", nodeIcon: "project", hint: "From the project configuration folder", shortcut: kind === "project" ? `${MOD}O` : undefined, onSelect: () => void open("project") },
                { label: "Tester…", nodeIcon: "tester", hint: "From the tester configuration folder", shortcut: kind === "tester" ? `${MOD}O` : undefined, onSelect: () => void open("tester") },
              ] },
              { label: "Open sample project", icon: "sample", onSelect: () => void openSample() },
              { kind: "separator" },
              { label: `Save as ${targetName}`, icon: "save", shortcut: `${MOD}S`, onSelect: () => void save() },
              { kind: "separator" },
              { label: "Settings…", icon: "gear", shortcut: `${MOD},`, onSelect: () => setSettingsAt("features") },
              { kind: "separator" },
              { label: "Keyboard shortcuts", icon: "keyboard", onSelect: () => void confirm({ title: "Keyboard shortcuts", confirmLabel: "Close", cancelLabel: "OK", message: <Shortcuts /> }) },
            ] });
          }}>
            <Icon name="menu" /><span>File</span><Icon name="chevronDown" size={13} />
          </button>
          <TB icon="save" label="Save" kbd={`${MOD}S`} onClick={() => save()} accent={state.dirty}
            title={`Save ${projects?.canSave ? `to ${projects.dir}${sep}${targetName}` : `(download ${targetName})`} (${MOD}S)`} />
        </div>
        <div className="tb-group">
          <TB icon="undo" label="Undo" kbd={`${MOD}Z`} onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} iconOnly />
          <TB icon="redo" label="Redo" kbd={`${MOD}Y`} onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} iconOnly />
        </div>
        <div className="tb-group">
          <TB icon="check" label="Validate" kbd="F5" onClick={validate} />
        </div>
        <span className="spacer" />
        <div className="file-chip" title={renamed
          ? `Open: ${state.fileName}. ${kind === "tester" ? "Tester" : "Project"} name or version changed – Save writes ${targetName} (the old file is kept)`
          : projects?.canSave ? `${projects.dir}${sep}${targetName}` : targetName}>
          {state.dirty && <span className="dirty-dot" title="Unsaved changes" />}
          {renamed && <><span className="file-old">{state.fileName}</span><Icon name="chevronRight" size={12} /></>}
          <span>{targetName}</span>
        </div>
        <div className="seg theme-seg" role="radiogroup" aria-label="Appearance">
          <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")} title="Dark theme" aria-checked={theme === "dark"} role="radio"><Icon name="moon" size={14} /><span>Dark</span></button>
          <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")} title="Light theme" aria-checked={theme === "light"} role="radio"><Icon name="sun" size={14} /><span>Light</span></button>
        </div>
        <button className={`tb tb-toggle ${detailsOpen ? "on" : ""}`} onClick={() => setDetailsOpen(!detailsOpen)} title="Show / hide the Details pane (F1)" aria-pressed={detailsOpen}>
          <Icon name="info" /><span>Details</span>
        </button>
      </header>

      {draftOffer && (
        <div className="draft-bar">
          <Icon name="restore" />
          <span>Unsaved work{draftOffer.fileName ? ` on “${draftOffer.fileName}”` : ""} from {new Date(draftOffer.time).toLocaleString()} was found.</span>
          <button className="btn btn-sm btn-primary" onClick={restoreDraft}>Restore</button>
          <button className="btn btn-sm" onClick={discardDraft}>Discard</button>
        </div>
      )}

      {/* ------------------------------------------------ main */}
      <div className="main">
        <aside className="sidebar" style={{ width: sidebarW }}>
          <div className="sidebar-head">
            <span>Configuration</span>
            <span className="spacer" />
            <button className="icon-btn" title="Expand all" onClick={() => setCollapsed(new Set())}><Icon name="expand" size={14} /></button>
            <button className="icon-btn" title="Collapse all" onClick={() => setCollapsed(new Set([...walk(root)].filter((n) => n !== root && n.children.length).map((n) => n.id)))}><Icon name="collapse" size={14} /></button>
          </div>
          <Tree root={root} selectedId={selected.id} collapsed={collapsed} severity={subtreeSev} ownCount={ownCount}
            onSelect={select} onToggle={toggle} onContext={openContext} onDelete={deleteNode} />
          <BuildGuide steps={guideSteps} onStep={runStep} open={guideOpen} onToggle={() => setGuideOpen(!guideOpen)} />
        </aside>
        <div className="sidebar-resizer" onMouseDown={startSidebarDrag} />
        <main className="content" onFocusCapture={(e) => {
          const a = parseInputId((e.target as HTMLElement).id ?? "", selected.id);
          if (a) setActiveInput(a);
        }}
          onChangeCapture={(e) => markTouched((e.target as HTMLElement).id ?? "")}
          onBlurCapture={(e) => markTouched((e.target as HTMLElement).id ?? "")}>
          <Editor node={selected} idx={idx} issues={byNode.get(selected.id) ?? []} mutate={mutate} onNodeMenu={(n, x, y) => openContext(n, x, y)}
            onSelect={select} focus={focus} toast={toast} detailsOpen={detailsOpen} catalog={catalog} />
        </main>
        {detailsOpen && (
          <DetailsPane node={selected} idx={idx} issues={byNode.get(selected.id) ?? []} active={activeInput} catalog={catalog}
            width={detailsW} onResize={setDetailsW} onClose={() => setDetailsOpen(false)} />
        )}
      </div>

      <BottomPanel tab={bottomTab} setTab={setBottomTab} height={bottomH} setHeight={setBottomH} issues={issues} idx={idx}
        onIssue={gotoIssue} previewNode={selected} wholeDoc={() => documentToText(state.doc)}
        docJson={(n) => JSON.stringify(n === root ? documentToJson(state.doc) : nodeToJson(n), null, 2)} quiet={!revealAll} />

      <footer className="statusbar">
        <span className="status-item"><Icon name={isDesktop ? "desktop" : "globe"} size={13} />{platformName}</span>
        <span className="status-item">{kind === "tester" ? `Tester · ${String(root.params.project || "no project")}` : `Schema ${String(root.params.schemaVersion ?? "")}`}</span>
        <span className="status-item">{state.dirty ? "Unsaved changes" : state.fileName ? "Saved" : "Not saved yet"}</span>
        <span className="spacer" />
        <button className="status-item status-btn" onClick={() => setBottomTab("problems")}>
          <span className="dot dot-error" />{nErr} error{nErr === 1 ? "" : "s"}
          <span className="dot dot-warning" />{nWarn} warning{nWarn === 1 ? "" : "s"}
          {!revealAll && issues.length > visibleIssues.length && <span className="muted"> · press F5 to show all</span>}
        </button>
      </footer>

      {menu && <Menu menu={menu} onClose={() => setMenu(null)} />}
      {pickProject && <PickProjectDialog dir={pickProject.dir} files={pickProject.files} error={pickProject.error}
        onPick={createTester} onCancel={() => setPickProject(null)} />}
      {openList && <OpenDialog listing={openList} title={`Open ${openList.kind} configuration`}
        current={isProjectHandle(state.fileHandle) && (state.fileHandle.kind ?? "project") === openList.kind ? state.fileHandle.project : null}
        onOpen={(n) => void openFromFolder(n)} onBrowse={() => void browse()} onClose={() => setOpenList(null)} />}
      {settingsAt && (
        <SettingsWindow key={uiFile?.modified ?? 0} catalog={baseCatalog} usage={catalogUsage(root)} initialSection={settingsAt}
          storage={uiFile} onReload={() => void reloadUiConfig(true)}
          onApply={(c, r) => void applySettings(c, r)} onClose={() => setSettingsAt(null)} />
      )}
      {dragOver && <div className="drop-overlay"><Icon name="folder" size={40} /><span>Drop a configuration JSON to open it</span></div>}
    </div>
  );
}

function TB({ icon, label, kbd, onClick, disabled, iconOnly, accent, danger, title }: {
  icon: Parameters<typeof Icon>[0]["name"]; label: string; kbd?: string; onClick: () => void;
  disabled?: boolean; iconOnly?: boolean; accent?: boolean; danger?: boolean; title?: string;
}) {
  return (
    <button className={`tb ${iconOnly ? "tb-icon" : ""} ${accent ? "tb-accent" : ""} ${danger ? "tb-danger" : ""}`} onClick={onClick}
      disabled={disabled} title={title ?? (kbd ? `${label} (${kbd})` : label)} aria-label={label}>
      <Icon name={icon} />{!iconOnly && <span>{label}</span>}
    </button>
  );
}

function Shortcuts() {
  const rows: Array<[string, string]> = [
    [`${isDesktop ? MOD : "Alt+" + MOD}N`, "New project"], [`${MOD}O`, "Open (project or tester, like the open file)"], [`${MOD}S`, "Save (<project>_v<version>.json)"],
    [`${MOD}Z / ${MOD}Y`, "Undo / Redo"], ["F5 or " + MOD + "Enter", "Validate"], ["Right-click / Shift+F10 / Insert", "Node menu: add, duplicate, delete"],
    ["F1", "Show / hide the Details pane"], [`${MOD},`, "Settings (dropdown lists)"], ["↑ ↓ ← →", "Navigate the tree"], ["Del (tree focused)", "Delete node"], [`${MOD}D`, "Duplicate camera / VC"],
  ];
  return <table className="shortcuts"><tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>;
}
