/**
 * Option catalog – the lists behind the editor's dropdowns, maintained in the
 * Settings window: mode features, imagers, camera serializers, the
 * Manufacturer → Model → Serializer/Deserializer hardware tree, image formats
 * and CSI-2 data types.
 *
 * Pure TypeScript (no UI): specs reference a list through `FieldSpec.source`,
 * `resolveSpec` turns that into concrete options for a given record, and the
 * validator uses the same lists, so the UI and the checks always agree.
 */
import { FEATURE_EMC, type CatalogSource, type FieldSpec, type Json } from "./schema";
import {
  boardSummary, debayerSummary, defaultBoard, defaultDebayer, readBoards, readDebayers, yuvDebayer,
  type BoardDefaults, type DebayerConfig,
} from "./benchDefaults";

export interface CatalogOption { value: string; description?: string }
export interface HwModel { name: string; description?: string; serializers: string[]; deserializers: string[] }
export interface HwManufacturer { name: string; models: HwModel[] }

export interface Catalog {
  version: 1;
  features: CatalogOption[];
  imagers: CatalogOption[];
  serializers: CatalogOption[];
  hardware: HwManufacturer[];
  imageFormats: CatalogOption[];
  dataTypes: CatalogOption[];
  fpgaDevices: CatalogOption[];      // tester camera › FPGA Device
  boardDefaults: BoardDefaults[];    // tester camera › FPGA Board Defaults (by boardName)
  debayerConfigs: DebayerConfig[];   // tester virtual channel › Debayer Configuration (by name)
  /** Runtime only (never saved): what a tester configuration refers to. */
  ctx?: TesterContext;
}

/** A configuration tree as far as the option lists need it (avoids importing model.ts). */
interface Node { type: string; params: Json; children: Node[] }

/**
 * The files a tester configuration refers to: the project JSON it was created
 * for, and the bench folders. A list is null while it is unknown (not loaded
 * yet / no backend) – such values are then not checked.
 */
export interface TesterContext {
  projectFiles: string[] | null;
  project: { name: string; root: Node | null; error?: string } | null;
  bitfiles: string[] | null;
  dataloggers: string[] | null;
  i2cFiles?: string[] | null;
  dirs: Partial<Record<"project" | "bitfile" | "datalogger" | "i2c", string>>;
}

export type SettingsSection = "features" | "imagers" | "serializers" | "hardware" | "imageFormats" | "dataTypes" | "fpgaDevices" | "boardDefaults" | "debayerConfigs";

export const SECTIONS: Array<{ id: SettingsSection; title: string; help: string }> = [
  { id: "features", title: "Mode features", help: "Features that can be enabled per project mode (Project Modes › Features)." },
  { id: "imagers", title: "Imagers", help: "Image sensor models offered in Camera Model › Imager." },
  { id: "serializers", title: "Camera serializers", help: "Serializer ICs offered in Camera Model › Serializer IC." },
  { id: "hardware", title: "Hardware", help: "Bench boards: each manufacturer's models and, per model, the serializer and deserializer ICs it supports. Hardware nodes offer these in cascading dropdowns." },
  { id: "imageFormats", title: "Image formats", help: "Pixel / packet formats offered in Camera Model › Packet Format and Frame Outputs › Format." },
  { id: "dataTypes", title: "Data types", help: "MIPI CSI-2 data type identifiers offered in Frame Outputs › Data ID (hex 0x00–0x3F)." },
  { id: "fpgaDevices", title: "FPGA devices", help: "Tester configuration: FPGA devices offered in Camera Model › FPGA Device." },
  { id: "boardDefaults", title: "FPGA board defaults", help: "Tester configuration: FPGA board settings (reference clocks, DMA, frame sync, LLP FIFO, routing signals), chosen by board name in Camera Model › FPGA Board Defaults." },
  { id: "debayerConfigs", title: "Debayer configurations", help: "Tester configuration: debayer settings (image size, input and output format, conversion, devices, IMAQ image type), chosen by name in Virtual Channel › Debayer Configuration." },
];

