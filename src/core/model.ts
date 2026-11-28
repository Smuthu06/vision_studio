/**
 * Configuration tree model: node types, allowed children, JSON (de)serialisation
 * and validation.  Pure TypeScript – the UI only consumes these functions.
 *
 * Every node owns `params`: its JSON body exactly as it appears in the file,
 * minus keys represented by child nodes.  Unknown keys are preserved.
 */
import {
  BIT_MODES, BYTE_ORDERS, CORPORATE_EMAIL_DOMAIN, CRC_ALGORITHMS, DEFAULT_SCHEMA_VERSION, EL_FAULT_MODES,
  EL_OPERATIONS, ERROR, FEATURES, FEATURE_DATALOGGER, FEATURE_FAULTINJECTION, FRAME_OUTPUT_NAMES,
  GPIO_DIRECTIONS, GPIO_PINS, HW_KEY_CAPTURE, HW_KEY_PASSTHROUGH, I2C_ACK_NACK, I2C_COMMAND_TYPES,
  I2C_REG_MODES, LINK_OPTIONS, MODE_CAPTURE, MODE_PASSTHROUGH, MONITOR_MODES, PACKET_FORMATS, PROJECT_MODES,
  RE_AUTHOR, RE_DATE, RE_EMAIL, RE_IDENT, RE_PROJECT_NAME, RE_SEMVER, RE_VERSION, SERIAL_CHANNEL_MAX, VC_MAX,
  VC_NAME_SUGGESTIONS, WARNING, checkRecord, getPath, isInt, isNum, isRealDate, ordered, todayDDMMYYYY,
  type FieldSpec, type Json, type Severity, type TableSpec,
} from "./schema";

export type NodeType =
  | "project" | "modes" | "mode" | "cameras" | "camera" | "hardware" | "hwCapture" | "hwPassthrough"
  | "frames" | "vc" | "fault" | "monitoring";

export type IconName =
  | "project" | "modes" | "mode" | "camera" | "cameras" | "hardware" | "chip" | "film" | "vc" | "fault" | "gauge"
  | "gpio" | "stream" | "inject" | "ic";

export interface CNode {
  id: string;
  type: NodeType;
  params: Json;
  children: CNode[];
  jsonKey?: string;     // hw entries: original key ("CaptureMode" / "passthroughMode")
  unknown?: Json[];     // hardware container: unrecognised entries (preserved)
}

export interface Issue {
  severity: Severity;
  message: string;
  nodeId: string;
  field?: string;
  table?: string;       // table id: params path, e.g. "frameOutput[1].embeddedLine[0].info"
  row?: number;
  column?: string;
}

export interface ChildOption {
  label: string;
  type: NodeType;
  icon: IconName;
  description: string;
  enabled: boolean;
  reason?: string;
  create: () => CNode;
}

export class LoadError extends Error {}

let seq = 0;
export const newId = () => `n${Date.now().toString(36)}${(++seq).toString(36)}`;
export function mk(type: NodeType, params?: Json, children: CNode[] = [], extra: Partial<CNode> = {}): CNode {
  return { id: newId(), type, params: params === undefined ? DEFS[type].defaultParams() : structuredClone(params), children, ...extra };
}

/** Index of a tree for parent / ancestor lookups. */
export class TreeIndex {
  byId = new Map<string, CNode>();
  parent = new Map<string, CNode | null>();
  constructor(public root: CNode) {
    const visit = (n: CNode, p: CNode | null) => {
      this.byId.set(n.id, n);
      this.parent.set(n.id, p);
      n.children.forEach((c) => visit(c, n));
    };
    visit(root, null);
  }
  get(id: string | null | undefined) { return id ? this.byId.get(id) : undefined; }
  parentOf(n: CNode) { return this.parent.get(n.id) ?? null; }
  path(n: CNode): CNode[] {
    const out: CNode[] = [];
    let cur: CNode | null = n;
    while (cur) { out.unshift(cur); cur = this.parent.get(cur.id) ?? null; }
    return out;
  }
  ancestor(n: CNode, type: NodeType): CNode | null {
    let cur = this.parent.get(n.id) ?? null;
    while (cur && cur.type !== type) cur = this.parent.get(cur.id) ?? null;
    return cur;
  }
  siblings(n: CNode): CNode[] {
    const p = this.parentOf(n);
    return p ? p.children.filter((c) => c !== n && c.type === n.type) : [];
  }
}

export const findChild = (n: CNode, type: NodeType) => n.children.find((c) => c.type === type);
export function* walk(n: CNode): Generator<CNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// --------------------------------------------------------------------------
// Table specs
// --------------------------------------------------------------------------
const ADDR: Partial<FieldSpec> = { kind: "int", min: 0, max: 255, hex: true };

export const GPIO_TABLE: TableSpec = {
  key: "gpioRouting", title: "GPIO Routing", docId: "gpio", icon: "gpio", addLabel: "Add Route", itemName: "Route",
  help: "Backplane GPIO routing for ECU-to-camera communication.",
  columns: [
    { key: "direction", label: "Direction", kind: "enum", options: GPIO_DIRECTIONS, default: GPIO_DIRECTIONS[0], help: "SO to SI = Serializer Output to Serializer Input", width: 120 },
    { key: "serialChannel", label: "Channel", kind: "int", min: 0, max: SERIAL_CHANNEL_MAX, default: 0, help: "Serial link channel (0–3)", width: 90 },
    { key: "source", label: "Source", kind: "enum", options: GPIO_PINS, default: GPIO_PINS[0], help: "FPGA source pin", width: 110 },
    { key: "destination", label: "Destination", kind: "enum", options: GPIO_PINS, default: GPIO_PINS[0], help: "FPGA destination pin", width: 110 },
  ],
  factory: (rows) => {
    const last = rows[rows.length - 1];
    const ch = last && isInt(last.serialChannel) ? last.serialChannel : 0;
    const used = new Set(rows.filter((r) => r && typeof r === "object").map((r) => `${r.serialChannel}|${r.source}`));
    const pin = GPIO_PINS.find((p) => !used.has(`${ch}|${p}`)) ?? GPIO_PINS[0];
    return { direction: GPIO_DIRECTIONS[0], serialChannel: ch, source: pin, destination: pin };
  },
};

export function autoGpioRoutes(params: Json, channel = 0, direction = GPIO_DIRECTIONS[0]): number {
  if (!Array.isArray(params.gpioRouting)) params.gpioRouting = [];
  const rows: Json[] = params.gpioRouting;
  const used = new Set(rows.filter((r) => r && typeof r === "object").map((r) => `${r.serialChannel}|${r.source}`));
  let added = 0;
  for (const pin of GPIO_PINS) {
    if (!used.has(`${channel}|${pin}`)) {
      rows.push({ direction, serialChannel: channel, source: pin, destination: pin });
      added++;
    }
  }
  return added;
}

