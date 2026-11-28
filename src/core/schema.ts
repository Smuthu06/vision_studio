/**
 * Schema constants, field/table specifications and value helpers.
 * Pure TypeScript – no UI or platform dependencies (unit-tested with vitest).
 */

export type Severity = "error" | "warning";
export const ERROR: Severity = "error";
export const WARNING: Severity = "warning";
export const RANK: Record<string, number> = { none: 0, warning: 1, error: 2 };
export const worse = (a: Severity | null, b: Severity | null): Severity | null =>
  (RANK[a ?? "none"] >= RANK[b ?? "none"] ? a : b);

export type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// --------------------------------------------------------------------------
// Enumerations from the specification
// --------------------------------------------------------------------------
export const CORPORATE_EMAIL_DOMAIN = "company.com"; // "" disables the domain warning
export const DEFAULT_SCHEMA_VERSION = "1.0.0";

export const MODE_CAPTURE = "CaptureMode";
export const MODE_PASSTHROUGH = "PassthroughMode";
export const PROJECT_MODES = [MODE_CAPTURE, MODE_PASSTHROUGH] as const;
export const FEATURE_DATALOGGER = "DataLogger";
export const FEATURE_FAULTINJECTION = "FaultInjection";
/** Built-in feature: unlocks the EMC parameters of camera models (imager I2C address, EEPROM, hash). */
export const FEATURE_EMC = "EMCfeature";
export const FEATURES = [FEATURE_DATALOGGER, FEATURE_FAULTINJECTION, FEATURE_EMC] as const;
export const PACKET_FORMATS = ["raw8", "raw10", "raw12", "raw14", "raw16"] as const;
export const HW_KEY_CAPTURE = "CaptureMode";
export const HW_KEY_PASSTHROUGH = "passthroughMode"; // lower-case "p" as in the schema
export const GPIO_PINS = Array.from({ length: 12 }, (_, i) => `GPIO ${i}`);
export const GPIO_DIRECTIONS = ["SO to SI", "SI to SO"];
export const SERIAL_CHANNEL_MAX = 3;
export const VC_MAX = 15;
export const VC_NAME_SUGGESTIONS = ["Front", "Rear", "Left", "Right", "VC"];
export const FRAME_OUTPUT_NAMES = ["Image", "Header", "Metadata"];
export const BYTE_ORDERS = ["Little Indian", "Big Indian"]; // schema spelling kept verbatim

export type IntOption = readonly [number, string];
export const EL_FAULT_MODES: IntOption[] = [[0, "None"], [1, "Bitwise"], [2, "Fixed"]];
export const CRC_ALGORITHMS: IntOption[] = [[0, "None"], [1, "CRC-8"], [2, "CRC-16"], [3, "CRC-32"]];
export const EL_OPERATIONS: IntOption[] = [[0, "Single Mode"], [1, "Continuous"]];
export const I2C_REG_MODES: IntOption[] = [[0, "8-bit registers"], [1, "16-bit registers"]];
export const I2C_COMMAND_TYPES: IntOption[] = [[0, "Write"], [1, "Read"]];
export const I2C_ACK_NACK: IntOption[] = [[0, "None"], [1, "Force ACK"], [2, "Force NACK"]];
export const MONITOR_MODES = ["Read", "Write"];
export const LINK_OPTIONS = ["Link A", "Link B", "Link C", "Link D"];
export const BIT_MODES = ["8-Bit", "16-Bit"];

export const RE_PROJECT_NAME = /^[A-Za-z0-9_]+$/;
export const RE_VERSION = /^V\.\d+\.\d+\.\d+$/;
export const RE_SEMVER = /^\d+\.\d+\.\d+$/;
export const RE_AUTHOR = /^[A-Za-z0-9_.-]{1,32}$/;
export const RE_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export const RE_IDENT = /^[A-Za-z0-9_.-]+$/;
export const RE_DATE = /^(\d{2})[/-](\d{2})[/-](\d{4})$/;
const HEX_TOKEN = "(?:0[xX])?[0-9A-Fa-f]+";
export const RE_HEX_BYTES = new RegExp(`^${HEX_TOKEN}(?:[\\s,]+${HEX_TOKEN})*$`);

