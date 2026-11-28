/** Settings window: edits the option lists (catalog) behind the editor's dropdowns. */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  builtInFeature, defaultCatalog, normalizeCatalog, normHex, SECTIONS, usageKey,
  type Catalog, type CatalogOption, type Rename, type SettingsSection,
} from "../core/catalog";
import type { CatalogSource } from "../core/schema";
import { openFile, saveFile, type UiConfigState } from "../platform";
import { Icon, NodeIcon } from "./icons";
import { useOverlay } from "./overlays";
import type { IconName } from "../core/model";

// --------------------------------------------------------------------------
// Draft model: every row has a stable id and remembers its original value,
// so renames can be detected and offered to the open configuration.
// --------------------------------------------------------------------------
interface DItem { id: string; value: string; description: string; orig?: string }
interface DModel { id: string; name: string; description: string; orig?: string; serializers: DItem[]; deserializers: DItem[] }
interface DMan { id: string; name: string; orig?: string; models: DModel[] }
interface Draft {
  features: DItem[]; imagers: DItem[]; serializers: DItem[]; hardware: DMan[]; imageFormats: DItem[]; dataTypes: DItem[];
  fpgaDevices: DItem[]; boardDefaults: DItem[];
}
type ListKey = "features" | "imagers" | "serializers" | "imageFormats" | "dataTypes" | "fpgaDevices" | "boardDefaults";

let seq = 0;
const nid = () => `s${++seq}`;
const item = (o: CatalogOption | string, keepOrig: boolean): DItem => {
  const v = typeof o === "string" ? o : o.value;
  return { id: nid(), value: v, description: typeof o === "string" ? "" : o.description ?? "", orig: keepOrig ? v : undefined };
};

function toDraft(c: Catalog, keepOrig = true): Draft {
  const list = (os: CatalogOption[]) => os.map((o) => item(o, keepOrig));
  return {
    features: list(c.features), imagers: list(c.imagers), serializers: list(c.serializers),
    imageFormats: list(c.imageFormats), dataTypes: list(c.dataTypes),
    fpgaDevices: list(c.fpgaDevices ?? []), boardDefaults: list(c.boardDefaults ?? []),
    hardware: c.hardware.map((m) => ({
      id: nid(), name: m.name, orig: keepOrig ? m.name : undefined,
      models: m.models.map((md) => ({
        id: nid(), name: md.name, description: md.description ?? "", orig: keepOrig ? md.name : undefined,
        serializers: md.serializers.map((s) => item(s, keepOrig)), deserializers: md.deserializers.map((s) => item(s, keepOrig)),
      })),
    })),
  };
}

const clean = (v: string) => v.trim();
function fromDraft(d: Draft): Catalog {
  const opts = (xs: DItem[], hex = false): CatalogOption[] => xs.map((x) => {
    const value = hex ? normHex(x.value) ?? clean(x.value) : clean(x.value);
    return x.description.trim() ? { value, description: x.description.trim() } : { value };
  });
  return {
    version: 1,
    features: opts(d.features), imagers: opts(d.imagers), serializers: opts(d.serializers),
    imageFormats: opts(d.imageFormats), dataTypes: opts(d.dataTypes, true),
    fpgaDevices: opts(d.fpgaDevices), boardDefaults: opts(d.boardDefaults),
    hardware: d.hardware.map((m) => ({
      name: clean(m.name),
      models: m.models.map((md) => ({
        name: clean(md.name), ...(md.description.trim() ? { description: md.description.trim() } : {}),
        serializers: md.serializers.map((s) => clean(s.value)), deserializers: md.deserializers.map((s) => clean(s.value)),
      })),
    })),
  };
}