/**
 * Where a list comes from. `section`: the Settings tab that edits it (lists from
 * ui_config.json); `missing`: why a value is not offered (lists from the project / folders).
 */
export const SOURCE_INFO: Record<CatalogSource, { section?: SettingsSection; label: string; missing?: string; empty?: string }> = {
  features: { section: "features", label: "Mode features" },
  imagers: { section: "imagers", label: "Imagers" },
  serializers: { section: "serializers", label: "Camera serializers" },
  manufacturers: { section: "hardware", label: "Hardware › Manufacturers" },
  models: { section: "hardware", label: "Hardware › Models" },
  hwSerializers: { section: "hardware", label: "Hardware › Serializers" },
  hwDeserializers: { section: "hardware", label: "Hardware › Deserializers" },
  imageFormats: { section: "imageFormats", label: "Image formats" },
  dataTypes: { section: "dataTypes", label: "Data types" },
  fpgaDevices: { section: "fpgaDevices", label: "FPGA devices" },
  boardDefaults: { section: "boardDefaults", label: "FPGA board defaults" },
  debayerConfigs: { section: "debayerConfigs", label: "Debayer configurations" },
  projectVcs: { label: "Project virtual channels", missing: "not a virtual channel of this camera model in the project", empty: "the project defines no virtual channels for this camera model" },
  i2cFiles: { label: "I2C initialisation files", missing: "not found in the i2c_configuration folder", empty: "there are no .txt files in the i2c_configuration folder" },
  projectFiles: { label: "Project configurations", missing: "not found in the project configuration folder", empty: "no project configuration is saved yet" },
  projectModes: { label: "Project modes", missing: "not a mode of the selected project", empty: "the selected project has no modes" },
  projectCameras: { label: "Project camera models", missing: "not a camera model of the selected project", empty: "the selected project has no camera models" },
  projectManufacturers: { label: "Project hardware manufacturers", missing: "not configured as hardware of this camera model in the project", empty: "the project has no hardware for this camera model in this mode" },
  projectDeviceModels: { label: "Project hardware models", missing: "not configured as hardware of this camera model in the project", empty: "the project has no hardware for this camera model in this mode" },
  bitfiles: { label: "FPGA bit files", missing: "not found in the fpga_bitfile folder", empty: "there are no .lvbitx files in the fpga_bitfile folder" },
  dataloggers: { label: "Datalogger configurations", missing: "not found in the datalogger_configuration folder", empty: "there are no .json files in the datalogger_configuration folder" },
};

/** Lists that come from ui_config.json (edited in Settings), as opposed to the project / folders. */
export const isSettingsSource = (s: CatalogSource) => !!SOURCE_INFO[s].section;

/** Explanation appended to "not in the list" messages. */
export const missingHint = (s: CatalogSource) =>
  SOURCE_INFO[s].section ? `add it in Settings › ${SOURCE_INFO[s].label}` : SOURCE_INFO[s].missing!;

/** Features the editor itself depends on: always offered, cannot be renamed or removed in Settings. */
export const BUILT_IN_FEATURES: CatalogOption[] = [
  { value: FEATURE_EMC, description: "Enables the EMC parameters of camera models (imager I2C address, EEPROM, calibration hash)" },
];
export const builtInFeature = (value: string) => BUILT_IN_FEATURES.find((b) => b.value.toLowerCase() === value.trim().toLowerCase());