export const FRAME_OUTPUT_TABLE: TableSpec = {
  key: "frameOutput", title: "Frame Outputs", docId: "frameOutput", icon: "stream", addLabel: "Add Output", itemName: "Output",
  help: "Stream layouts transmitted over this virtual channel.",
  columns: [
    { key: "name", label: "Name", suggestions: FRAME_OUTPUT_NAMES, default: "Image", help: "Stream name: Image, Header, Metadata", width: 130 },
    { key: "dataIdentifier", label: "Data ID", kind: "hexstr", min: 0, max: 0x3f, hex: true, default: "0x2A", help: "MIPI CSI-2 data type identifier (0x00–0x3F)", width: 90 },
    { key: "dataFormat", label: "Format", kind: "enum", options: PACKET_FORMATS, default: "raw16", width: 100 },
    { key: "xSize", label: "Width", kind: "int", min: 1, max: 16384, default: 1920, help: "Horizontal resolution (pixels)", width: 90 },
    { key: "ySize", label: "Height", kind: "int", min: 1, max: 16384, default: 1080, help: "Vertical resolution (lines)", width: 90 },
  ],
  factory: (rows) => {
    const names = new Set(rows.map((r) => r?.name));
    if (!names.has("Image")) return { name: "Image", dataIdentifier: "0x2A", dataFormat: "raw16", xSize: 1920, ySize: 1080 };
    const last = rows[rows.length - 1] ?? {};
    return { name: "Header", dataIdentifier: "0x12", dataFormat: "raw8", xSize: last.xSize ?? 1920, ySize: 1 };
  },
};

export const EMBEDDED_LINE_TABLE: TableSpec = {
  key: "embeddedLine", title: "Embedded Lines", docId: "embeddedLine", icon: "stream", addLabel: "Add Line", itemName: "Line",
  columns: [
    { key: "lineNumber", label: "Line #", kind: "int", min: 0, default: 0, width: 80 },
    { key: "tag_included", label: "Tag Included", kind: "bool", default: false, width: 100 },
    { key: "byte_order", label: "Byte Order", kind: "enum", options: BYTE_ORDERS, default: BYTE_ORDERS[0], help: "Spelling 'Little Indian' is kept as defined by the schema", width: 130 },
  ],
  factory: (rows) => {
    const nums = rows.map((r) => r?.lineNumber).filter(isInt);
    return { lineNumber: nums.length ? Math.max(...nums) + 1 : 0, tag_included: false, byte_order: BYTE_ORDERS[0], info: [] };
  },
};

export const EMBEDDED_INFO_TABLE: TableSpec = {
  key: "info", title: "Line Fields", docId: "embeddedInfo", addLabel: "Add Field", itemName: "Field",
  columns: [
    { key: "name", label: "Name", default: "", help: "e.g. Frame Counter", width: 160 },
    { key: "offset", label: "Offset", kind: "int", min: 0, default: 0, help: "Byte offset within the line", width: 80 },
    { key: "length", label: "Length", kind: "int", min: 1, default: 1, help: "Field length in bytes", width: 80 },
    { key: "Formula", label: "Formula", required: false, default: "", help: "Optional conversion formula", width: 140 },
  ],
};

export const EL_FAULT_TABLE: TableSpec = {
  key: "embeddedLine", title: "Embedded Line Injection", docId: "elFault", primary: ["faultName", "virtualChannel", "lineNumber", "position", "length", "mode", "faultValues", "operation"], icon: "inject", addLabel: "Add Fault", itemName: "EL fault",
  help: "Corrupt specific bytes inside the CSI-2 embedded line (e.g. over-temperature injection).",
  columns: [
    { key: "faultName", label: "Fault Name", default: "", width: 180 },
    { key: "description", label: "Description", required: false, default: "", width: 160 },
    { key: "virtualChannel", label: "VC", kind: "int", min: 0, max: VC_MAX, default: 0, help: "Target virtual channel (0–15)", width: 60 },
    { key: "dataIdentifier", label: "Data ID", kind: "int", min: 0, max: 0x3f, default: 0x12, help: "Embedded line data identifier (decimal or 0x-hex)", width: 80 },
    { key: "lineNumber", label: "Line #", kind: "int", min: 0, default: 0, width: 70 },
    { key: "position", label: "Position", kind: "int", min: 0, default: 0, help: "Byte start index within the line", width: 80 },
    { key: "length", label: "Length", kind: "int", min: 1, default: 1, help: "Corrupted byte count", width: 70 },
    { key: "mode", label: "Mode", kind: "intenum", intOptions: EL_FAULT_MODES, default: 0, width: 120 },
    { key: "faultValues", label: "Fault Values", kind: "hexstr", default: "00", help: "Hex payload to write", width: 100 },
    { key: "crcAlgorithm", label: "CRC", kind: "intenum", intOptions: CRC_ALGORITHMS, default: 0, width: 110 },
    { key: "crcPosition", label: "CRC Pos.", kind: "int", min: 0, default: 0, width: 80 },
    { key: "enableMipiCrcFault", label: "MIPI CRC Fault", kind: "bool", default: false, width: 110 },
    { key: "operation", label: "Operation", kind: "intenum", intOptions: EL_OPERATIONS, default: 0, width: 140 },
    { key: "frameQuantity", label: "Frames", kind: "int", min: 0, default: 0, help: "Duration in frames (0 = indefinite)", width: 80 },
  ],
  factory: (rows) => ({
    faultName: `EL_Fault_${rows.length + 1}`, description: "", virtualChannel: 0, dataIdentifier: 0x12, lineNumber: 0,
    position: 0, length: 1, mode: 0, faultValues: "00", crcAlgorithm: 0, crcPosition: 0, enableMipiCrcFault: false,
    operation: 0, frameQuantity: 0,
  }),
};