/** Errors per row id: empty values, duplicates, invalid hex. */
function draftErrors(d: Draft): Map<string, string> {
  const errs = new Map<string, string>();
  const check = (rows: Array<{ id: string; v: string }>, what: string, hex = false) => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const v = clean(r.v);
      if (!v) { errs.set(r.id, `${what} cannot be empty`); continue; }
      if (hex && !normHex(v)) { errs.set(r.id, "Use a hex value 0x00–0x3F, e.g. 0x2A"); continue; }
      const key = (hex ? normHex(v)! : v).toLowerCase();
      if (seen.has(key)) errs.set(r.id, `Duplicate ${what.toLowerCase()} '${v}'`);
      else seen.set(key, r.id);
    }
  };
  const vals = (xs: DItem[]) => xs.map((x) => ({ id: x.id, v: x.value }));
  check(vals(d.features), "Feature");
  check(vals(d.imagers), "Imager");
  check(vals(d.serializers), "Serializer");
  check(vals(d.imageFormats), "Format");
  check(vals(d.dataTypes), "Data type", true);
  check(vals(d.fpgaDevices), "FPGA device");
  check(vals(d.boardDefaults), "Board defaults");
  check(d.hardware.map((m) => ({ id: m.id, v: m.name })), "Manufacturer");
  for (const m of d.hardware) {
    check(m.models.map((md) => ({ id: md.id, v: md.name })), "Model");
    for (const md of m.models) { check(vals(md.serializers), "Serializer"); check(vals(md.deserializers), "Deserializer"); }
  }
  return errs;
}

function renamesOf(d: Draft): Rename[] {
  const out: Rename[] = [];
  const list = (xs: DItem[], source: CatalogSource, hex = false, scope: Partial<Rename> = {}) => {
    for (const x of xs) {
      if (x.orig === undefined) continue;
      const to = hex ? normHex(x.value) : clean(x.value);
      if (to && to !== x.orig) out.push({ source, from: x.orig, to, ...scope });
    }
  };
  list(d.features, "features"); list(d.imagers, "imagers"); list(d.serializers, "serializers");
  list(d.imageFormats, "imageFormats"); list(d.dataTypes, "dataTypes", true);
  list(d.fpgaDevices, "fpgaDevices"); list(d.boardDefaults, "boardDefaults");
  for (const m of d.hardware) {
    if (m.orig !== undefined && clean(m.name) && clean(m.name) !== m.orig) out.push({ source: "manufacturers", from: m.orig, to: clean(m.name) });
    for (const md of m.models) {
      if (m.orig === undefined) continue;
      if (md.orig !== undefined && clean(md.name) && clean(md.name) !== md.orig) out.push({ source: "models", from: md.orig, to: clean(md.name), manufacturer: m.orig });
      if (md.orig === undefined) continue;
      list(md.serializers, "hwSerializers", false, { manufacturer: m.orig, model: md.orig });
      list(md.deserializers, "hwDeserializers", false, { manufacturer: m.orig, model: md.orig });
    }
  }
  return out;
}

const SECTION_ICON: Record<SettingsSection, IconName> = {
  features: "mode", imagers: "camera", serializers: "chip", hardware: "hardware", imageFormats: "stream", dataTypes: "film",
  fpgaDevices: "chip", boardDefaults: "testerCamera",
};

// --------------------------------------------------------------------------
// Window
// --------------------------------------------------------------------------
export interface SettingsProps {
  catalog: Catalog;
  usage: Map<string, number>;
  initialSection?: SettingsSection;
  onApply: (catalog: Catalog, renames: Rename[]) => void;
  onClose: () => void;
  storage: UiConfigState | null;   // ui_config.json location / permissions
  onReload: () => void;
}