export function defaultCatalog(): Catalog {
  return {
    version: 1,
    features: [
      { value: "DataLogger", description: "Logs frame data to disk" },
      { value: "FaultInjection", description: "Enables controlled error injection" },
      ...BUILT_IN_FEATURES,
    ],
    imagers: [
      { value: "SENSOR_MODEL_X", description: "Example sensor" },
      { value: "IMX_SERIES", description: "Example sensor family" },
    ],
    serializers: [{ value: "SER_IC_PART_A", description: "Example camera serializer" }],
    hardware: [{
      name: "NationalInstruments",
      models: [{ name: "NI1487", description: "PXIe FPGA frame grabber / SerDes interface", serializers: ["SER_IC_PART_A"], deserializers: ["DES_IC_PART_B"] }],
    }],
    imageFormats: ["raw8", "raw10", "raw12", "raw14", "raw16"].map((v) => ({ value: v, description: `RAW ${v.slice(3)}-bit` })),
    dataTypes: [
      { value: "0x12", description: "Embedded 8-bit non-image data" },
      { value: "0x28", description: "RAW6" },
      { value: "0x29", description: "RAW7" },
      { value: "0x2A", description: "RAW8" },
      { value: "0x2B", description: "RAW10" },
      { value: "0x2C", description: "RAW12" },
      { value: "0x2D", description: "RAW14" },
      { value: "0x2E", description: "RAW16" },
      { value: "0x2F", description: "RAW20" },
    ],
    fpgaDevices: [
      { value: "PXIe-1486", description: "Kintex UltraScale KU11P" },
      { value: "PXIe-1487", description: "Kintex UltraScale KU11P" },
      { value: "PXIe-1488", description: "Kintex UltraScale KU11P" },
      { value: "PXIe-1489", description: "Kintex UltraScale KU11P" },
    ],
    boardDefaults: [defaultBoard()],
    debayerConfigs: [defaultDebayer(), yuvDebayer()],
  };
}

// --------------------------------------------------------------------------
// Normalisation (import / storage)
// --------------------------------------------------------------------------
export const normHex = (v: string): string | null => {
  const m = /^(?:0[xX])?([0-9A-Fa-f]{1,2})$/.exec(v.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return n <= 0x3f ? `0x${n.toString(16).toUpperCase().padStart(2, "0")}` : null;
};

function options(raw: Json, what: string, warnings: string[], hex = false): CatalogOption[] {
  if (!Array.isArray(raw)) { warnings.push(`${what}: expected a list – using defaults`); return []; }
  const out: CatalogOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const o = typeof item === "string" ? { value: item } : item && typeof item === "object" ? item : null;
    let value = typeof o?.value === "string" ? o.value.trim() : "";
    if (hex && value) {
      const h = normHex(value);
      if (!h) { warnings.push(`${what}: '${value}' is not a hex data type 0x00–0x3F – skipped`); continue; }
      value = h;
    }
    if (!value) { warnings.push(`${what}: empty entry skipped`); continue; }
    if (seen.has(value.toLowerCase())) { warnings.push(`${what}: duplicate '${value}' skipped`); continue; }
    seen.add(value.toLowerCase());
    out.push(typeof o.description === "string" && o.description.trim() ? { value, description: o.description.trim() } : { value });
  }
  return out;
}

function names(raw: Json, what: string, warnings: string[]): string[] {
  return options(raw, what, warnings).map((o) => o.value);
}