export const I2C_FAULT_TABLE: TableSpec = {
  key: "i2c", title: "I2C Injection", docId: "i2cFault", primary: ["faultName", "slaveAdress", "i2cMode", "registerAdress", "commandType", "faultValues"], icon: "ic", addLabel: "Add Fault", itemName: "I2C fault",
  help: "Intercept SerDes or sensor I2C transactions.",
  columns: [
    { key: "faultName", label: "Fault Name", default: "", width: 200 },
    { key: "description", label: "Description", required: false, default: "", width: 220 },
    { key: "slaveAdress", label: "Slave Addr.", ...ADDR, default: 0, help: "7-bit / 8-bit slave I2C address", width: 90 } as FieldSpec,
    { key: "i2cMode", label: "Register Width", kind: "intenum", intOptions: I2C_REG_MODES, default: 1, width: 150 },
    { key: "registerAdress", label: "Register", kind: "hexstr", default: "0000", help: "Hex register address", width: 90 },
    { key: "commandType", label: "Command", kind: "intenum", intOptions: I2C_COMMAND_TYPES, default: 0, width: 100 },
    { key: "interceptAttempt", label: "Intercept #", kind: "int", min: 0, max: 255, default: 255, help: "Trigger count (255 = all)", width: 90 },
    { key: "faultValues", label: "Fault Values", kind: "hexstr", default: "00", help: "Corrupted payload byte(s)", width: 100 },
    { key: "setAckNack", label: "ACK/NACK", kind: "intenum", intOptions: I2C_ACK_NACK, default: 0, width: 130 },
  ],
  factory: (rows) => ({
    faultName: `I2C_Fault_${rows.length + 1}`, description: "", slaveAdress: 0, i2cMode: 1, registerAdress: "0000",
    commandType: 0, interceptAttempt: 255, faultValues: "00", setAckNack: 0,
  }),
};

const REG_LIST: Partial<FieldSpec> = { kind: "intlist", min: 0, max: 255, hex: true, default: [0, 0], width: 120 };

export const REGISTER_MONITOR_TABLE: TableSpec = {
  key: "register_monitor", title: "Register Monitor", docId: "registerMonitor", primary: ["Slave Address", "Register(s)", "Mask", "Expectation", "Link Options", "Bit Mode"], icon: "ic", addLabel: "Add Monitor", itemName: "Register monitor",
  columns: [
    { key: "Mode", label: "Mode", kind: "enum", options: MONITOR_MODES, default: "Read", width: 80 },
    { key: "Slave Address", label: "Slave Addr.", ...ADDR, default: 0x51, width: 90 } as FieldSpec,
    { key: "Register(s)", label: "Register(s)", ...REG_LIST, help: "Register address bytes, e.g. 0x00, 0x13" } as FieldSpec,
    { key: "Mask", label: "Mask", ...ADDR, default: 0, width: 70 } as FieldSpec,
    { key: "Expectation", label: "Expect", ...ADDR, default: 0, width: 70 } as FieldSpec,
    { key: "Error String", label: "Error String", required: false, default: "", width: 260 },
    { key: "Link Options", label: "Link", kind: "enum", options: LINK_OPTIONS, default: "Link A", width: 90 },
    { key: "Bit Mode", label: "Bit Mode", kind: "enum", options: BIT_MODES, default: "16-Bit", width: 90 },
    { key: "Read Bytes", label: "Read Bytes", kind: "int", min: 1, max: 8, default: 1, width: 90 },
  ],
};

export const ERROR_COUNT_TABLE: TableSpec = {
  key: "error_count", title: "Error Counters", docId: "errorCount", icon: "ic", addLabel: "Add Counter", itemName: "Error counter",
  columns: [
    { key: "Mode", label: "Mode", kind: "enum", options: MONITOR_MODES, default: "Read", width: 80 },
    { key: "Slave Address", label: "Slave Addr.", ...ADDR, default: 0x51, width: 90 } as FieldSpec,
    { key: "Register(s)", label: "Register(s)", ...REG_LIST } as FieldSpec,
    { key: "Mask", label: "Mask", ...ADDR, default: 0, width: 70 } as FieldSpec,
    { key: "Error Description", label: "Error Description", required: false, default: "", width: 300 },
    { key: "Link Options", label: "Link", kind: "enum", options: LINK_OPTIONS, default: "Link A", width: 90 },
  ],
};

export const TEMPERATURE_MONITOR_TABLE: TableSpec = {
  key: "temperature_monitor", title: "Temperature Monitor", docId: "temperatureMonitor", primary: ["Slave Address", "Register(s)_IntegerBit", "Register(s)_FractionBit", "Min Limit", "Max Limit", "Link Options"], icon: "gauge", addLabel: "Add Sensor", itemName: "Temperature monitor",
  columns: [
    { key: "Mode", label: "Mode", kind: "enum", options: MONITOR_MODES, default: "Read", width: 80 },
    { key: "Slave Address", label: "Slave Addr.", ...ADDR, default: 0x35, width: 90 } as FieldSpec,
    { key: "Register(s)_IntegerBit", label: "Integer Reg(s)", ...REG_LIST } as FieldSpec,
    { key: "Register(s)_FractionBit", label: "Fraction Reg(s)", ...REG_LIST } as FieldSpec,
    { key: "Min Limit", label: "Min °C", kind: "float", default: -40, width: 80 },
    { key: "Max Limit", label: "Max °C", kind: "float", default: 125, width: 80 },
    { key: "Value", label: "Value", kind: "float", default: 0, width: 70 },
    { key: "Description", label: "Description", required: false, default: "", width: 260 },
    { key: "Link Options", label: "Link", kind: "enum", options: LINK_OPTIONS, default: "Link A", width: 90 },
  ],
};

// --------------------------------------------------------------------------
// Node definitions
// --------------------------------------------------------------------------
export interface NodeDef {
  type: NodeType;
  title: string;
  addLabel?: string;
  icon: IconName;
  description: string;
  fields?: FieldSpec[];
  tables?: TableSpec[];
  tableLayout?: "stack" | "tabs";
  childTypes?: NodeType[];
  singleton?: boolean;     // at most one per parent (default true)
  deletable?: boolean;     // default true
  duplicable?: boolean;
  jsonOrder?: string[];
  defaultParams: () => Json;
  label?: (n: CNode) => string;
  summary?: (n: CNode) => string;
  create?: (parent: CNode, idx: TreeIndex) => CNode;
  childOptions?: (n: CNode, idx: TreeIndex) => ChildOption[];
  checks?: (n: CNode, idx: TreeIndex) => Issue[];
}

const hwFields = (serializerRequired: boolean): FieldSpec[] => [
  { key: "manufacture", label: "Manufacturer", help: "Hardware vendor, e.g. NationalInstruments", suggestions: ["NationalInstruments"] },
  { key: "model", label: "Board Model", help: "PXIe FPGA frame grabber / SerDes interface board, e.g. NI1487" },
  { key: "deserializer", label: "Deserializer IC", help: "Receiver deserializer chip on the interface board", placeholder: "e.g. DES_IC_PART_B" },
  { key: "serializer", label: "Serializer IC", required: serializerRequired, placeholder: "e.g. SER_IC_PART_A",
    help: serializerRequired ? "Transmitter serializer – mandatory for passthroughMode" : "Optional in CaptureMode" },
];