export function isRealDate(text: string): boolean {
  const m = RE_DATE.exec(text);
  if (!m || text[2] !== text[5]) return false; // same separator twice
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function todayDDMMYYYY(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// --------------------------------------------------------------------------
// Field specs
// --------------------------------------------------------------------------
export type Kind = "str" | "int" | "float" | "enum" | "intenum" | "bool" | "multi" | "hexstr" | "intlist";

/** Option lists maintained in the Settings window (see catalog.ts). */
export type CatalogSource =
  | "features" | "imagers" | "serializers" | "manufacturers" | "models" | "hwSerializers" | "hwDeserializers"
  | "imageFormats" | "dataTypes";

export interface FieldSpec {
  key: string;               // dotted path into the node's JSON body
  label: string;
  kind?: Kind;               // default "str"
  required?: boolean;        // default true
  options?: readonly string[];
  intOptions?: readonly IntOption[];
  min?: number;
  max?: number;
  pattern?: RegExp;
  hint?: string;             // message suffix when the pattern fails
  hex?: boolean;             // display integers as 0x..
  suggestions?: readonly string[];
  help?: string;
  placeholder?: string;
  default?: Json;
  width?: number;            // table column width (px)
  source?: CatalogSource;    // options come from the Settings catalog
  strict?: boolean;          // value outside the catalog list = error (else warning)
  optionLabels?: Record<string, string>; // display text per option value (filled by resolveSpec)
  requiresFeature?: string;  // editable (and validated) only when a project mode enables this feature
}

export interface TableSpec {
  key: string;
  title: string;
  columns: FieldSpec[];
  addLabel: string;
  itemName: string;
  help?: string;
  icon?: string;              // node-icon name shown beside the table title / tab
  docId?: string;             // key into TABLE_DOCS (table keys are not unique across nodes)
  primary?: string[];         // columns shown in the grid; the rest go to the row drawer
  factory?: (rows: Json[]) => Json;
}

export const kindOf = (s: FieldSpec): Kind => s.kind ?? "str";
export const isRequired = (s: FieldSpec): boolean => s.required !== false;

export function newRow(spec: TableSpec, rows: Json[]): Json {
  if (spec.factory) return spec.factory(rows);
  const out: Json = {};
  for (const c of spec.columns) out[c.key] = structuredClone(c.default ?? null);
  return out;
}

// --------------------------------------------------------------------------
// Dotted paths
// --------------------------------------------------------------------------
export function getPath(data: Json, path: string): Json {
  let cur = data;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function setPath(data: Json, path: string, value: Json): void {
  const parts = path.split(".");
  let cur = data;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] === null || typeof cur[part] !== "object" || Array.isArray(cur[part])) cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

export function delPath(data: Json, path: string): void {
  const parts = path.split(".");
  let cur = data;
  for (const part of parts.slice(0, -1)) {
    cur = cur?.[part];
    if (cur === null || typeof cur !== "object") return;
  }
  if (cur && typeof cur === "object") delete cur[parts[parts.length - 1]];
}

// --------------------------------------------------------------------------
// Parsing / formatting
// --------------------------------------------------------------------------
export const isEmpty = (v: Json) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
export const isInt = (v: Json): v is number => typeof v === "number" && Number.isInteger(v);
export const isNum = (v: Json): v is number => typeof v === "number" && Number.isFinite(v);

export function parseIntStrict(value: Json): number {
  if (typeof value === "boolean") throw new Error("a boolean is not an integer");
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value;
    throw new Error(`${value} is not an integer`);
  }
  const t = String(value).trim().replace(/_/g, "");
  const m = /^([+-]?)0[xX]([0-9A-Fa-f]+)$/.exec(t);
  if (m) {
    const n = parseInt(m[2], 16);
    return m[1] === "-" ? -n : n;
  }
  if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
  throw new Error(`'${t}' is not an integer`);
}

export function parseNumber(value: Json): number {
  if (typeof value === "boolean") throw new Error("a boolean is not a number");
  if (typeof value === "number") return value;
  const t = String(value).trim();
  try {
    return parseIntStrict(t);
  } catch { /* fall through */ }
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    const f = Number(t);
    if (Number.isFinite(f)) return f;
  }
  throw new Error(`'${t}' is not a number`);
}

export function parseIntList(value: Json): number[] {
  if (Array.isArray(value)) return value.map(parseIntStrict);
  const t = String(value).trim().replace(/^\[|\]$/g, "").trim();
  if (!t) return [];
  return t.split(/[\s,;]+/).filter(Boolean).map(parseIntStrict);
}

export function fmtInt(v: Json, hex = false): string {
  if (hex && isInt(v) && v >= 0) return `0x${v.toString(16).toUpperCase().padStart(2, "0")}`;
  return String(v);
}

export function displayValue(spec: FieldSpec, value: Json): string {
  if (value === undefined || value === null) return "";
  switch (kindOf(spec)) {
    case "int": return fmtInt(value, spec.hex);
    case "intlist": return Array.isArray(value) ? value.map((v) => fmtInt(v, spec.hex)).join(", ") : String(value);
    case "intenum": {
      const o = spec.intOptions?.find(([v]) => v === value);
      return o ? `${o[0]} – ${o[1]}` : String(value);
    }
    case "multi": return Array.isArray(value) ? value.join(", ") : String(value);
    case "bool": return value === true ? "true" : value === false ? "false" : String(value);
    default: return String(value);
  }
}