/** Validate an imported / stored catalog. Missing sections fall back to the defaults. */
export function normalizeCatalog(raw: Json): { catalog: Catalog; warnings: string[] } {
  const warnings: string[] = [];
  const def = defaultCatalog();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { catalog: def, warnings: ["Settings file is not a JSON object – using defaults"] };
  const pick = <K extends keyof Catalog>(k: K, fn: () => Catalog[K]) => (k in raw ? fn() : def[k]);
  const hardware = pick("hardware", () => {
    if (!Array.isArray(raw.hardware)) { warnings.push("hardware: expected a list – using defaults"); return def.hardware; }
    const out: HwManufacturer[] = [];
    const seen = new Set<string>();
    for (const m of raw.hardware) {
      const name = typeof m?.name === "string" ? m.name.trim() : "";
      if (!name || seen.has(name.toLowerCase())) { warnings.push(`hardware: ${name ? `duplicate manufacturer '${name}'` : "manufacturer without a name"} skipped`); continue; }
      seen.add(name.toLowerCase());
      const models: HwModel[] = [];
      const seenM = new Set<string>();
      for (const md of Array.isArray(m.models) ? m.models : []) {
        const mn = typeof md?.name === "string" ? md.name.trim() : "";
        if (!mn || seenM.has(mn.toLowerCase())) { warnings.push(`hardware › ${name}: ${mn ? `duplicate model '${mn}'` : "model without a name"} skipped`); continue; }
        seenM.add(mn.toLowerCase());
        models.push({
          name: mn,
          ...(typeof md.description === "string" && md.description.trim() ? { description: md.description.trim() } : {}),
          serializers: names(md.serializers ?? [], `hardware › ${name} › ${mn} serializers`, warnings),
          deserializers: names(md.deserializers ?? [], `hardware › ${name} › ${mn} deserializers`, warnings),
        });
      }
      out.push({ name, models });
    }
    return out;
  });
  const catalog: Catalog = {
    version: 1,
    features: pick("features", () => options(raw.features, "features", warnings)),
    imagers: pick("imagers", () => options(raw.imagers, "imagers", warnings)),
    serializers: pick("serializers", () => options(raw.serializers, "serializers", warnings)),
    hardware,
    imageFormats: pick("imageFormats", () => options(raw.imageFormats, "imageFormats", warnings)),
    dataTypes: pick("dataTypes", () => options(raw.dataTypes, "dataTypes", warnings, true)),
    fpgaDevices: pick("fpgaDevices", () => options(raw.fpgaDevices, "fpgaDevices", warnings)),
    boardDefaults: pick("boardDefaults", () => readBoards(raw.boardDefaults, warnings)),
    debayerConfigs: pick("debayerConfigs", () => readDebayers(raw.debayerConfigs, warnings)),
  };
  // older ui_config.json files: add built-in features that are missing (keep the file's spelling otherwise)
  for (const b of BUILT_IN_FEATURES) if (!catalog.features.some((f) => f.value.toLowerCase() === b.value.toLowerCase())) catalog.features.push({ ...b });
  if (!catalog.imageFormats.length) { warnings.push("imageFormats: at least one format is required – using defaults"); catalog.imageFormats = def.imageFormats; }
  return { catalog, warnings };
}

// --------------------------------------------------------------------------
// Options for a field
// --------------------------------------------------------------------------
const uniq = (xs: string[]) => [...new Set(xs)];
const findManufacturer = (c: Catalog, name: Json) => c.hardware.find((m) => m.name === name);
const findModel = (c: Catalog, manufacturer: Json, model: Json) => findManufacturer(c, manufacturer)?.models.find((m) => m.name === model);
const allModels = (c: Catalog) => c.hardware.flatMap((m) => m.models);

const childOf = (n: Node | null | undefined, type: string) => n?.children.find((x) => x.type === type);
const HW_FOR_MODE: Record<string, string> = { capturemode: "hwCapture", passthroughmode: "hwPassthrough" };

/**
 * Hardware boards of a project camera model, for a tester mode: CaptureMode → Capture
 * Hardware, PassthroughMode → Passthrough Hardware (any other mode: all boards).
 */
export function projectHardware(project: Node | null | undefined, cameraModel: Json, mode: Json): Json[] {
  const cam = childOf(project, "cameras")?.children.find((c) => c.params.model === cameraModel);
  const boards = childOf(cam, "hardware")?.children ?? [];
  const want = HW_FOR_MODE[String(mode ?? "").toLowerCase()];
  return boards.filter((b) => !want || b.type === want).map((b) => b.params);
}

/** Modes of the project a tester refers to: {mode: features}. */
export function projectModeFeatures(project: Node | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of childOf(project, "modes")?.children ?? [])
    out.set(String(m.params.mode ?? ""), Array.isArray(m.params.features) ? m.params.features.map(String) : []);
  return out;
}

/**
 * Values (and display labels) offered for `source`, given the record being edited (for cascades).
 * Tester records carry the mode they belong to as `$mode` (see optionRecord in model.ts).
 * `unknown`: the list could not be determined (project / folder not loaded) – do not check against it.
 */