const VC_DEFAULT_NAMES: Record<number, string> = { 0: "Front", 1: "Rear", 2: "Left", 3: "Right" };
export function makeVc(number: number, packetFormat = "raw16"): CNode {
  const out = FRAME_OUTPUT_TABLE.factory!([]);
  out.dataFormat = (PACKET_FORMATS as readonly string[]).includes(packetFormat) ? packetFormat : "raw16";
  return mk("vc", { virtualChannelNumber: number, virtualChannelName: VC_DEFAULT_NAMES[number] ?? "VC", fps: { max: 30.1, min: 29.9 }, frameOutput: [out] });
}
const nextVcNumber = (frames: CNode): number | null => {
  const used = new Set(frames.children.map((c) => c.params.virtualChannelNumber));
  for (let n = 0; n <= VC_MAX; n++) if (!used.has(n)) return n;
  return null;
};

/** {mode: Set(features)} of the project that the tree index belongs to. */
export function projectModes(idx: TreeIndex): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const modes = idx.root.type === "project" ? findChild(idx.root, "modes") : undefined;
  for (const m of modes?.children ?? []) out.set(m.params.mode, new Set(Array.isArray(m.params.features) ? m.params.features : []));
  return out;
}

const issue = (severity: Severity, message: string, n: CNode, extra: Partial<Issue> = {}): Issue =>
  ({ severity, message, nodeId: n.id, ...extra });

