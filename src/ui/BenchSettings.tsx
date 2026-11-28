/**
 * Settings › FPGA board defaults and Settings › Debayer configurations: lists of named entries
 * with a form each (fields as in the LabVIEW "FPGA Defaults" / "Debayer Settings" dialogs).
 */
import { useState } from "react";
import {
  BOARD_FIELDS, CONVERSION_PARAMETERS, DATA_SIZES, DEVICE_TYPES, FORMAT_PARAMETERS, IMAGE_FORMATS, IMAGE_TYPES,
  pixelFormatProblems, ROUTING_DESTINATIONS, ROUTING_SOURCES, defaultBoard, defaultDebayer,
  type BoardDefaults, type DebayerConfig, type ImageFormat, type PixelFormat,
} from "../core/benchDefaults";
import { Icon } from "./icons";

let seq = 0;
const nid = () => `b${++seq}`;

// ---------------------------------------------------------------------------- drafts (numbers kept as typed text)
type BoardNum = "siReferenceClockHz" | "soReferenceClockHz" | "framesOnDma" | "frameSyncWindow" | "frameSyncToleranceUs" | "llpFifoDepth";
export interface DRoute { id: string; source: string; destination: string }
export interface DBoard { id: string; orig?: string; boardName: string; description: string; nums: Record<BoardNum, string>; routes: DRoute[] }
export interface DFmt { dataSize: number; bitDepthPerChannel: string; useBigEndian: number; imageFormat: ImageFormat; formatParameter: number }
export interface DDebayer {
  id: string; orig?: string; name: string; description: string; imageWidth: string; imageHeight: string;
  input: DFmt; output: DFmt; conversionParameter: number; devicePreferred: string; deviceAlternative: string; imageType: number;
}

export const boardToDraft = (b: BoardDefaults, keepOrig: boolean): DBoard => ({
  id: nid(), orig: keepOrig ? b.boardName : undefined, boardName: b.boardName, description: b.description ?? "",
  nums: Object.fromEntries(BOARD_FIELDS.map((f) => [f.key, String(b[f.key])])) as Record<BoardNum, string>,
  routes: b.routingSignals.map((r) => ({ id: nid(), ...r })),
});
const fmtToDraft = (f: PixelFormat): DFmt => ({ ...f, bitDepthPerChannel: String(f.bitDepthPerChannel) });
export const debayerToDraft = (d: DebayerConfig, keepOrig: boolean): DDebayer => ({
  id: nid(), orig: keepOrig ? d.name : undefined, name: d.name, description: d.description ?? "",
  imageWidth: String(d.imageWidth), imageHeight: String(d.imageHeight), input: fmtToDraft(d.inputFormat), output: fmtToDraft(d.outputFormat),
  conversionParameter: d.conversionParameter, devicePreferred: d.devicePreferred, deviceAlternative: d.deviceAlternative, imageType: d.imageType,
});

const n = (s: string) => (s.trim() === "" ? NaN : Number(s.trim()));
export const boardFromDraft = (b: DBoard): BoardDefaults => ({
  boardName: b.boardName.trim(),
  ...(b.description.trim() ? { description: b.description.trim() } : {}),
  ...(Object.fromEntries(BOARD_FIELDS.map((f) => [f.key, n(b.nums[f.key as BoardNum])])) as Record<BoardNum, number>),
  routingSignals: b.routes.map((r) => ({ source: r.source.trim(), destination: r.destination.trim() })),
});
const fmtFromDraft = (f: DFmt): PixelFormat => ({ ...f, bitDepthPerChannel: n(f.bitDepthPerChannel) });
export const debayerFromDraft = (d: DDebayer): DebayerConfig => ({
  name: d.name.trim(),
  ...(d.description.trim() ? { description: d.description.trim() } : {}),
  imageWidth: n(d.imageWidth), imageHeight: n(d.imageHeight),
  inputFormat: fmtFromDraft(d.input), outputFormat: fmtFromDraft(d.output),
  conversionParameter: d.conversionParameter, devicePreferred: d.devicePreferred, deviceAlternative: d.deviceAlternative, imageType: d.imageType,
});