export function optionsFor(source: CatalogSource, c: Catalog, record: Json = {}): { values: string[]; labels: Record<string, string>; unknown?: boolean } {
  const fromOpts = (os: CatalogOption[], labelWithValue = false) => ({
    values: os.map((o) => o.value),
    labels: Object.fromEntries(os.map((o) => [o.value, labelWithValue && o.description ? `${o.value} – ${o.description}` : o.value])),
  });
  const plain = (vs: string[]) => ({ values: vs, labels: Object.fromEntries(vs.map((v) => [v, v])) });
  switch (source) {
    case "features": return fromOpts(c.features);
    case "imagers": return fromOpts(c.imagers);
    case "serializers": return fromOpts(c.serializers);
    case "imageFormats": return fromOpts(c.imageFormats);
    case "dataTypes": return fromOpts(c.dataTypes, true);
    case "manufacturers": return plain(c.hardware.map((m) => m.name));
    case "models": {
      const m = findManufacturer(c, record.manufacture);
      return plain(m ? m.models.map((x) => x.name) : uniq(allModels(c).map((x) => x.name)));
    }
    case "hwSerializers": case "hwDeserializers": {
      const key = source === "hwSerializers" ? "serializers" : "deserializers";
      const md = findModel(c, record.manufacture, record.model);
      const m = findManufacturer(c, record.manufacture);
      const vs = md ? md[key] : m ? uniq(m.models.flatMap((x) => x[key])) : uniq(allModels(c).flatMap((x) => x[key]));
      return plain(vs);
    }
    case "fpgaDevices": return fromOpts(c.fpgaDevices ?? [], true);
    case "boardDefaults": return fromOpts((c.boardDefaults ?? []).map((b) => ({ value: b.boardName, description: b.description || boardSummary(b) })), true);
    case "debayerConfigs": return fromOpts((c.debayerConfigs ?? []).map((d) => ({ value: d.name, description: d.description || debayerSummary(d) })), true);
  }
  // tester: the project JSON and the bench folders
  const ctx = c.ctx;
  const unknown = { values: [], labels: {}, unknown: true };
  const list = (vs: string[] | null | undefined) => (vs ? plain(vs) : unknown);
  switch (source) {
    case "projectFiles": return list(ctx?.projectFiles);
    case "bitfiles": return list(ctx?.bitfiles);
    case "dataloggers": return list(ctx?.dataloggers);
    case "i2cFiles": return list(ctx?.i2cFiles);
  }
  const project = ctx?.project?.root;
  if (!project) return unknown;
  switch (source) {
    case "projectModes": return plain([...projectModeFeatures(project).keys()].filter(Boolean));
    case "projectCameras": return plain(uniq((childOf(project, "cameras")?.children ?? []).map((x) => String(x.params.model ?? "")).filter(Boolean)));
    case "projectManufacturers":
      return plain(uniq(projectHardware(project, record.cameraModel, record.$mode).map((h) => String(h.manufacture ?? "")).filter(Boolean)));
    case "projectVcs": { // virtual channels of the camera model the channel belongs to: value = VC number, label = name
      const cam = childOf(project, "cameras")?.children.find((x) => x.params.model === record.$cameraModel);
      const vcs = childOf(cam, "frames")?.children ?? [];
      const values = vcs.map((v) => String(v.params.virtualChannelNumber ?? "")).filter((v) => v !== "");
      const labels: Record<string, string> = {};
      for (const v of vcs) labels[String(v.params.virtualChannelNumber)] = String(v.params.virtualChannelName || `VC${v.params.virtualChannelNumber}`);
      return { values: uniq(values), labels };
    }
    case "projectDeviceModels":
      return plain(uniq(projectHardware(project, record.cameraModel, record.$mode)
        .filter((h) => !record.deviceManufacturer || h.manufacture === record.deviceManufacturer)
        .map((h) => String(h.model ?? "")).filter(Boolean)));
  }
  return unknown;
}