export const DEFS: Record<NodeType, NodeDef> = {
  project: {
    type: "project", title: "Project", icon: "project", deletable: false,
    description: "Project metadata for the camera test bench configuration.",
    childTypes: ["modes", "cameras"],
    fields: [
      { key: "project", label: "Project Name", pattern: RE_PROJECT_NAME, hint: "may only contain letters, digits and underscores", help: "e.g. ADAS_Vision_Project_Sample" },
      { key: "version", label: "Version", pattern: RE_VERSION, hint: "must have the form V.<major>.<minor>.<patch>, e.g. V.1.0.0", help: "Format V.x.y.z, e.g. V.1.0.0" },
      { key: "author", label: "Author", pattern: RE_AUTHOR, hint: "must be a short user name (letters, digits, _ . -)", help: "User identifier, e.g. engineer_user", placeholder: "engineer_user" },
      { key: "emailAddress", label: "Email Address", pattern: RE_EMAIL, hint: "is not a valid email address", help: `Corporate email, e.g. engineer@${CORPORATE_EMAIL_DOMAIN || "company.com"}`, placeholder: `name@${CORPORATE_EMAIL_DOMAIN || "company.com"}` },
      { key: "date", label: "Date", pattern: RE_DATE, hint: "must be DD/MM/YYYY or DD-MM-YYYY", help: "Creation / revision date (DD-MM-YYYY or DD/MM/YYYY)" },
      { key: "schemaVersion", label: "Schema Version", pattern: RE_SEMVER, hint: "must be a semantic version, e.g. 1.0.0", help: "Schema specification version (default 1.0.0)" },
    ],
    jsonOrder: ["author", "emailAddress", "version", "date", "project", "projectModes", "cameraModels", "schemaVersion"],
    defaultParams: () => ({ author: "", emailAddress: "", version: "V.1.0.0", date: todayDDMMYYYY(), project: "New_Project", schemaVersion: DEFAULT_SCHEMA_VERSION }),
    label: (n) => String(n.params.project || "(unnamed project)"),
    checks: (n) => {
      const out: Issue[] = [];
      const d = n.params.date;
      if (typeof d === "string" && RE_DATE.test(d) && !isRealDate(d)) out.push(issue(ERROR, `Date '${d}' is not a valid calendar date`, n, { field: "date" }));
      const e = n.params.emailAddress;
      if (CORPORATE_EMAIL_DOMAIN && typeof e === "string" && RE_EMAIL.test(e) && !e.toLowerCase().endsWith("@" + CORPORATE_EMAIL_DOMAIN))
        out.push(issue(WARNING, `Email Address should be a corporate address (*@${CORPORATE_EMAIL_DOMAIN})`, n, { field: "emailAddress" }));
      // Missing sections are not validation issues – the build guide tracks what is left to add.
      return out;
    },
  },

  modes: {
    type: "modes", title: "Project Modes", icon: "modes", childTypes: ["mode"],
    description: "Operational test bench modes enabled for this project.",
    defaultParams: () => ({}),
    summary: (n) => n.children.map((c) => c.params.mode).join(", ") || "empty",
    childOptions: (n) => {
      const present = new Set(n.children.map((c) => c.params.mode));
      return PROJECT_MODES.map((m) => ({
        label: `Add ${m}`, type: "mode" as NodeType, icon: "mode" as IconName, enabled: !present.has(m),
        reason: present.has(m) ? "already present" : undefined,
        description: m === MODE_CAPTURE ? "Camera → frame grabber capture" : "Camera ↔ bench ↔ ECU routing",
        create: () => mk("mode", { mode: m, features: [FEATURE_DATALOGGER] }),
      }));
    },
  },

  mode: {
    type: "mode", title: "Mode", icon: "mode", singleton: false,
    description: "Operational hardware routing mode. DataLogger logs frame data to disk; FaultInjection enables controlled error injection.",
    fields: [
      { key: "mode", label: "Mode", kind: "enum", options: PROJECT_MODES, help: "CaptureMode: DUT → frame grabber. PassthroughMode: camera ↔ ECU routed through the bench." },
      { key: "features", label: "Features", kind: "multi", options: FEATURES, required: false, help: "Bench features enabled in this mode" },
    ],
    jsonOrder: ["mode", "features"],
    defaultParams: () => ({ mode: MODE_CAPTURE, features: [FEATURE_DATALOGGER] }),
    label: (n) => String(n.params.mode || "Mode"),
    summary: (n) => (Array.isArray(n.params.features) && n.params.features.length ? n.params.features.join(", ") : "no features"),
    checks: (n, idx) => {
      const out: Issue[] = [];
      const mode = n.params.mode;
      if (idx.siblings(n).some((s) => s.params.mode === mode)) out.push(issue(ERROR, `Mode '${mode}' is defined more than once`, n, { field: "mode" }));
      if (mode === MODE_CAPTURE && Array.isArray(n.params.features) && n.params.features.includes(FEATURE_FAULTINJECTION))
        out.push(issue(WARNING, "FaultInjection acts on the passthrough (camera ↔ ECU) link; it has no effect in CaptureMode", n, { field: "features" }));
      return out;
    },
  },

  cameras: {
    type: "cameras", title: "Camera Models", icon: "cameras", childTypes: ["camera"],
    description: "Device Under Test (DUT) camera models configured in this project.",
    defaultParams: () => ({}),
    summary: (n) => `${n.children.length} camera model(s)`,
  },

  camera: {
    type: "camera", title: "Camera Model", icon: "camera", singleton: false, duplicable: true,
    description: "Device Under Test (DUT) camera hardware.",
    childTypes: ["hardware", "frames", "fault", "monitoring"],
    fields: [
      { key: "model", label: "Model", help: "Camera model identifier, e.g. ADAS_Camera_Model_A" },
      { key: "packetFormat", label: "Packet Format", kind: "enum", options: PACKET_FORMATS, help: "MIPI CSI-2 raw packet encoding" },
      { key: "imager", label: "Imager", pattern: RE_IDENT, hint: "must be an identifier (letters, digits, _ . -)", help: "Sensor IC model, e.g. SENSOR_MODEL_X", placeholder: "e.g. SENSOR_MODEL_X" },
      { key: "operatingVoltage", label: "Operating Voltage (V)", kind: "float", min: 1, max: 48, help: "Nominal supply voltage, 1.0–48.0 V" },
      { key: "serializer", label: "Serializer IC", help: "Camera serializer IC part number", placeholder: "e.g. SER_IC_PART_A" },
      { key: "imagerAddress", label: "Imager I2C Address", kind: "int", min: 0, max: 255, hex: true, help: "Sensor I2C slave address (0–255), decimal or 0x-hex" },
      { key: "eeprom.Lenght", label: "EEPROM Length", kind: "int", min: 0, help: "Calibration EEPROM length (schema key 'Lenght')" },
      { key: "eeprom.Address", label: "EEPROM Address(es)", kind: "intlist", min: 0, hex: true, help: "Comma separated list, e.g. 0x50, 0x51", placeholder: "e.g. 0x50, 0x51" },
      { key: "eepromHashRegAddress", label: "Hash Register Address", kind: "int", min: 0, hex: true, help: "Hash register start address" },
      { key: "lenghtHash", label: "Hash Length (bytes)", kind: "int", min: 0, help: "Byte length of calibration hash (schema key 'lenghtHash')" },
    ],
    jsonOrder: ["model", "packetFormat", "imager", "operatingVoltage", "serializer", "eeprom", "imagerAddress",
      "eepromHashRegAddress", "lenghtHash", "hw", "frameInformation", "faultInjection", "i2c_monitoring"],
    defaultParams: () => ({ model: "Camera_Model", packetFormat: "raw16", imager: "", operatingVoltage: 12, serializer: "",
      eeprom: { Lenght: 0, Address: [] }, imagerAddress: 0, eepromHashRegAddress: 0, lenghtHash: 0 }),
    label: (n) => String(n.params.model || "(unnamed camera)"),
    summary: (n) => {
      const vcs = findChild(n, "frames")?.children.length ?? 0;
      return [n.params.packetFormat, n.params.imager, `${vcs} VC`].filter(Boolean).join(" · ");
    },
    create: (parent) => {
      const taken = new Set(parent.children.map((c) => c.params.model));
      return mk("camera", { ...DEFS.camera.defaultParams(), model: uniqueName("Camera_Model", taken) });
    },
    checks: (n, idx) => {
      const out: Issue[] = [];
      const model = n.params.model;
      if (model && idx.siblings(n).some((s) => s.params.model === model)) out.push(issue(ERROR, `Camera model '${model}' is defined more than once`, n, { field: "model" }));
      const modes = projectModes(idx);
      const hw = findChild(n, "hardware");
      if (modes.has(MODE_CAPTURE) && !(hw && findChild(hw, "hwCapture")))
        out.push(issue(WARNING, "CaptureMode is enabled but this camera has no Capture Hardware", n));
      if (modes.has(MODE_PASSTHROUGH) && !(hw && findChild(hw, "hwPassthrough")))
        out.push(issue(WARNING, "PassthroughMode is enabled but this camera has no Passthrough Hardware", n));
      const frames = findChild(n, "frames");
      if (!frames || !frames.children.length) out.push(issue(WARNING, "No virtual channels defined (add Frame Information)", n));
      return out;
    },
  },

  hardware: {
    type: "hardware", title: "Hardware", icon: "hardware", childTypes: ["hwCapture", "hwPassthrough"],
    description: "Mode-specific FPGA boards and serializer/deserializer pairings.",
    defaultParams: () => ({}),
    summary: (n) => n.children.map((c) => DEFS[c.type].title).join(", ") || "empty",
    checks: (n) => (n.unknown ?? []).map((e) => issue(WARNING, `Unrecognised hardware entry '${Object.keys(e).join(", ")}' is preserved but not editable`, n)),
  },

  hwCapture: {
    type: "hwCapture", title: "Capture Hardware", icon: "chip",
    description: "FPGA frame grabber used in CaptureMode.",
    fields: hwFields(false),
    jsonOrder: ["manufacture", "model", "serializer", "deserializer", "gpioRouting"],
    defaultParams: () => ({ manufacture: "NationalInstruments", model: "NI1487", deserializer: "" }),
    label: (n) => (n.params.model ? `Capture Hardware (${n.params.model})` : "Capture Hardware"),
    summary: (n) => [n.params.manufacture, n.params.model, n.params.deserializer].filter(Boolean).join(" · "),
    create: () => mk("hwCapture", undefined, [], { jsonKey: HW_KEY_CAPTURE }),
    checks: (n, idx) => serializerCheck(n, idx),
  },

  hwPassthrough: {
    type: "hwPassthrough", title: "Passthrough Hardware", icon: "chip",
    description: "SerDes interface board used in PassthroughMode (camera ↔ bench ↔ ECU). A serializer is mandatory; GPIO routing maps backplane pins for ECU-to-camera communication.",
    fields: hwFields(true),
    tables: [GPIO_TABLE],
    jsonOrder: ["manufacture", "model", "serializer", "deserializer", "gpioRouting"],
    defaultParams: () => ({ manufacture: "NationalInstruments", model: "NI1487", serializer: "", deserializer: "", gpioRouting: [] }),
    label: (n) => (n.params.model ? `Passthrough Hardware (${n.params.model})` : "Passthrough Hardware"),
    summary: (n) => [n.params.manufacture, n.params.model, `${(n.params.gpioRouting ?? []).length} GPIO routes`].filter(Boolean).join(" · "),
    create: (parent, idx) => {
      const node = mk("hwPassthrough", undefined, [], { jsonKey: HW_KEY_PASSTHROUGH });
      const cam = idx.get(parent.id) ? idx.ancestor(parent, "camera") : null;
      if (cam) node.params.serializer = cam.params.serializer || "";
      const cap = findChild(parent, "hwCapture");
      if (cap) node.params.deserializer = cap.params.deserializer || "";
      return node;
    },
    checks: (n, idx) => {
      const out = serializerCheck(n, idx);
      const routes = n.params.gpioRouting;
      if (!Array.isArray(routes)) return out;
      const src = new Map<string, number>(), dst = new Map<string, number>();
      routes.forEach((r: Json, i: number) => {
        if (!r || typeof r !== "object") return;
        const ks = `${r.serialChannel}|${r.direction}|${r.source}`, kd = `${r.serialChannel}|${r.direction}|${r.destination}`;
        if (src.has(ks)) out.push(issue(ERROR, `Route ${i + 1}: ${r.source} on channel ${r.serialChannel} is already routed by route ${src.get(ks)! + 1}`, n, { table: "gpioRouting", row: i, column: "source" }));
        else src.set(ks, i);
        if (dst.has(kd)) out.push(issue(WARNING, `Route ${i + 1}: destination ${r.destination} on channel ${r.serialChannel} is also driven by route ${dst.get(kd)! + 1}`, n, { table: "gpioRouting", row: i, column: "destination" }));
        else dst.set(kd, i);
      });
      return out;
    },
  },

  frames: {
    type: "frames", title: "Frame Information", icon: "film", childTypes: ["vc"],
    description: "MIPI CSI-2 virtual channels (VC0–VC15) output by the SerDes link.",
    defaultParams: () => ({}),
    summary: (n) => `${n.children.length} virtual channel(s)`,
    childOptions: (n, idx) => {
      const num = nextVcNumber(n);
      const cam = idx.get(n.id) ? idx.ancestor(n, "camera") : null;
      return [{
        label: "Add Virtual Channel", type: "vc", icon: "vc", enabled: num !== null,
        reason: num === null ? "all 16 virtual channels in use" : undefined,
        description: num !== null ? `Next free: VC${num}` : "",
        create: () => makeVc(nextVcNumber(n) ?? 0, cam?.params.packetFormat ?? "raw16"),
      }];
    },
  },

  vc: {
    type: "vc", title: "Virtual Channel", icon: "vc", singleton: false, duplicable: true,
    description: "MIPI CSI-2 virtual channel output by the SerDes link and the streams it carries.",
    fields: [
      { key: "virtualChannelNumber", label: "Virtual Channel #", kind: "int", min: 0, max: VC_MAX, help: "MIPI CSI-2 virtual channel index (0–15)" },
      { key: "virtualChannelName", label: "Name", suggestions: VC_NAME_SUGGESTIONS, help: "Friendly identifier, e.g. Front" },
      { key: "fps.min", label: "FPS Min", kind: "float", min: 0.01, max: 1000, help: "Lower acceptable frame-rate boundary" },
      { key: "fps.max", label: "FPS Max", kind: "float", min: 0.01, max: 1000, help: "Upper acceptable frame-rate boundary" },
    ],
    tables: [FRAME_OUTPUT_TABLE],
    jsonOrder: ["virtualChannelNumber", "virtualChannelName", "fps", "frameOutput"],
    defaultParams: () => makeVc(0).params,
    label: (n) => (n.params.virtualChannelName ? `VC${n.params.virtualChannelNumber} (${n.params.virtualChannelName})` : `VC${n.params.virtualChannelNumber}`),
    summary: (n) => {
      const fps = n.params.fps ?? {};
      const outs = Array.isArray(n.params.frameOutput) ? n.params.frameOutput : [];
      return [`${fps.min}–${fps.max} fps`, outs.map((o: Json) => `${o?.name} ${o?.xSize}×${o?.ySize}`).join(", ")].filter(Boolean).join(" · ");
    },
    checks: (n, idx) => vcChecks(n, idx),
  },

  fault: {
    type: "fault", title: "Fault Injection", icon: "fault",
    description: "Simulate real-time link corruptions, temperature spikes and I2C protocol faults.",
    tables: [EL_FAULT_TABLE, I2C_FAULT_TABLE], tableLayout: "tabs",
    jsonOrder: ["embeddedLine", "i2c"],
    defaultParams: () => ({ embeddedLine: [], i2c: [] }),
    summary: (n) => `${(n.params.embeddedLine ?? []).length} embedded-line, ${(n.params.i2c ?? []).length} I2C`,
    checks: (n, idx) => faultChecks(n, idx),
  },

  monitoring: {
    type: "monitoring", title: "I2C Monitoring", icon: "gauge",
    description: "Continuous health verification of SerDes link integrity over I2C.",
    tables: [REGISTER_MONITOR_TABLE, ERROR_COUNT_TABLE, TEMPERATURE_MONITOR_TABLE], tableLayout: "tabs",
    jsonOrder: ["register_monitor", "error_count", "temperature_monitor"],
    defaultParams: () => ({ register_monitor: [], error_count: [], temperature_monitor: [] }),
    summary: (n) => DEFS.monitoring.tables!.map((t) => `${(n.params[t.key] ?? []).length} ${t.title.toLowerCase()}`).join(", "),
    checks: (n) => monitoringChecks(n),
  },
};