/** Errors keyed by entry id (name) or "<id>.<field>"; warnings likewise (shown, but do not block Apply). */
export function benchErrors(boards: DBoard[], debayers: DDebayer[], errs: Map<string, string>, warns: Map<string, string>) {
  const names = (rows: Array<{ id: string; v: string }>, what: string) => {
    const seen = new Set<string>();
    for (const r of rows) {
      const v = r.v.trim();
      if (!v) errs.set(r.id, `${what} cannot be empty`);
      else if (seen.has(v.toLowerCase())) errs.set(r.id, `Duplicate ${what.toLowerCase()} '${v}'`);
      else seen.add(v.toLowerCase());
    }
  };
  names(boards.map((b) => ({ id: b.id, v: b.boardName })), "Board name");
  for (const b of boards) {
    for (const f of BOARD_FIELDS) {
      const v = n(b.nums[f.key as BoardNum]);
      if (!Number.isFinite(v)) errs.set(`${b.id}.${f.key}`, "Enter a number");
      else if (f.int && !Number.isInteger(v)) errs.set(`${b.id}.${f.key}`, "Must be a whole number");
      else if (v < f.min) errs.set(`${b.id}.${f.key}`, `Must be ≥ ${f.min}`);
    }
    b.routes.forEach((r) => {
      if (!r.source.trim()) errs.set(`${b.id}.route.${r.id}.source`, "Source is required");
      if (!r.destination.trim()) errs.set(`${b.id}.route.${r.id}.destination`, "Destination is required");
    });
  }
  names(debayers.map((d) => ({ id: d.id, v: d.name })), "Name");
  for (const d of debayers) {
    for (const k of ["imageWidth", "imageHeight"] as const) {
      const v = n(d[k]);
      if (!Number.isInteger(v) || v < 1 || v > 65535) errs.set(`${d.id}.${k}`, "Must be a whole number 1–65535");
    }
    for (const side of ["input", "output"] as const) {
      for (const p of pixelFormatProblems(fmtFromDraft(d[side]), side))
        (p.severity === "error" ? errs : warns).set(`${d.id}.${side}.${p.field}`, p.message);
    }
  }
}

// ---------------------------------------------------------------------------- shared bits
function EntryList<T extends { id: string; orig?: string }>({ title, items, nameOf, subOf, selected, onSelect, onAdd, onDuplicate, onRemove, errors, usageOf, addLabel }: {
  title: string; items: T[]; nameOf: (x: T) => string; subOf: (x: T) => string; selected?: string;
  onSelect: (id: string) => void; onAdd: () => void; onDuplicate: (x: T) => void; onRemove: (id: string) => void;
  errors: Map<string, string>; usageOf: (x: T) => number; addLabel: string;
}) {
  const hasErr = (x: T) => [...errors.keys()].some((k) => k === x.id || k.startsWith(`${x.id}.`));
  return (
    <div className="pick-list bench-list">
      <div className="list-editor-title"><b>{title}</b><span className="count">{items.length}</span></div>
      <div className="pick-rows">
        {items.map((x) => {
          const used = usageOf(x);
          return (
            <div key={x.id} className={`pick-row bench-row ${x.id === selected ? "on" : ""} ${hasErr(x) ? "has-err" : ""}`} onMouseDown={() => onSelect(x.id)}>
              <div className="cell-wrap">
                <span className="bench-name">{nameOf(x).trim() || "(no name)"}</span>
                <span className={hasErr(x) ? "row-err" : "row-note"}>{hasErr(x) ? "Needs attention" : x.orig && nameOf(x).trim() !== x.orig ? `was ${x.orig}` : subOf(x)}</span>
              </div>
              <span className={`used ${used ? "" : "muted"}`} title={used ? `Used ${used}× in the open configuration` : "Not used"}>{used ? `${used}×` : "–"}</span>
              <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onDuplicate(x); }} title="Duplicate"><Icon name="copy" size={13} /></button>
              <button className="icon-btn danger" onClick={(e) => { e.stopPropagation(); onRemove(x.id); }}
                title={used ? `Remove – used ${used}× in the open configuration, those values will be flagged` : "Remove"}><Icon name="trash" size={13} /></button>
            </div>
          );
        })}
        {!items.length && <div className="muted small list-empty">None yet.</div>}
      </div>
      <div className="list-add"><button className="btn btn-sm btn-primary" onClick={onAdd}><Icon name="plus" size={14} />{addLabel}</button></div>
    </div>
  );
}

function F({ label, help, err, warn, children, wide }: { label: string; help?: string; err?: string; warn?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`bench-field ${wide ? "wide" : ""}`}>
      <span className="bench-label">{label}</span>
      {children}
      {err ? <span className="row-err">{err}</span> : warn ? <span className="row-warn">{warn}</span> : help ? <span className="bench-help">{help}</span> : null}
    </label>
  );
}