/** Concrete spec for a record: catalog-backed fields become dropdowns with the current options. */
export function resolveSpec(spec: FieldSpec, c: Catalog, record: Json = {}): FieldSpec {
  if (!spec.source) return spec;
  const { values, labels, unknown } = optionsFor(spec.source, c, record);
  if (unknown) return { ...spec, strict: false, pattern: undefined }; // list not available: free text
  if (spec.kind === "int") // numeric values (e.g. virtual channel numbers): numbered dropdown
    return { ...spec, kind: "intenum", intOptions: values.map((v) => [Number(v), labels[v] ?? v] as [number, string]), pattern: undefined };
  return { ...spec, kind: spec.kind === "multi" ? "multi" : "enum", options: values, optionLabels: labels, pattern: undefined };
}

/** Is `value` offered by the catalog for this spec/record? (case-insensitive for hex data types) */
export function inCatalog(spec: FieldSpec, c: Catalog, record: Json, value: Json): boolean {
  if (!spec.source) return true;
  const { values, unknown } = optionsFor(spec.source, c, record);
  if (unknown) return true;
  if (spec.source === "dataTypes" && typeof value === "string") {
    const h = normHex(value);
    return h !== null && values.includes(h);
  }
  return values.includes(typeof value === "number" ? String(value) : value);
}

/**
 * After the manufacturer or model of a hardware node changed: keep dependent
 * values when they are still offered, otherwise pick the first offered one.
 */
export function cascadeHardware(params: Json, c: Catalog): void {
  const m = findManufacturer(c, params.manufacture);
  if (!m) return;
  if (!m.models.some((x) => x.name === params.model)) params.model = m.models[0]?.name ?? "";
  const md = m.models.find((x) => x.name === params.model);
  if (!md) return;
  if (md.deserializers.length && !md.deserializers.includes(params.deserializer)) params.deserializer = md.deserializers[0];
  if ("serializer" in params && md.serializers.length && !md.serializers.includes(params.serializer)) params.serializer = md.serializers[0];
}

/** Default hardware params for a new board: first manufacturer / model / ICs in the catalog. */
export function defaultHardware(c: Catalog, withSerializer: boolean, preferSerializer?: string): Json {
  const m = c.hardware[0];
  const md = m?.models[0];
  const out: Json = { manufacture: m?.name ?? "", model: md?.name ?? "", deserializer: md?.deserializers[0] ?? "" };
  if (withSerializer) out.serializer = preferSerializer && md?.serializers.includes(preferSerializer) ? preferSerializer : (md?.serializers[0] ?? preferSerializer ?? "");
  return out;
}

/**
 * Tester camera: after the project camera model or the manufacturer changed, keep the
 * device manufacturer / model when the project still offers them, otherwise pick the first.
 */
export function cascadeTesterCamera(params: Json, c: Catalog, mode: Json): void {
  if (!c.ctx?.project?.root) return;
  const rec = { ...params, $mode: mode };
  const mans = optionsFor("projectManufacturers", c, rec).values;
  if (mans.length && !mans.includes(params.deviceManufacturer)) params.deviceManufacturer = mans[0];
  const models = optionsFor("projectDeviceModels", c, { ...params, $mode: mode }).values;
  if (models.length && !models.includes(params.deviceModel)) params.deviceModel = models[0];
}

// --------------------------------------------------------------------------
// Usage and renames (used by the Settings window)
// --------------------------------------------------------------------------
function* walkNodes(n: Node): Generator<Node> { yield n; for (const c of n.children) yield* walkNodes(c); }

export const usageKey = (source: CatalogSource, value: string, manufacturer = "", model = "") =>
  `${source}|${manufacturer}|${model}|${value}`;