export function SettingsWindow({ catalog, usage, initialSection = "features", onApply, onClose, storage, onReload }: SettingsProps) {
  const readOnly = storage ? !storage.canSave : false;
  const { confirm, toast } = useOverlay();
  const [draft, setDraft] = useState<Draft>(() => toDraft(catalog));
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const startJson = useRef(JSON.stringify(catalog));
  const errors = useMemo(() => draftErrors(draft), [draft]);
  const result = useMemo(() => fromDraft(draft), [draft]);
  const dirty = JSON.stringify(result) !== startJson.current;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const sectionErrors = (s: SettingsSection) => {
    const ids = new Set<string>();
    const add = (xs: Array<{ id: string }>) => xs.forEach((x) => ids.add(x.id));
    if (s === "hardware") draft.hardware.forEach((m) => { ids.add(m.id); m.models.forEach((md) => { ids.add(md.id); add(md.serializers); add(md.deserializers); }); });
    else add(draft[s]);
    return [...ids].filter((id) => errors.has(id)).length;
  };
  const count = (s: SettingsSection) => (s === "hardware" ? draft.hardware.reduce((n, m) => n + m.models.length, 0) : draft[s].length);

  const close = async () => {
    if (dirty && (await confirm({ title: "Discard changes?", message: "Your changes to the settings have not been applied.", confirmLabel: "Discard", danger: true })) !== "confirm") return;
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".modal")) { e.preventDefault(); void close(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const apply = () => { if (!errors.size && !readOnly) onApply(result, renamesOf(draft)); };
  const reload = async () => {
    if (dirty && (await confirm({ title: "Reload the lists?", message: "Your unapplied changes will be discarded.", confirmLabel: "Reload", danger: true })) !== "confirm") return;
    onReload();
  };
  const resetAll = async () => {
    if ((await confirm({ title: "Reset all lists?", message: "Replace every list with the shipped defaults. Values used in the open configuration that are not in the defaults will be flagged.", confirmLabel: "Reset", danger: true })) === "confirm")
      setDraft(toDraft(defaultCatalog(), false));
  };
  const doImport = async () => {
    try {
      const f = await openFile();
      if (!f) return;
      const { catalog: c, warnings } = normalizeCatalog(JSON.parse(f.text));
      setDraft(toDraft(c, false));
      toast(warnings.length ? `Imported ${f.name} with ${warnings.length} note(s): ${warnings[0]}` : `Imported ${f.name} – press Apply to use it`, warnings.length ? "info" : "success");
    } catch (e) { toast(`Could not import settings: ${(e as Error).message}`, "error"); }
  };
  const doExport = async () => {
    try {
      const r = await saveFile(JSON.stringify(result, null, 2) + "\n", "vision-studio-settings.json", null, true);
      if (r) toast(r.downloaded ? `Downloaded ${r.name}` : `Exported ${r.name}`, "success");
    } catch (e) { toast(`Export failed: ${(e as Error).message}`, "error"); }
  };

  const meta = SECTIONS.find((s) => s.id === section)!;
  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && void close()}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="settings-head">
          <Icon name="gear" size={18} />
          <div><h2>Settings</h2><span className="muted small">Lists offered in the editor's dropdowns. Changes apply to every configuration.</span></div>
          <span className="spacer" />
          <button className="icon-btn" onClick={() => void close()} title="Close (Esc)"><Icon name="x" /></button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => {
              const n = sectionErrors(s.id);
              return (
                <button key={s.id} className={`settings-tab ${section === s.id ? "on" : ""}`} onClick={() => setSection(s.id)}>
                  <NodeIcon name={SECTION_ICON[s.id]} size={16} />
                  <span>{s.title}</span>
                  {n > 0 ? <span className="count count-err">{n}</span> : <span className="count">{count(s.id)}</span>}
                </button>
              );
            })}
          </nav>
          <section className="settings-main">
            {readOnly && (
              <div className="banner banner-warning settings-banner"><Icon name="info" size={16} />
                <div className="banner-body">These lists come from <code>{storage?.path}</code> on the PC running Vision Studio and are read-only here.
                  Changes can only be saved on that PC.</div></div>
            )}
            {storage?.error && (
              <div className="banner banner-error settings-banner"><Icon name="error" size={16} />
                <div className="banner-body">{storage.error}. The built-in lists are shown; Apply replaces the file with them.</div></div>
            )}
            <h3>{meta.title}</h3>
            <p className="muted">{meta.help}</p>
            <fieldset className="settings-fields" disabled={readOnly}>
            {section === "hardware"
              ? <HardwareEditor hardware={draft.hardware} onChange={(h) => set("hardware", h)} usage={usage} errors={errors} />
              : <ListEditor key={section} items={draft[section as ListKey]} onChange={(xs) => set(section as ListKey, xs)}
                  errors={errors} hex={section === "dataTypes"}
                  usageOf={(x) => (x.orig === undefined ? 0 : usage.get(usageKey(SOURCE_OF[section as ListKey], x.orig)) ?? 0)}
                  lockedReason={section === "features" ? (x) => (builtInFeature(x.orig ?? x.value) ? "Built-in: switches the EMC parameters of camera models on and off" : undefined) : undefined}
                  valueLabel={VALUE_LABEL[section as ListKey]} placeholder={PLACEHOLDER[section as ListKey]} />}
            </fieldset>
          </section>
        </div>
        <footer className="settings-foot">
          <button className="btn btn-sm" onClick={() => void doImport()} disabled={readOnly}><Icon name="folder" size={14} />Import…</button>
          <button className="btn btn-sm" onClick={() => void doExport()}><Icon name="save" size={14} />Export…</button>
          <button className="btn btn-sm btn-ghost" onClick={() => void resetAll()} disabled={readOnly}><Icon name="restore" size={14} />Reset to defaults</button>
          <span className="settings-source" title={storage?.path ?? undefined}>
            <Icon name={storage?.backend === "browser" || !storage ? "globe" : readOnly ? "info" : "save"} size={13} />
            {!storage || storage.backend === "browser" ? "Stored in this browser"
              : readOnly ? `Read-only · ${storage.path}` : storage.path}
            {storage && storage.backend !== "browser" && <button className="link small" onClick={() => void reload()}>Reload</button>}
          </span>
          <span className="spacer" />
          {errors.size > 0 && <span className="sev-error small"><Icon name="error" size={13} /> Fix {errors.size} entr{errors.size > 1 ? "ies" : "y"} to apply</span>}
          <button className="btn" onClick={() => void close()}>Cancel</button>
          <button className="btn btn-primary" disabled={!dirty || errors.size > 0 || readOnly} onClick={apply}
            title={readOnly ? "Read-only: change the lists on the PC running Vision Studio" : undefined}>Apply</button>
        </footer>
      </div>
    </div>
  );
}

