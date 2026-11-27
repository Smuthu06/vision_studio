import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeSteps, type BuildStep } from "./core/guide";
import {
  canDelete, childOptions, defOf, documentFromJson, documentFromText, documentToJson, documentToText, LoadError,
  newDocument, nodeLabel, nodeToJson, TreeIndex, validateTree, walk, type ChildOption, type CNode, type Issue,
} from "./core/model";
import { RANK, type Severity } from "./core/schema";
import { guardClose, isDesktop, openFile, platformName, saveFile, setWindowTitle, storage } from "./platform";
import { initialState, useAppStore } from "./state/store";
import { Editor, type FocusRequest } from "./ui/Editor";
import { AppLogo, Icon, NodeIcon } from "./ui/icons";
import { Menu, OverlayProvider, useOverlay, type MenuItem, type MenuState } from "./ui/overlays";
import { BottomPanel, BuildGuide } from "./ui/Panels";
import { Tree } from "./ui/Tree";
import { DetailsPane, parseInputId, type ActiveInput } from "./ui/DetailsPane";
import sample from "./assets/sample.json";

const APP = "Vision Studio";
const DRAFT_KEY = "vision-studio.draft";
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
  const idx = useMemo(() => new TreeIndex(root), [root]);
  const issues = useMemo(() => validateTree(root, idx), [root, idx]);
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
  const [tipOpen, setTipOpen] = useState(() => storage.get("vision-studio.tip") !== "dismissed");
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

  // ---- derived issue maps ------------------------------------------------
  const { subtreeSev, ownCount, byNode } = useMemo(() => {
    const byNode = new Map<string, Issue[]>();
    for (const i of issues) byNode.set(i.nodeId, [...(byNode.get(i.nodeId) ?? []), i]);
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
  }, [issues, root]);
  const nErr = issues.filter((i) => i.severity === "error").length;
  const nWarn = issues.length - nErr;

  // ---- effects -------------------------------------------------------------
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storage.set("vision-studio.theme", theme);
  }, [theme]);

  useEffect(() => { storage.set("vision-studio.details", detailsOpen ? "open" : "closed"); }, [detailsOpen]);
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
    if (r === "confirm") return save(false);
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
    toast(`Added ${nodeLabel(node)}`, "success");
    if (tipOpen) dismissTip();
  };

  const deleteNode = async (node: CNode) => {
    if (!canDelete(node, idx)) { toast(`${defOf(node).title} cannot be deleted`, "info"); return; }
    const n = [...walk(node)].length - 1;
    const r = await confirm({ title: "Delete node", danger: true, confirmLabel: "Delete",
      message: <>Delete <b>{nodeLabel(node)}</b>{n ? ` and its ${n} child node${n > 1 ? "s" : ""}` : ""}? You can undo this with {MOD}Z.</> });
    if (r === "confirm") { dispatch({ type: "delete", id: node.id }); toast(`Deleted ${nodeLabel(node)}`); }
  };

  const duplicate = (node: CNode) => {
    if (!defOf(node).duplicable) return;
    dispatch({ type: "duplicate", id: node.id });
    toast(`Duplicated ${nodeLabel(node)}`, "success");
  };

  const openContext = (node: CNode, x: number, y: number) => {
    const items: MenuItem[] = [{ kind: "header", label: nodeLabel(node), nodeIcon: defOf(node).icon }];
    const opts = childOptions(node, idx);
    for (const o of opts) items.push({ label: o.label, nodeIcon: o.icon, hint: o.enabled ? o.description : o.reason, disabled: !o.enabled, onSelect: () => addChild(node, o) });
    if (opts.length) items.push({ kind: "separator" });
    const parent = idx.parentOf(node);
    if (!opts.length && parent) {
      const popts = childOptions(parent, idx).filter((o) => o.type === node.type || o.enabled);
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

  const dismissTip = () => { setTipOpen(false); storage.set("vision-studio.tip", "dismissed"); };

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
      if (doc.root.children.length) dismissTip();
      storage.remove(DRAFT_KEY);
      const n = validateTree(doc.root).filter((i) => i.severity === "error").length;
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
    toast("New project – start with the project information");
  };
  const open = async () => {
    if (!(await askDiscard())) return;
    try {
      const r = await openFile();
      if (r) load(r.text, r.name, r.handle);
    } catch (e) { toast(`Open failed: ${(e as Error).message}`, "error"); }
  };
  const openSample = async () => {
    if (!(await askDiscard())) return;
    dispatch({ type: "load", doc: documentFromJson(sample), fileName: null, handle: null });
    setCollapsed(new Set());
    dismissTip();
    toast("Loaded the sample project (save it under a new name)", "success");
  };

  async function save(as: boolean): Promise<boolean> {
    const st = stateRef.current;
    const errs = validateTree(st.doc.root).filter((i) => i.severity === "error").length;
    if (errs) {
      const r = await confirm({ title: "Configuration has errors", confirmLabel: "Save anyway",
        message: `${errs} validation error(s) remain. The file will not conform to the schema until they are fixed.` });
      if (r !== "confirm") { setBottomTab("problems"); return false; }
    }
    const name = st.fileName ?? `${st.doc.root.params.project || "project"}.json`;
    try {
      const r = await saveFile(documentToText(st.doc), name, st.fileHandle, as);
      if (!r) return false;
      dispatch({ type: "saved", fileName: r.name, handle: r.handle });
      storage.remove(DRAFT_KEY);
      toast(r.downloaded ? `Downloaded ${r.name}` : `Saved ${r.name}`, "success");
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
      toast("Restored your unsaved work", "success");
    } catch { toast("The recovery draft could not be restored", "error"); }
    setDraftOffer(null);
  };
  const discardDraft = () => { storage.remove(DRAFT_KEY); setDraftOffer(null); };

  // ---- keyboard shortcuts ---------------------------------------------------------
  const handlers = useRef<Record<string, () => void>>({});
  handlers.current = {
    save: () => void save(false), saveAs: () => void save(true), open: () => void open(), new: () => void newDoc(),
    undo: () => dispatch({ type: "undo" }), redo: () => dispatch({ type: "redo" }), validate,
    duplicate: () => duplicate(selected),
    details: () => setDetailsOpen((o) => !o),
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
      if (k === "s") return run(e.shiftKey ? "saveAs" : "save");
      if (k === "o") return run("open");
      if (k === "n" && (e.altKey || isDesktop)) return run("new");
      if (k === "z" && !e.shiftKey) { e.preventDefault(); h.undo(); return; }
      if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); h.redo(); return; }
      if (k === "d") return run("duplicate");
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

  const isNewProject = root.children.length === 0;

  return (
    <div className="app" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }} onDrop={onDrop}>
      {/* ------------------------------------------------ toolbar */}
      <header className="toolbar">
        <div className="brand"><AppLogo size={26} /><div><b>{APP}</b><span>Camera Configuration Editor</span></div></div>
        <div className="tb-group">
          <TB icon="file" label="New" kbd={`${isDesktop ? MOD : "Alt+" + MOD}N`} onClick={newDoc} />
          <TB icon="folder" label="Open" kbd={`${MOD}O`} onClick={open} />
          <TB icon="save" label="Save" kbd={`${MOD}S`} onClick={() => save(false)} accent={state.dirty} />
          <TB icon="saveAs" label="Save As" kbd={`${MOD}Shift+S`} onClick={() => save(true)} iconOnly />
          <TB icon="sample" label="Open sample project" onClick={openSample} iconOnly />
        </div>
        <div className="tb-group">
          <TB icon="undo" label="Undo" kbd={`${MOD}Z`} onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} iconOnly />
          <TB icon="redo" label="Redo" kbd={`${MOD}Y`} onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} iconOnly />
        </div>
        <div className="tb-group">
          <TB icon="check" label="Validate" kbd="F5" onClick={validate} />
        </div>
        <span className="spacer" />
        <div className="file-chip" title={state.fileName ?? "Not saved yet"}>
          {state.dirty && <span className="dirty-dot" title="Unsaved changes" />}
          <span>{state.fileName ?? "Untitled"}</span>
        </div>
        <div className="seg theme-seg" role="radiogroup" aria-label="Appearance">
          <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")} title="Dark theme" aria-checked={theme === "dark"} role="radio"><Icon name="moon" size={14} /><span>Dark</span></button>
          <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")} title="Light theme" aria-checked={theme === "light"} role="radio"><Icon name="sun" size={14} /><span>Light</span></button>
        </div>
        <TB icon="info" label="Details pane" kbd="F1" onClick={() => setDetailsOpen(!detailsOpen)} accent={detailsOpen} iconOnly />
        <TB icon="keyboard" label="Keyboard shortcuts" onClick={() => confirm({ title: "Keyboard shortcuts", confirmLabel: "Close", cancelLabel: "OK", message: <Shortcuts /> })} iconOnly />
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
          {tipOpen && (
            <div className="tip">
              <Icon name="mouse" size={18} />
              <div><b>Build step by step</b><span>Right-click a node (or press <kbd>Shift+F10</kbd>) to add its children. Start by filling in the project information.</span></div>
              <button className="icon-btn" onClick={dismissTip} title="Dismiss"><Icon name="x" size={14} /></button>
            </div>
          )}
          <BuildGuide steps={steps} onStep={runStep} open={guideOpen} onToggle={() => setGuideOpen(!guideOpen)} />
        </aside>
        <div className="sidebar-resizer" onMouseDown={startSidebarDrag} />
        <main className="content" onFocusCapture={(e) => {
          const a = parseInputId((e.target as HTMLElement).id ?? "", selected.id);
          if (a) setActiveInput(a);
        }}>
          <Editor node={selected} idx={idx} issues={byNode.get(selected.id) ?? []} mutate={mutate} onNodeMenu={(n, x, y) => openContext(n, x, y)}
            onSelect={select} focus={focus} toast={toast} />
          {isNewProject && selected === root && <div className="welcome-note"><NodeIcon name="project" size={16} /> New project: only the project information exists so far. Add sections when you are ready.</div>}
        </main>
        {detailsOpen && (
          <DetailsPane node={selected} idx={idx} issues={byNode.get(selected.id) ?? []} active={activeInput}
            width={detailsW} onResize={setDetailsW} onClose={() => setDetailsOpen(false)} />
        )}
      </div>

      <BottomPanel tab={bottomTab} setTab={setBottomTab} height={bottomH} setHeight={setBottomH} issues={issues} idx={idx}
        onIssue={gotoIssue} previewNode={selected} wholeDoc={() => documentToText(state.doc)}
        docJson={(n) => JSON.stringify(n === root ? documentToJson(state.doc) : nodeToJson(n), null, 2)} />

      <footer className="statusbar">
        <span className="status-item"><Icon name={isDesktop ? "desktop" : "globe"} size={13} />{platformName}</span>
        <span className="status-item">Schema {String(root.params.schemaVersion ?? "")}</span>
        <span className="status-item">{state.dirty ? "Unsaved changes" : state.fileName ? "Saved" : "Not saved yet"}</span>
        <span className="spacer" />
        <button className="status-item status-btn" onClick={() => setBottomTab("problems")}>
          <span className="dot dot-error" />{nErr} error{nErr === 1 ? "" : "s"}
          <span className="dot dot-warning" />{nWarn} warning{nWarn === 1 ? "" : "s"}
        </button>
      </footer>

      {menu && <Menu menu={menu} onClose={() => setMenu(null)} />}
      {dragOver && <div className="drop-overlay"><Icon name="folder" size={40} /><span>Drop a configuration JSON to open it</span></div>}
    </div>
  );
}