const uniqueName = (base: string, taken: string[]) => {
  const t = new Set(taken.map((x) => x.trim().toLowerCase()));
  if (!t.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!t.has(`${base}_${i}`.toLowerCase())) return `${base}_${i}`;
};

// ---------------------------------------------------------------------------- FPGA board defaults
export function BoardEditor({ boards, onChange, errors, usageOf }: {
  boards: DBoard[]; onChange: (b: DBoard[]) => void; errors: Map<string, string>; usageOf: (b: DBoard) => number;
}) {
  const [selId, setSelId] = useState<string | undefined>(boards[0]?.id);
  const b = boards.find((x) => x.id === selId) ?? boards[0];
  const set = (patch: Partial<DBoard>) => b && onChange(boards.map((x) => (x.id === b.id ? { ...x, ...patch } : x)));
  const setRoute = (id: string, patch: Partial<DRoute>) => b && set({ routes: b.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const add = (from?: DBoard) => {
    const name = uniqueName(from ? `${from.boardName}_copy` : `board${boards.length + 1}`, boards.map((x) => x.boardName));
    const nb = from ? { ...from, id: nid(), orig: undefined, boardName: name, routes: from.routes.map((r) => ({ ...r, id: nid() })) } : boardToDraft(defaultBoard(name), false);
    onChange([...boards, nb]);
    setSelId(nb.id);
  };
  return (
    <div className="bench-columns">
      <EntryList title="Boards" items={boards} nameOf={(x) => x.boardName} selected={b?.id} onSelect={setSelId} errors={errors} usageOf={usageOf}
        subOf={(x) => `${x.routes.length} routing signal(s)`} addLabel="Add board" onAdd={() => add()} onDuplicate={add}
        onRemove={(id) => onChange(boards.filter((x) => x.id !== id))} />
      {b ? (
        <div className="bench-form">
          <div className="bench-grid">
            <F label="Board Name" err={errors.get(b.id)} help="Chosen in Camera Model › FPGA Board Defaults">
              <input className={`inp ${errors.get(b.id) ? "has-error" : ""}`} value={b.boardName} spellCheck={false} aria-label="Board Name"
                onChange={(e) => set({ boardName: e.target.value })} />
            </F>
            <F label="Description (optional)">
              <input className="inp" value={b.description} placeholder="—" aria-label="Board description" onChange={(e) => set({ description: e.target.value })} />
            </F>
            {BOARD_FIELDS.map((f) => {
              const err = errors.get(`${b.id}.${f.key}`);
              return (
                <F key={f.key} label={f.label} help={f.help} err={err}>
                  <input className={`inp num ${err ? "has-error" : ""}`} inputMode="decimal" value={b.nums[f.key as BoardNum]} aria-label={f.label} spellCheck={false}
                    onChange={(e) => set({ nums: { ...b.nums, [f.key]: e.target.value } })} />
                </F>
              );
            })}
          </div>
          <div className="bench-subtitle"><b>Routing Signals</b><span className="count">{b.routes.length}</span><span className="spacer" />
            <button className="btn btn-sm" onClick={() => set({ routes: [...b.routes, { id: nid(), source: "PXI_Trig0", destination: "Start_Trig" }] })}><Icon name="plus" size={14} />Add route</button></div>
          <datalist id="routing-sources">{ROUTING_SOURCES.map((s) => <option key={s} value={s} />)}</datalist>
          <datalist id="routing-destinations">{ROUTING_DESTINATIONS.map((s) => <option key={s} value={s} />)}</datalist>
          <div className="route-rows">
            {b.routes.length > 0 && <div className="route-row route-head"><span>#</span><span>Source</span><span /><span>Destination</span><span /></div>}
            {b.routes.map((r, i) => {
              const es = errors.get(`${b.id}.route.${r.id}.source`), ed = errors.get(`${b.id}.route.${r.id}.destination`);
              return (
                <div key={r.id} className="route-row">
                  <span className="muted">{i + 1}</span>
                  <input className={`inp ${es ? "has-error" : ""}`} list="routing-sources" value={r.source} aria-label={`Route ${i + 1} source`} title={es}
                    spellCheck={false} onChange={(e) => setRoute(r.id, { source: e.target.value })} />
                  <Icon name="chevronRight" size={14} className="muted" />
                  <input className={`inp ${ed ? "has-error" : ""}`} list="routing-destinations" value={r.destination} aria-label={`Route ${i + 1} destination`} title={ed}
                    spellCheck={false} onChange={(e) => setRoute(r.id, { destination: e.target.value })} />
                  <button className="icon-btn danger" onClick={() => set({ routes: b.routes.filter((x) => x.id !== r.id) })} title="Remove route"><Icon name="trash" size={13} /></button>
                </div>
              );
            })}
            {!b.routes.length && <div className="muted small list-empty">No routing signals.</div>}
          </div>
        </div>
      ) : <div className="muted small list-empty">Add a board to define its defaults.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------- debayer configurations
const DATA_SIZE_LABEL: Record<number, string> = { 1: "1 – uint8", 2: "2 – uint16", 4: "4 – uint32" };

function FormatEditor({ side, f, onChange, errors, warnings, prefix }: {
  side: "input" | "output"; f: DFmt; onChange: (f: DFmt) => void; errors: Map<string, string>; warnings: Map<string, string>; prefix: string;
}) {
  const params = FORMAT_PARAMETERS[side][f.imageFormat] ?? [];
  const e = (k: string) => errors.get(`${prefix}.${k}`);
  const w = (k: string) => warnings.get(`${prefix}.${k}`);
  const title = side === "input" ? "Input Format" : "Output Format";
  return (
    <fieldset className="bench-group">
      <legend>{title}</legend>
      <F label="Image Format" help="RAW, RGB or YUV" err={e("imageFormat")}>
        <select className="inp sel" value={f.imageFormat} aria-label={`${title} image format`}
          onChange={(ev) => {
            const fmt = ev.target.value as ImageFormat;
            const n = FORMAT_PARAMETERS[side][fmt].length;
            onChange({ ...f, imageFormat: fmt, formatParameter: f.formatParameter < n ? f.formatParameter : 0, dataSize: fmt === "IMAGE_FORMAT_RAW" ? f.dataSize : 1 });
          }}>
          {IMAGE_FORMATS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </F>
      <F label="Image Format Parameter" help={f.imageFormat === "IMAGE_FORMAT_RAW" ? "Bayer mask" : f.imageFormat === "IMAGE_FORMAT_RGB" ? "Channel order" : "YUV layout"} err={e("formatParameter")}>
        <select className="inp sel" value={f.formatParameter} aria-label={`${title} image format parameter`}
          onChange={(ev) => onChange({ ...f, formatParameter: Number(ev.target.value) })}>
          {params.map((p, i) => <option key={p} value={i}>{i} – {p}</option>)}
          {f.formatParameter >= params.length && <option value={f.formatParameter}>{f.formatParameter} – (invalid)</option>}
        </select>
      </F>
      <F label="Data Size" help="Bytes per image array element (RAW 1/2/4, YUV and RGB 1)" err={e("dataSize")} warn={w("dataSize")}>
        <select className="inp sel" value={f.dataSize} aria-label={`${title} data size`} onChange={(ev) => onChange({ ...f, dataSize: Number(ev.target.value) })}>
          {DATA_SIZES.map((x) => <option key={x} value={x}>{DATA_SIZE_LABEL[x]}</option>)}
          {!(DATA_SIZES as readonly number[]).includes(f.dataSize) && <option value={f.dataSize}>{f.dataSize} (invalid)</option>}
        </select>
      </F>
      <F label="Bit Depth Per Channel" help={`Bits holding the intensity value, at most ${f.dataSize * 8}`} err={e("bitDepthPerChannel")}>
        <input className={`inp num ${e("bitDepthPerChannel") ? "has-error" : ""}`} inputMode="numeric" value={f.bitDepthPerChannel}
          aria-label={`${title} bit depth per channel`} onChange={(ev) => onChange({ ...f, bitDepthPerChannel: ev.target.value })} />
      </F>
      <F label="Use Big Endian" err={e("useBigEndian")}>
        <select className="inp sel" value={f.useBigEndian} aria-label={`${title} byte order`} onChange={(ev) => onChange({ ...f, useBigEndian: Number(ev.target.value) })}>
          <option value={0}>0 – Little Endian</option>
          <option value={1}>1 – Big Endian</option>
        </select>
      </F>
    </fieldset>
  );
}

export function DebayerEditor({ configs, onChange, errors, warnings, usageOf }: {
  configs: DDebayer[]; onChange: (d: DDebayer[]) => void; errors: Map<string, string>; warnings: Map<string, string>; usageOf: (d: DDebayer) => number;
}) {
  const [selId, setSelId] = useState<string | undefined>(configs[0]?.id);
  const d = configs.find((x) => x.id === selId) ?? configs[0];
  const set = (patch: Partial<DDebayer>) => d && onChange(configs.map((x) => (x.id === d.id ? { ...x, ...patch } : x)));
  const add = (from?: DDebayer) => {
    const name = uniqueName(from ? `${from.name}_copy` : "Debayer", configs.map((x) => x.name));
    const nd = from ? { ...from, id: nid(), orig: undefined, name, input: { ...from.input }, output: { ...from.output } } : debayerToDraft(defaultDebayer(name), false);
    onChange([...configs, nd]);
    setSelId(nd.id);
  };
  const short = (f: DFmt) => f.imageFormat.replace("IMAGE_FORMAT_", "");
  return (
    <div className="bench-columns">
      <EntryList title="Configurations" items={configs} nameOf={(x) => x.name} selected={d?.id} onSelect={setSelId} errors={errors} usageOf={usageOf}
        subOf={(x) => `${x.imageWidth}×${x.imageHeight} · ${short(x.input)} → ${short(x.output)}`} addLabel="Add configuration"
        onAdd={() => add()} onDuplicate={add} onRemove={(id) => onChange(configs.filter((x) => x.id !== id))} />
      {d ? (
        <div className="bench-form">
          <div className="bench-grid">
            <F label="Name" err={errors.get(d.id)} help="Chosen in Virtual Channel › Debayer Configuration">
              <input className={`inp ${errors.get(d.id) ? "has-error" : ""}`} value={d.name} spellCheck={false} aria-label="Debayer name" onChange={(e) => set({ name: e.target.value })} />
            </F>
            <F label="Description (optional)">
              <input className="inp" value={d.description} placeholder="—" aria-label="Debayer description" onChange={(e) => set({ description: e.target.value })} />
            </F>
            <F label="Image Width" err={errors.get(`${d.id}.imageWidth`)}>
              <input className={`inp num ${errors.get(`${d.id}.imageWidth`) ? "has-error" : ""}`} inputMode="numeric" value={d.imageWidth} aria-label="Image Width" onChange={(e) => set({ imageWidth: e.target.value })} />
            </F>
            <F label="Image Height" err={errors.get(`${d.id}.imageHeight`)}>
              <input className={`inp num ${errors.get(`${d.id}.imageHeight`) ? "has-error" : ""}`} inputMode="numeric" value={d.imageHeight} aria-label="Image Height" onChange={(e) => set({ imageHeight: e.target.value })} />
            </F>
          </div>
          <div className="bench-formats">
            <FormatEditor side="input" f={d.input} onChange={(f) => set({ input: f })} errors={errors} warnings={warnings} prefix={`${d.id}.input`} />
            <FormatEditor side="output" f={d.output} onChange={(f) => set({ output: f })} errors={errors} warnings={warnings} prefix={`${d.id}.output`} />
          </div>
          <div className="bench-grid">
            <F label="Conversion Parameter" help="Colour conversion (Conv_Param_1)">
              <select className="inp sel" value={d.conversionParameter} aria-label="Conversion Parameter" onChange={(e) => set({ conversionParameter: Number(e.target.value) })}>
                {CONVERSION_PARAMETERS.map((p, i) => <option key={p} value={i}>{i} – {p}</option>)}
              </select>
            </F>
            <F label="Image Type" help="Image type for the IMAQ reference">
              <select className="inp sel" value={d.imageType} aria-label="Image Type" onChange={(e) => set({ imageType: Number(e.target.value) })}>
                {IMAGE_TYPES.map((p, i) => <option key={p} value={i}>{i} – {p}</option>)}
              </select>
            </F>
            <F label="Device Preferred" help="Device that runs the conversion">
              <select className="inp sel" value={d.devicePreferred} aria-label="Device Preferred" onChange={(e) => set({ devicePreferred: e.target.value })}>
                {DEVICE_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </F>
            <F label="Device Alternative" help="Used when the preferred device is not available">
              <select className="inp sel" value={d.deviceAlternative} aria-label="Device Alternative" onChange={(e) => set({ deviceAlternative: e.target.value })}>
                {DEVICE_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </F>
          </div>
          <p className="muted small bench-note"><Icon name="info" size={12} /> GPU conversion needs the matching drivers on the bench PC (see the x2rgbApp notes in the debayer documentation).</p>
        </div>
      ) : <div className="muted small list-empty">Add a debayer configuration.</div>}
    </div>
  );
}