const SOURCE_OF: Record<ListKey, CatalogSource> = { features: "features", imagers: "imagers", serializers: "serializers", imageFormats: "imageFormats", dataTypes: "dataTypes", fpgaDevices: "fpgaDevices", boardDefaults: "boardDefaults" };
const VALUE_LABEL: Record<ListKey, string> = { features: "Feature", imagers: "Imager", serializers: "Serializer IC", imageFormats: "Format", dataTypes: "Data type (hex)", fpgaDevices: "FPGA device", boardDefaults: "Board defaults" };
const PLACEHOLDER: Record<ListKey, string> = { features: "e.g. FrameCounterCheck", imagers: "e.g. IMX490", serializers: "e.g. MAX96717", imageFormats: "e.g. raw20", dataTypes: "e.g. 0x2E", fpgaDevices: "e.g. PXIe-1487", boardDefaults: "e.g. Default" };

// --------------------------------------------------------------------------
// Flat list editor (value + description)
// --------------------------------------------------------------------------
function ListEditor({ items, onChange, errors, usageOf, valueLabel, placeholder, hex, compact, title, lockedReason }: {
  items: DItem[]; onChange: (xs: DItem[]) => void; errors: Map<string, string>; usageOf: (x: DItem) => number;
  valueLabel: string; placeholder: string; hex?: boolean; compact?: boolean; title?: string;
  lockedReason?: (x: DItem) => string | undefined;
}) {
  const [adding, setAdding] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  const update = (id: string, patch: Partial<DItem>) => onChange(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => { const xs = [...items]; [xs[i], xs[i + d]] = [xs[i + d], xs[i]]; onChange(xs); };
  const add = () => {
    const v = adding.trim();
    if (!v) return;
    onChange([...items, { id: nid(), value: hex ? normHex(v) ?? v : v, description: "" }]);
    setAdding("");
    addRef.current?.focus();
  };
  const sortAZ = () => onChange([...items].sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true })));
  return (
    <div className={`list-editor ${compact ? "compact" : ""}`}>
      {title && <div className="list-editor-title"><b>{title}</b><span className="count">{items.length}</span>
        <span className="spacer" />{items.length > 1 && <button className="link small" onClick={sortAZ}>Sort A–Z</button>}</div>}
      {!title && items.length > 1 && <div className="list-tools"><button className="link small" onClick={sortAZ}>Sort A–Z</button></div>}
      <div className="list-rows">
        {!compact && items.length > 0 && <div className="list-row list-head"><span>{valueLabel}</span><span>Description (optional)</span><span>Used</span><span /></div>}
        {items.map((x, i) => {
          const err = errors.get(x.id);
          const used = usageOf(x);
          const renamed = x.orig !== undefined && x.value.trim() !== x.orig && !(hex && normHex(x.value) === x.orig);
          const locked = lockedReason?.(x);
          return (
            <div key={x.id} className={`list-row ${err ? "has-err" : ""}`}>
              <div className="cell-wrap">
                <input className={`inp ${err ? "has-error" : ""}`} value={x.value} aria-label={valueLabel} spellCheck={false}
                  readOnly={!!locked} title={locked}
                  onChange={(e) => update(x.id, { value: e.target.value })} onBlur={() => hex && normHex(x.value) && update(x.id, { value: normHex(x.value)! })} />
                {err && <span className="row-err">{err}</span>}
                {!err && locked && <span className="row-note"><Icon name="info" size={11} /> Built-in</span>}
                {!err && renamed && <span className="row-note">was {x.orig}</span>}
              </div>
              {!compact && <input className="inp" value={x.description} aria-label="Description" placeholder="—"
                onChange={(e) => update(x.id, { description: e.target.value })} />}
              <span className={`used ${used ? "" : "muted"}`} title={used ? `Used ${used}× in the open configuration` : "Not used in the open configuration"}>{used ? `${used}×` : "–"}</span>
              <span className="row-actions">
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up"><Icon name="arrowUp" size={13} /></button>
                <button className="icon-btn" disabled={i === items.length - 1} onClick={() => move(i, 1)} title="Move down"><Icon name="arrowDown" size={13} /></button>
                <button className="icon-btn danger" onClick={() => onChange(items.filter((y) => y.id !== x.id))} disabled={!!locked}
                  title={locked ?? (used ? `Remove – it is used ${used}× in the open configuration, those values will be flagged` : "Remove")}><Icon name="trash" size={13} /></button>
              </span>
            </div>
          );
        })}
        {!items.length && <div className="muted small list-empty">No entries yet.</div>}
      </div>
      <div className="list-add">
        <input ref={addRef} className="inp" value={adding} placeholder={`Add ${valueLabel.toLowerCase()} – ${placeholder}`} spellCheck={false}
          onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button className="btn btn-sm btn-primary" onClick={add} disabled={!adding.trim()}><Icon name="plus" size={14} />Add</button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Hardware: Manufacturer → Model → Serializers / Deserializers
// --------------------------------------------------------------------------
function HardwareEditor({ hardware, onChange, usage, errors }: {
  hardware: DMan[]; onChange: (h: DMan[]) => void; usage: Map<string, number>; errors: Map<string, string>;
}) {
  const [manId, setManId] = useState<string | undefined>(hardware[0]?.id);
  const man = hardware.find((m) => m.id === manId) ?? hardware[0];
  const [modelId, setModelId] = useState<string | undefined>(man?.models[0]?.id);
  const model = man?.models.find((m) => m.id === modelId) ?? man?.models[0];

  const setMan = (id: string, patch: Partial<DMan>) => onChange(hardware.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const setModel = (patch: Partial<DModel>) => man && model && setMan(man.id, { models: man.models.map((m) => (m.id === model.id ? { ...m, ...patch } : m)) });

  const manUse = (m: DMan) => (m.orig ? usage.get(usageKey("manufacturers", m.orig)) ?? 0 : 0);
  const modelUse = (md: DModel) => (man?.orig && md.orig ? usage.get(usageKey("models", md.orig, man.orig)) ?? 0 : 0);
  const icUse = (src: CatalogSource) => (x: DItem) =>
    man?.orig && model?.orig && x.orig ? usage.get(usageKey(src, x.orig, man.orig, model.orig)) ?? 0 : 0;

  return (
    <div className="hw-columns">
      <PickList title="Manufacturers" items={hardware.map((m) => ({ id: m.id, name: m.name, orig: m.orig, used: manUse(m), sub: `${m.models.length} model(s)` }))}
        selected={man?.id} onSelect={(id) => { setManId(id); setModelId(hardware.find((m) => m.id === id)?.models[0]?.id); }}
        onRename={(id, name) => setMan(id, { name })} errors={errors} placeholder="e.g. Acme"
        onAdd={(name) => { const m: DMan = { id: nid(), name, models: [] }; onChange([...hardware, m]); setManId(m.id); setModelId(undefined); }}
        onRemove={(id) => onChange(hardware.filter((m) => m.id !== id))} />
      <PickList title={man ? `Models – ${man.name || "?"}` : "Models"} disabled={!man}
        items={(man?.models ?? []).map((md) => ({ id: md.id, name: md.name, orig: md.orig, used: modelUse(md), sub: `${md.serializers.length} ser · ${md.deserializers.length} des` }))}
        selected={model?.id} onSelect={setModelId} errors={errors} placeholder="e.g. NI1488"
        onRename={(id, name) => man && setMan(man.id, { models: man.models.map((m) => (m.id === id ? { ...m, name } : m)) })}
        onAdd={(name) => { if (!man) return; const md: DModel = { id: nid(), name, description: "", serializers: [], deserializers: [] }; setMan(man.id, { models: [...man.models, md] }); setModelId(md.id); }}
        onRemove={(id) => man && setMan(man.id, { models: man.models.filter((m) => m.id !== id) })} />
      <div className="hw-ics">
        {model ? (<>
          <div className="hw-ics-head"><b>{model.name || "?"}</b><input className="inp inp-sm" value={model.description} placeholder="Description (optional)"
            onChange={(e) => setModel({ description: e.target.value })} /></div>
          <ListEditor compact title="Serializer ICs" items={model.serializers} onChange={(xs) => setModel({ serializers: xs })}
            errors={errors} usageOf={icUse("hwSerializers")} valueLabel="Serializer" placeholder="e.g. MAX96717" />
          <ListEditor compact title="Deserializer ICs" items={model.deserializers} onChange={(xs) => setModel({ deserializers: xs })}
            errors={errors} usageOf={icUse("hwDeserializers")} valueLabel="Deserializer" placeholder="e.g. MAX96712" />
        </>) : <div className="muted small list-empty">{man ? "Add a model to define its serializer and deserializer ICs." : "Add a manufacturer first."}</div>}
      </div>
    </div>
  );
}

function PickList({ title, items, selected, onSelect, onRename, onAdd, onRemove, errors, placeholder, disabled }: {
  title: string; items: Array<{ id: string; name: string; orig?: string; used: number; sub: string }>; selected?: string;
  onSelect: (id: string) => void; onRename: (id: string, name: string) => void; onAdd: (name: string) => void; onRemove: (id: string) => void;
  errors: Map<string, string>; placeholder: string; disabled?: boolean;
}) {
  const [adding, setAdding] = useState("");
  const add = () => { const v = adding.trim(); if (v) { onAdd(v); setAdding(""); } };
  return (
    <div className={`pick-list ${disabled ? "is-disabled" : ""}`}>
      <div className="list-editor-title"><b>{title}</b><span className="count">{items.length}</span></div>
      <div className="pick-rows">
        {items.map((x) => {
          const err = errors.get(x.id);
          return (
            <div key={x.id} className={`pick-row ${x.id === selected ? "on" : ""} ${err ? "has-err" : ""}`} onMouseDown={() => onSelect(x.id)}>
              <div className="cell-wrap">
                <input className={`inp inp-sm ${err ? "has-error" : ""}`} value={x.name} spellCheck={false} aria-label={title}
                  onFocus={() => onSelect(x.id)} onChange={(e) => onRename(x.id, e.target.value)} />
                <span className={err ? "row-err" : "row-note"}>{err ?? (x.orig && x.name.trim() !== x.orig ? `was ${x.orig}` : x.sub)}</span>
              </div>
              <span className={`used ${x.used ? "" : "muted"}`} title={x.used ? `Used ${x.used}× in the open configuration` : "Not used"}>{x.used ? `${x.used}×` : "–"}</span>
              <button className="icon-btn danger" onClick={(e) => { e.stopPropagation(); onRemove(x.id); }}
                title={x.used ? `Remove – used ${x.used}× in the open configuration` : "Remove"}><Icon name="trash" size={13} /></button>
            </div>
          );
        })}
        {!items.length && <div className="muted small list-empty">None yet.</div>}
      </div>
      <div className="list-add">
        <input className="inp inp-sm" value={adding} placeholder={`Add – ${placeholder}`} disabled={disabled} spellCheck={false}
          onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button className="btn btn-sm btn-primary" onClick={add} disabled={disabled || !adding.trim()}><Icon name="plus" size={14} /></button>
      </div>
    </div>
  );
}