/** How often each catalog value is used in a configuration tree. */
export function catalogUsage(root: Node): Map<string, number> {
  const use = new Map<string, number>();
  const add = (k: string) => use.set(k, (use.get(k) ?? 0) + 1);
  for (const n of walkNodes(root)) {
    const p = n.params ?? {};
    if (n.type === "mode" && Array.isArray(p.features)) p.features.forEach((f: string) => add(usageKey("features", f)));
    if (n.type === "camera") {
      if (p.imager) add(usageKey("imagers", p.imager));
      if (p.serializer) add(usageKey("serializers", p.serializer));
      if (p.packetFormat) add(usageKey("imageFormats", p.packetFormat));
    }
    if (n.type === "hwCapture" || n.type === "hwPassthrough") {
      if (p.manufacture) add(usageKey("manufacturers", p.manufacture));
      if (p.model) add(usageKey("models", p.model, p.manufacture));
      if (p.serializer) add(usageKey("hwSerializers", p.serializer, p.manufacture, p.model));
      if (p.deserializer) add(usageKey("hwDeserializers", p.deserializer, p.manufacture, p.model));
    }
    if (n.type === "testerCamera") {
      if (p.fpgaDevice) add(usageKey("fpgaDevices", p.fpgaDevice));
      if (p.fpgaBoardDefaults) add(usageKey("boardDefaults", p.fpgaBoardDefaults));
    }
    if (n.type === "testerVc" && p.debayer) add(usageKey("debayerConfigs", p.debayer));
    if (n.type === "vc" && Array.isArray(p.frameOutput)) {
      for (const o of p.frameOutput) {
        if (o?.dataFormat) add(usageKey("imageFormats", o.dataFormat));
        if (typeof o?.dataIdentifier === "string") add(usageKey("dataTypes", normHex(o.dataIdentifier) ?? o.dataIdentifier));
      }
    }
  }
  return use;
}

export interface Rename {
  source: CatalogSource;
  from: string;
  to: string;
  manufacturer?: string;   // scope for models / hw ICs (original names)
  model?: string;
}

/** Apply renames to a configuration tree (mutates – call inside an immer recipe). Returns the number of values changed. */
export function applyRenames(root: Node, renames: Rename[]): number {
  let changed = 0;
  const set = (obj: Json, key: string, r: Rename) => { if (obj[key] === r.from) { obj[key] = r.to; changed++; } };
  // hardware: match on original names first, rename manufacturer last
  const order: CatalogSource[] = ["hwSerializers", "hwDeserializers", "models", "manufacturers", "features", "imagers", "serializers", "imageFormats", "dataTypes", "fpgaDevices", "boardDefaults", "debayerConfigs"];
  const sorted = [...renames].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
  for (const r of sorted) {
    for (const n of walkNodes(root)) {
      const p = n.params ?? {};
      switch (r.source) {
        case "features":
          if (n.type === "mode" && Array.isArray(p.features)) p.features.forEach((f: string, i: number) => { if (f === r.from) { p.features[i] = r.to; changed++; } });
          break;
        case "imagers": if (n.type === "camera") set(p, "imager", r); break;
        case "fpgaDevices": if (n.type === "testerCamera") set(p, "fpgaDevice", r); break;
        case "boardDefaults": if (n.type === "testerCamera") set(p, "fpgaBoardDefaults", r); break;
        case "debayerConfigs": if (n.type === "testerVc") set(p, "debayer", r); break;
        case "serializers": if (n.type === "camera") set(p, "serializer", r); break;
        case "imageFormats":
          if (n.type === "camera") set(p, "packetFormat", r);
          if (n.type === "vc" && Array.isArray(p.frameOutput)) p.frameOutput.forEach((o: Json) => o && set(o, "dataFormat", r));
          break;
        case "dataTypes":
          if (n.type === "vc" && Array.isArray(p.frameOutput))
            p.frameOutput.forEach((o: Json) => { if (o && typeof o.dataIdentifier === "string" && normHex(o.dataIdentifier) === r.from) { o.dataIdentifier = r.to; changed++; } });
          break;
        default:
          if (n.type !== "hwCapture" && n.type !== "hwPassthrough") break;
          if (r.source === "manufacturers") set(p, "manufacture", r);
          else if (p.manufacture === r.manufacturer) {
            if (r.source === "models") set(p, "model", r);
            else if (p.model === r.model) set(p, r.source === "hwSerializers" ? "serializer" : "deserializer", r);
          }
      }
    }
  }
  return changed;
}