const ADD_DESCRIPTIONS: Partial<Record<NodeType, string>> = {
  modes: "CaptureMode / PassthroughMode and their features",
  cameras: "Device-under-test camera models",
  camera: "A new DUT camera with its parameters",
  hardware: "FPGA boards & SerDes pairing per mode",
  frames: "MIPI CSI-2 virtual channels and streams",
  fault: "Embedded-line and I2C fault injection",
  monitoring: "Register, error-counter and temperature monitors",
  hwCapture: "Frame grabber for CaptureMode",
  hwPassthrough: "SerDes board + GPIO routing for PassthroughMode",
};

function serializerCheck(n: CNode, idx: TreeIndex): Issue[] {
  const cam = idx.ancestor(n, "camera");
  const ser = n.params.serializer;
  if (cam && ser && cam.params.serializer && ser !== cam.params.serializer)
    return [issue(WARNING, `Serializer '${ser}' differs from the camera serializer '${cam.params.serializer}'`, n, { field: "serializer" })];
  return [];
}

function vcChecks(n: CNode, idx: TreeIndex): Issue[] {
  const out: Issue[] = [];
  const num = n.params.virtualChannelNumber;
  if (isInt(num) && idx.siblings(n).some((s) => s.params.virtualChannelNumber === num))
    out.push(issue(ERROR, `Virtual channel number ${num} is used more than once`, n, { field: "virtualChannelNumber" }));
  const lo = getPath(n.params, "fps.min"), hi = getPath(n.params, "fps.max");
  if (isNum(lo) && isNum(hi) && lo > hi) out.push(issue(ERROR, `FPS Min (${lo}) is greater than FPS Max (${hi})`, n, { field: "fps.min" }));
  const outputs = n.params.frameOutput;
  if (!Array.isArray(outputs) || !outputs.length) {
    out.push(issue(WARNING, "No frame outputs defined for this virtual channel", n, { table: "frameOutput" }));
    return out;
  }
  const pf = idx.ancestor(n, "camera")?.params.packetFormat;
  const seen = new Map<string, number>();
  outputs.forEach((row: Json, r: number) => {
    if (!row || typeof row !== "object") return;
    const raw = String(row.dataIdentifier ?? "").trim();
    const key = /^(0[xX])?[0-9A-Fa-f]+$/.test(raw) ? String(parseInt(raw.replace(/^0[xX]/, ""), 16)) : raw.toLowerCase();
    if (raw && seen.has(key)) out.push(issue(WARNING, `Output ${r + 1}: data identifier ${row.dataIdentifier} is also used by output ${seen.get(key)! + 1}`, n, { table: "frameOutput", row: r, column: "dataIdentifier" }));
    else seen.set(key, r);
    if (row.name === "Image" && pf && (PACKET_FORMATS as readonly string[]).includes(row.dataFormat) && row.dataFormat !== pf)
      out.push(issue(WARNING, `Output ${r + 1}: Image format ${row.dataFormat} differs from the camera packet format ${pf}`, n, { table: "frameOutput", row: r, column: "dataFormat" }));
    const lines = row.embeddedLine;
    if (lines === undefined) return;
    const tid = `frameOutput[${r}].embeddedLine`;
    const prefix = `Output '${row.name}' · `;
    for (const i of checkTable(n, EMBEDDED_LINE_TABLE, lines, tid)) out.push({ ...i, message: prefix + i.message });
    if (Array.isArray(lines)) lines.forEach((line: Json, li: number) => {
      if (line && typeof line === "object" && line.info !== undefined)
        for (const i of checkTable(n, EMBEDDED_INFO_TABLE, line.info, `${tid}[${li}].info`)) out.push({ ...i, message: `${prefix}Line ${li + 1} · ${i.message}` });
    });
  });
  return out;
}