function TB({ icon, label, kbd, onClick, disabled, iconOnly, accent, danger }: {
  icon: Parameters<typeof Icon>[0]["name"]; label: string; kbd?: string; onClick: () => void;
  disabled?: boolean; iconOnly?: boolean; accent?: boolean; danger?: boolean;
}) {
  return (
    <button className={`tb ${iconOnly ? "tb-icon" : ""} ${accent ? "tb-accent" : ""} ${danger ? "tb-danger" : ""}`} onClick={onClick}
      disabled={disabled} title={kbd ? `${label} (${kbd})` : label} aria-label={label}>
      <Icon name={icon} />{!iconOnly && <span>{label}</span>}
    </button>
  );
}

function Shortcuts() {
  const rows: Array<[string, string]> = [
    [`${isDesktop ? MOD : "Alt+" + MOD}N`, "New project"], [`${MOD}O`, "Open"], [`${MOD}S`, "Save"], [`${MOD}Shift+S`, "Save As"],
    [`${MOD}Z / ${MOD}Y`, "Undo / Redo"], ["F5 or " + MOD + "Enter", "Validate"], ["Right-click / Shift+F10 / Insert", "Node menu: add, duplicate, delete"],
    ["F1", "Show / hide the Details pane"], ["↑ ↓ ← →", "Navigate the tree"], ["Del (tree focused)", "Delete node"], [`${MOD}D`, "Duplicate camera / VC"],
  ];
  return <table className="shortcuts"><tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>;
}