/** Editor input → stored value. Unparseable input is kept verbatim so validation can flag it. */
export function coerceValue(spec: FieldSpec, raw: Json): Json {
  const k = kindOf(spec);
  if (k === "str" || k === "hexstr" || k === "enum") return raw === undefined || raw === null ? "" : String(raw);
  if (k === "bool") return Boolean(raw);
  if (k === "multi") return Array.isArray(raw) ? [...raw] : [];
  if (isEmpty(raw)) return null;
  try {
    if (k === "int" || k === "intenum") return parseIntStrict(raw);
    if (k === "float") return parseNumber(raw);
    if (k === "intlist") return parseIntList(raw);
  } catch {
    return String(raw);
  }
  return raw;
}

const numText = (s: FieldSpec, v: number) => (s.hex && Number.isInteger(v) ? fmtInt(v, true) : String(v));
function rangeMsg(s: FieldSpec): string {
  if (s.min !== undefined && s.max !== undefined) return `must be between ${numText(s, s.min)} and ${numText(s, s.max)}`;
  if (s.min !== undefined) return `must be ≥ ${numText(s, s.min)}`;
  return `must be ≤ ${numText(s, s.max!)}`;
}
const inRange = (s: FieldSpec, v: number) => (s.min === undefined || v >= s.min) && (s.max === undefined || v <= s.max);

export function checkValue(spec: FieldSpec, value: Json): Array<[Severity, string]> {
  const label = spec.label;
  if (isEmpty(value)) return isRequired(spec) ? [[ERROR, `${label} is required`]] : [];
  const out: Array<[Severity, string]> = [];
  switch (kindOf(spec)) {
    case "str":
      if (typeof value !== "string") out.push([ERROR, `${label} must be text`]);
      else if (spec.pattern && !spec.pattern.test(value)) out.push([ERROR, `${label} ${spec.hint ?? "has an invalid format"}`]);
      break;
    case "int":
      if (!isInt(value)) out.push([ERROR, `${label} must be an integer (decimal or 0x-hex), got '${value}'`]);
      else if (!inRange(spec, value)) out.push([ERROR, `${label} ${rangeMsg(spec)}`]);
      break;
    case "float":
      if (!isNum(value)) out.push([ERROR, `${label} must be a number, got '${value}'`]);
      else if (!inRange(spec, value)) out.push([ERROR, `${label} ${rangeMsg(spec)}`]);
      break;
    case "enum":
      if (!spec.options?.includes(value)) out.push([ERROR, `${label} '${value}' is not one of: ${spec.options?.join(", ")}`]);
      break;
    case "intenum":
      if (!spec.intOptions?.some(([v]) => v === value))
        out.push([ERROR, `${label} '${value}' is not one of: ${spec.intOptions?.map(([v, n]) => `${v}=${n}`).join(", ")}`]);
      break;
    case "bool":
      if (typeof value !== "boolean") out.push([ERROR, `${label} must be true or false`]);
      break;
    case "multi":
      if (!Array.isArray(value)) out.push([ERROR, `${label} must be a list`]);
      else {
        const bad = value.filter((v) => !spec.options?.includes(v));
        if (bad.length) out.push([ERROR, `${label}: unknown value(s) ${bad.join(", ")}`]);
        if (new Set(value.map(String)).size !== value.length) out.push([WARNING, `${label} contains duplicates`]);
      }
      break;
    case "hexstr":
      if (typeof value !== "string" || !RE_HEX_BYTES.test(value.trim()))
        out.push([ERROR, `${label} must be hexadecimal (e.g. 2A, 0x2A or 'CC DD'), got '${value}'`]);
      else if (spec.min !== undefined || spec.max !== undefined) {
        const t = value.trim().replace(/^0[xX]/, "");
        if (!/^[0-9A-Fa-f]+$/.test(t)) out.push([ERROR, `${label} must be a single hexadecimal value`]);
        else if (!inRange(spec, parseInt(t, 16))) out.push([ERROR, `${label} ${rangeMsg(spec)}`]);
      }
      break;
    case "intlist":
      if (!Array.isArray(value) || value.some((v) => !isInt(v)))
        out.push([ERROR, `${label} must be a comma separated list of integers, got '${value}'`]);
      else if (value.some((v: number) => !inRange(spec, v))) out.push([ERROR, `${label}: every entry ${rangeMsg(spec)}`]);
      break;
  }
  return out;
}

export function checkRecord(specs: readonly FieldSpec[], record: Json): Array<[Severity, string, string]> {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return [[ERROR, "", "Entry must be a JSON object"]];
  const out: Array<[Severity, string, string]> = [];
  for (const s of specs) for (const [sev, msg] of checkValue(s, getPath(record, s.key))) out.push([sev, s.key, msg]);
  return out;
}

export function ordered(d: Json, order: readonly string[]): Json {
  const out: Json = {};
  for (const k of order) if (k in d) out[k] = d[k];
  for (const k of Object.keys(d)) if (!(k in out)) out[k] = d[k];
  return out;
}