function faultChecks(n: CNode, idx: TreeIndex): Issue[] {
  const out: Issue[] = [];
  const el: Json[] = Array.isArray(n.params.embeddedLine) ? n.params.embeddedLine : [];
  const i2c: Json[] = Array.isArray(n.params.i2c) ? n.params.i2c : [];
  const cam = idx.ancestor(n, "camera");
  const frames = cam ? findChild(cam, "frames") : undefined;
  const vcs = new Set((frames?.children ?? []).map((c) => c.params.virtualChannelNumber));
  el.forEach((row, r) => {
    if (row && isInt(row.virtualChannel) && !vcs.has(row.virtualChannel))
      out.push(issue(WARNING, `EL fault ${r + 1}: virtual channel ${row.virtualChannel} is not defined in Frame Information`, n, { table: "embeddedLine", row: r, column: "virtualChannel" }));
  });
  const names = new Set<string>();
  for (const [table, rows] of [["embeddedLine", el], ["i2c", i2c]] as const) {
    rows.forEach((row: Json, r: number) => {
      if (!row?.faultName) return;
      if (names.has(row.faultName)) out.push(issue(WARNING, `Fault name '${row.faultName}' is used more than once`, n, { table, row: r, column: "faultName" }));
      names.add(row.faultName);
    });
  }
  i2c.forEach((row, r) => {
    if (!row || typeof row.registerAdress !== "string" || ![0, 1].includes(row.i2cMode)) return;
    const digits = row.registerAdress.trim().replace(/^0[xX]/, "").length;
    if (digits > (row.i2cMode === 0 ? 2 : 4))
      out.push(issue(WARNING, `I2C fault ${r + 1}: register ${row.registerAdress} is wider than ${row.i2cMode === 0 ? 8 : 16} bits`, n, { table: "i2c", row: r, column: "registerAdress" }));
  });
  if (el.length || i2c.length) {
    const modes = projectModes(idx);
    if (![...modes.values()].some((f) => f.has(FEATURE_FAULTINJECTION)))
      out.push(issue(WARNING, "Faults are defined but no project mode enables the FaultInjection feature", n));
  }
  return out;
}

function monitoringChecks(n: CNode): Issue[] {
  const out: Issue[] = [];
  for (const key of ["register_monitor", "error_count"]) {
    const rows = Array.isArray(n.params[key]) ? n.params[key] : [];
    rows.forEach((row: Json, r: number) => {
      const want = ({ "8-Bit": 1, "16-Bit": 2 } as Record<string, number>)[row?.["Bit Mode"]];
      const regs = row?.["Register(s)"];
      if (want && Array.isArray(regs) && regs.length !== want)
        out.push(issue(WARNING, `Row ${r + 1}: ${row["Bit Mode"]} addressing expects ${want} register byte(s), got ${regs.length}`, n, { table: key, row: r, column: "Register(s)" }));
    });
  }
  const temps = Array.isArray(n.params.temperature_monitor) ? n.params.temperature_monitor : [];
  temps.forEach((row: Json, r: number) => {
    const lo = row?.["Min Limit"], hi = row?.["Max Limit"];
    if (isNum(lo) && isNum(hi) && lo >= hi)
      out.push(issue(ERROR, `Temperature monitor ${r + 1}: Min Limit (${lo}) must be below Max Limit (${hi})`, n, { table: "temperature_monitor", row: r, column: "Min Limit" }));
  });
  return out;
}

export function checkTable(n: CNode, spec: TableSpec, rows: Json, tableId: string): Issue[] {
  if (rows === undefined || rows === null) return [];
  if (!Array.isArray(rows)) return [issue(ERROR, `${spec.title} must be a list`, n, { table: tableId })];
  const out: Issue[] = [];
  rows.forEach((row, r) => {
    for (const [sev, key, msg] of checkRecord(spec.columns, row))
      out.push(issue(sev, `${spec.itemName} ${r + 1}: ${msg}`, n, { table: tableId, row: r, column: key || undefined }));
  });
  return out;
}

// --------------------------------------------------------------------------
// Tree operations
// --------------------------------------------------------------------------
export const defOf = (n: CNode) => DEFS[n.type];
export const nodeLabel = (n: CNode) => defOf(n).label?.(n) ?? defOf(n).title;
export const nodeSummary = (n: CNode) => defOf(n).summary?.(n) ?? "";
export const canDelete = (n: CNode, idx: TreeIndex) => defOf(n).deletable !== false && idx.parentOf(n) !== null;

export function childOptions(n: CNode, idx: TreeIndex): ChildOption[] {
  const def = defOf(n);
  if (def.childOptions) return def.childOptions(n, idx);
  return (def.childTypes ?? []).map((t) => {
    const cd = DEFS[t];
    const exists = cd.singleton !== false && n.children.some((c) => c.type === t);
    return {
      label: `Add ${cd.addLabel ?? cd.title}`, type: t, icon: cd.icon, enabled: !exists,
      reason: exists ? "already present" : undefined, description: ADD_DESCRIPTIONS[t] ?? cd.description,
      create: () => (cd.create ? cd.create(n, idx) : mk(t)),
    };
  });
}

/** Insert `child` at its canonical position (UI additions). Mutates `parent`. */
export function insertChild(parent: CNode, child: CNode): void {
  const order = defOf(parent).childTypes ?? [];
  const rank = (c: CNode) => {
    if (parent.type === "modes") { const i = (PROJECT_MODES as readonly string[]).indexOf(c.params.mode); return i < 0 ? 99 : i; }
    const i = order.indexOf(c.type);
    return i < 0 ? 99 : i;
  };
  const r = rank(child);
  const at = parent.children.findIndex((c) => rank(c) > r);
  if (at < 0) parent.children.push(child);
  else parent.children.splice(at, 0, child);
}

/** Deep copy with fresh ids (and a unique name / free VC number where needed). */
export function duplicateNode(n: CNode, parent: CNode): CNode {
  const clone = (x: CNode): CNode => ({ ...structuredClone({ ...x, children: [] }), id: newId(), children: x.children.map(clone) });
  const c = clone(n);
  if (n.type === "camera") {
    const taken = new Set(parent.children.map((s) => s.params.model));
    c.params.model = uniqueName(`${n.params.model || "Camera_Model"}_copy`, taken);
  }
  if (n.type === "vc") {
    const num = nextVcNumber(parent);
    if (num !== null) c.params.virtualChannelNumber = num;
  }
  return c;
}

// --------------------------------------------------------------------------
// Serialisation
// --------------------------------------------------------------------------
const asList = (v: Json, what: string): Json[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new LoadError(`'${what}' must be a JSON array`);
  return v;
};
const asDict = (v: Json, what: string): Json => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new LoadError(`'${what}' must be a JSON object`);
  return v;
};

export function nodeToJson(n: CNode): Json {
  const def = defOf(n);
  switch (n.type) {
    case "project": {
      const body = { ...n.params };
      const modes = findChild(n, "modes"), cams = findChild(n, "cameras");
      if (modes) body.projectModes = nodeToJson(modes);
      if (cams) body.cameraModels = nodeToJson(cams);
      return { project: ordered(body, def.jsonOrder!) };
    }
    case "modes": case "cameras": case "frames":
      return n.children.map(nodeToJson);
    case "hardware":
      return [...n.children.map(nodeToJson), ...structuredClone(n.unknown ?? [])];
    case "hwCapture": case "hwPassthrough":
      return { [n.jsonKey ?? (n.type === "hwCapture" ? HW_KEY_CAPTURE : HW_KEY_PASSTHROUGH)]: ordered(n.params, def.jsonOrder!) };
    case "camera": {
      const body = { ...n.params };
      for (const [t, key] of [["hardware", "hw"], ["frames", "frameInformation"], ["fault", "faultInjection"], ["monitoring", "i2c_monitoring"]] as const) {
        const c = findChild(n, t);
        if (c) body[key] = nodeToJson(c);
      }
      return ordered(body, def.jsonOrder!);
    }
    default:
      return ordered(n.params, def.jsonOrder ?? []);
  }
}

function cameraFromJson(data: Json): CNode {
  const params = { ...asDict(data, "cameraModels[]") };
  const { hw, frameInformation, faultInjection, i2c_monitoring } = params;
  delete params.hw; delete params.frameInformation; delete params.faultInjection; delete params.i2c_monitoring;
  const cam = mk("camera", params);
  if (hw !== undefined) {
    const h = mk("hardware", {}, [], { unknown: [] });
    asList(hw, "hw").forEach((item, i) => {
      const e = asDict(item, `hw[${i}]`);
      const keys = Object.keys(e);
      const k = keys.length === 1 ? keys[0] : "";
      if (k.toLowerCase() === HW_KEY_CAPTURE.toLowerCase()) h.children.push(mk("hwCapture", asDict(e[k], `hw[${i}].${k}`), [], { jsonKey: k }));
      else if (k.toLowerCase() === HW_KEY_PASSTHROUGH.toLowerCase()) h.children.push(mk("hwPassthrough", asDict(e[k], `hw[${i}].${k}`), [], { jsonKey: k }));
      else h.unknown!.push(e);
    });
    cam.children.push(h);
  }
  if (frameInformation !== undefined)
    cam.children.push(mk("frames", {}, asList(frameInformation, "frameInformation").map((v, i) => mk("vc", asDict(v, `frameInformation[${i}]`)))));
  if (faultInjection !== undefined) cam.children.push(mk("fault", asDict(faultInjection, "faultInjection")));
  if (i2c_monitoring !== undefined) cam.children.push(mk("monitoring", asDict(i2c_monitoring, "i2c_monitoring")));
  return cam;
}

export interface ConfigDocument {
  root: CNode;
  extraTop: Json;
}

export function newDocument(): ConfigDocument {
  return { root: mk("project"), extraTop: {} };
}

export function documentFromJson(data: Json): ConfigDocument {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new LoadError("The top-level JSON value must be an object");
  if (!("project" in data)) throw new LoadError("Missing root key 'project'");
  const params = { ...asDict(data.project, "project") };
  const { projectModes: pm, cameraModels: cms } = params;
  delete params.projectModes; delete params.cameraModels;
  const root = mk("project", params);
  if (pm !== undefined) root.children.push(mk("modes", {}, asList(pm, "projectModes").map((m, i) => mk("mode", asDict(m, `projectModes[${i}]`)))));
  if (cms !== undefined) root.children.push(mk("cameras", {}, asList(cms, "cameraModels").map(cameraFromJson)));
  const extraTop: Json = {};
  for (const k of Object.keys(data)) if (k !== "project") extraTop[k] = data[k];
  return { root, extraTop };
}

export function documentFromText(text: string): ConfigDocument {
  let data: Json;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    throw new LoadError(`Invalid JSON: ${(e as Error).message}`);
  }
  return documentFromJson(data);
}

export function documentToJson(doc: ConfigDocument): Json {
  return structuredClone({ ...nodeToJson(doc.root), ...doc.extraTop });
}

export const documentToText = (doc: ConfigDocument) => JSON.stringify(documentToJson(doc), null, 2) + "\n";

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------
export function validateNode(n: CNode, idx: TreeIndex): Issue[] {
  const def = defOf(n);
  const out: Issue[] = [];
  if (def.fields) for (const [sev, key, msg] of checkRecord(def.fields, n.params)) out.push(issue(sev, msg, n, { field: key || undefined }));
  for (const t of def.tables ?? []) out.push(...checkTable(n, t, getPath(n.params, t.key), t.key));
  if (def.checks) out.push(...def.checks(n, idx));
  return out;
}

export function validateTree(root: CNode, idx = new TreeIndex(root)): Issue[] {
  const out: Issue[] = [];
  for (const n of walk(root)) out.push(...validateNode(n, idx));
  return out;
}
