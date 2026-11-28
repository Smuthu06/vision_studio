/**
 * Tester configurations in the Camera Test Platform (CTP) format – the `cameraTester` root of
 * tester_configuration.schema.json (src/assets, same file the validate script uses).
 *
 * The editor keeps only what is chosen on the bench (camera model, device, bit file, channels,
 * workers, …). Everything the schema wants that already lives elsewhere is filled in when the
 * file is written, so a tester file is self-contained:
 *   - from the selected project:  features, hardwareInfo, imager, packetFromat, serializer,
 *     operatingVoltage, EEPROM / imager addresses, gpioRouting, frameInfo, i2cCheckingConfig
 *   - from Settings (ui_config.json): fpgaDefaults (FPGA board defaults) and
 *     debayerConfiguration (debayer configurations)
 *   - from the folders in the INI: full paths of the bit file, datalogger and I2C command files
 *
 * Opening a file keeps every key Vision Studio does not edit (fifoCommands, reactionAnalysis,
 * monitoringCmd, …) in `params.$source` and writes it back unchanged; derived values fall back to
 * what the file had when the project / settings entry is not available.
 */
import type { ErrorObject } from "ajv";
// precompiled: the app's CSP forbids eval, so ajv must not compile the schema at runtime
import validateSchema from "./testerValidator.generated.js";
import { projectHardware, projectModeFeatures, type Catalog } from "./catalog";
import type { BoardDefaults, DebayerConfig, PixelFormat } from "./benchDefaults";
import { projectFileName } from "./filename";
import {
  DEFS, findChild, mk, nodeToJson, type CNode, type ConfigDocument, type Issue,
} from "./model";
import { ERROR, WARNING, type Json } from "./schema";

export const CTP_FEATURES = ["DataLogger", "FaultInjection", "EMCFeatures"] as const;

// ---------------------------------------------------------------------------- helpers
const SOURCE = "$source";
const src = (n: CNode): Json => (n.params[SOURCE] && typeof n.params[SOURCE] === "object" ? n.params[SOURCE] : {});
const without = (o: Json, keys: string[]) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !keys.includes(k)));
const isPassthrough = (mode: Json) => /^passthrough/i.test(String(mode ?? ""));
const baseName = (p: Json) => String(p ?? "").split(/[\\/]/).pop() ?? "";

/** dir + file with the separator the folder uses (C:\…\x.lvbitx on Windows). */
export function joinPath(dir: string | undefined, file: Json): string {
  const f = String(file ?? "");
  if (!f || !dir) return f;
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + f : dir + sep + f;
}

/** Integers for the schema's integer fields: 52, "52", "0x34" → number; "" / invalid → null. */
function toInt(v: Json): number | null {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = /^0x[0-9a-f]+$/i.test(v.trim()) ? parseInt(v.trim(), 16) : Number(v.trim());
    return Number.isInteger(n) ? n : null;
  }
  return null;
}
const toIntList = (v: Json): number[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;]+/) : [])
  .map(toInt).filter((x): x is number => x !== null);

/** Project feature names → CTP names (EMCfeature → EMCFeatures); others are not in the schema and are dropped. */
export function ctpFeature(f: string): string | undefined {
  const l = f.trim().toLowerCase();
  if (l === "emcfeature" || l === "emcfeatures") return "EMCFeatures";
  return CTP_FEATURES.find((x) => x.toLowerCase() === l);
}

export function boardToFpgaDefaults(b: BoardDefaults): Json {
  return {
    "SI_Ref_Clk_Freq_(Hz)": Math.round(b.siReferenceClockHz),
    "SO_Ref_Clk_Freq_(Hz)": Math.round(b.soReferenceClockHz),
    Frames_on_DMA_Buffer: b.framesOnDma,
    "Frame_Sync_Window_(# of Frames)": b.frameSyncWindow,
    "Frame_Sync_Tolerance_(us)": b.frameSyncToleranceUs,
    LLP_FIFO_Depth: b.llpFifoDepth,
  };
}

const pixel = (f: PixelFormat): Json => ({
  dataSize: f.dataSize, bitDepthPerChannel: f.bitDepthPerChannel, useBigEndian: f.useBigEndian,
});
export function debayerToCtp(d: DebayerConfig): Json {
  return {
    imageSize: { width: d.imageWidth, height: d.imageHeight },
    inputFormat: pixel(d.inputFormat),
    outputFormat: pixel(d.outputFormat),
    conversionParams: { Conv_Param_1: d.conversionParameter },
  };
}

/** What the export needs to look things up. */
interface Ctx {
  catalog: Catalog;
  project: CNode | null;
  projectCamera: (model: Json) => CNode | undefined;
  emc: boolean;
}
function makeCtx(catalog: Catalog): Ctx {
  const project = catalog.ctx?.project?.root as CNode | null ?? null;
  const cams = project ? findChild(project, "cameras")?.children ?? [] : [];
  const emc = [...projectModeFeatures(project).values()].some((fs) => fs.some((f) => ctpFeature(f) === "EMCFeatures"));
  return { catalog, project, projectCamera: (m) => cams.find((c) => c.params.model === m), emc };
}

// ---------------------------------------------------------------------------- writing
export function exportTester(root: CNode, catalog: Catalog): Json {
  const x = makeCtx(catalog);
  const s = src(root);
  const p = root.params;
  return {
    cameraTester: {
      ...without(s, ["testModes"]),
      author: p.author ?? "",
      emailAddress: p.emailAddress ?? "",
      date: p.date ?? "",
      applicationName: p.applicationName ?? "",
      version: p.version ?? "",
      serviceName: s.serviceName ?? p.applicationName ?? "", // required by the schema; not edited
      project: {
        ...(s.project && typeof s.project === "object" ? s.project : {}),
        name: x.project?.params.project ?? s.project?.name ?? String(p.project ?? "").replace(/_v[^_]*\.json$/i, ""),
        version: x.project?.params.version ?? s.project?.version ?? "",
      },
      testModes: root.children.map((m) => exportMode(m, x)),
    },
  };
}

export function exportMode(m: CNode, x: Ctx): Json {
  const s = src(m);
  const mode = m.params.mode;
  const projectMode = x.project ? findChild(x.project, "modes")?.children.find((pm) => pm.params.mode === mode) : undefined;
  const features = projectMode
    ? [...new Set((projectMode.params.features ?? []).map((f: string) => ctpFeature(String(f))).filter(Boolean))]
    : s.features ?? [];
  const hw: Json[] = [];
  if (x.project) {
    for (const c of m.children) {
      for (const h of projectHardware(x.project, c.params.cameraModel, mode)) {
        if (h.manufacture !== c.params.manufacturer || h.model !== c.params.deviceModel) continue;
        const item = { manufacture: h.manufacture ?? "", model: h.model ?? "", deserializer: h.deserializer ?? "" };
        if (!hw.some((e) => JSON.stringify(e) === JSON.stringify(item))) hw.push(item);
      }
    }
  }
  return {
    ...without(s, ["cameraModels"]),
    mode,
    features,
    ...(x.emc || s.multiple_display !== undefined ? { multiple_display: m.params.multipleDisplay === true } : {}),
    hardwareInfo: x.project ? hw : s.hardwareInfo ?? [],
    cameraModels: m.children.map((c) => exportCamera(c, mode, x)),
  };
}

export function exportCamera(c: CNode, mode: Json, x: Ctx): Json {
  const s = src(c);
  const p = c.params;
  const pc = x.projectCamera(p.cameraModel);
  const pj: Json = pc ? (nodeToJson(pc) as Json) : {};
  const dirs = x.catalog.ctx?.dirs ?? {};
  const board = (x.catalog.boardDefaults ?? []).find((b) => b.boardName === p.fpgaBoardName);
  const hw = x.project ? projectHardware(x.project, p.cameraModel, mode).find((h) => h.manufacture === p.manufacturer && h.model === p.deviceModel) : undefined;
  const pass = isPassthrough(mode);
  const chans = c.children.filter((k) => k.type === "testerChannel");
  const pick = (key: string, projectKey = key) => (pc ? pj[projectKey] : s[key]);
  const out: Json = {
    ...without(s, ["channelInfo", "channelConfiguration"]),
    name: p.name ?? "",
    cameraModel: p.cameraModel ?? "",
    deviceResource: p.deviceResource ?? "",
    deviceModel: p.deviceModel ?? "",
    manufacturer: p.manufacturer ?? "",
    fpgaBoardName: p.fpgaBoardName ?? "",
    deviceMode: p.deviceMode ?? "",
    operatingVoltage: pick("operatingVoltage") ?? 12,
    imager: pick("imager") ?? "",
    packetFromat: pick("packetFromat", "packetFormat") ?? "",
    serializer: (pick("serializer") || null),
    fpgaBitFile: joinPath(dirs.bitfile, p.fpgaBitFile) || s.fpgaBitFile || "",
    dataloggerCommands: joinPath(dirs.datalogger, p.dataloggerCommands) || s.dataloggerCommands || "",
    fifoCommands: s.fifoCommands ?? {},
    fpgaDefaults: board ? boardToFpgaDefaults(board) : s.fpgaDefaults ?? {},
    channelInfo: chans.map((ch) => (pass
      ? { inputChannel: ch.params.channel ?? "", outputChannel: ch.params.outputChannel ?? "", name: ch.params.channelName ?? "" }
      : { Channel: ch.params.channel ?? "", Name: ch.params.channelName ?? "" })),
    channelConfiguration: chans.map((ch) => exportChannel(ch, pass, pc, x)),
  };
  const gpio = pass && hw && Array.isArray(hw.gpioRouting) ? hw.gpioRouting : undefined;
  if (gpio?.length) out.gpioRouting = gpio.map((g: Json) => ({ ...g, serialChannel: toInt(g.serialChannel) ?? 0 }));
  if (pc && x.emc) { // EMC parameters of the camera model (project), as the schema's integer fields
    const e = pj.eeprom ?? {};
    out.eeprom = { ...(s.eeprom ?? {}), Lenght: toInt(e.Lenght) ?? 0, Address: toIntList(e.Address) };
    out.imagerAddress = toInt(pj.imagerAddress);
    out.eepromHashRegAddress = toInt(pj.eepromHashRegAddress);
    out.lenghtHash = toInt(pj.lenghtHash);
  }
  return out;
}

export const I2C_CHECKING = "Monitoring & Checking";

/**
 * The I2C checking configuration of a tester I2C worker: the project's I2C Monitoring of the
 * camera model (register / error-count / temperature monitors). Only used – and shown – when
 * the worker mode is "Monitoring & Checking"; otherwise the file carries `null`.
 */
export function i2cCheckingMonitoring(w: CNode, idx: { ancestor: (n: CNode, t: never) => CNode | null }, catalog: Catalog): { checking: boolean; monitoring: CNode | undefined; cameraModel: Json } {
  const cam = idx.ancestor(w, "testerCamera" as never);
  const pc = cam ? makeCtx(catalog).projectCamera(cam.params.cameraModel) : undefined;
  return { checking: w.params.i2cWorkerMode === I2C_CHECKING, monitoring: pc ? findChild(pc, "monitoring") : undefined, cameraModel: cam?.params.cameraModel };
}

function exportI2cWorker(w: CNode | undefined, pc: CNode | undefined): Json {
  if (!w) return { i2cWorkerMode: "Monitoring", pauseTime: 100, i2cCheckingConfig: null };
  const s = src(w);
  const checking = w.params.i2cWorkerMode === I2C_CHECKING;
  const mon = pc ? findChild(pc, "monitoring") : undefined;
  return {
    ...s,
    i2cWorkerMode: w.params.i2cWorkerMode ?? "Monitoring",
    pauseTime: toInt(w.params.pauseTime) ?? 0,
    i2cCheckingConfig: !checking ? null : mon ? nodeToJson(mon) as Json : s.i2cCheckingConfig ?? null,
  };
}

export function exportChannel(ch: CNode, pass: boolean, pc: CNode | undefined, x: Ctx): Json {
  const s = src(ch);
  const p = ch.params;
  const i2cDir = x.catalog.ctx?.dirs?.i2c;
  const vcs = ch.children.filter((k) => k.type === "testerVc").map((v) => exportVc(v, pc, x));
  const worker = exportI2cWorker(ch.children.find((k) => k.type === "i2cWorker"), pc);
  const cyber = { ...(s.cybersecurity ?? {}), enable: p.cybersecurityEnable === true, lvClass: String(p.lvClass ?? "") };
  const input = {
    channel: p.channel ?? "", channelName: p.channelName ?? "", pocMode: p.pocMode ?? "", streamingMode: p.streamingMode ?? "",
    i2cCommands: joinPath(i2cDir, p.i2cCommands), vcConfiguration: vcs, i2cWorker: worker,
  };
  if (!pass) return { ...without(s, ["input", "output"]), ...input, cybersecurity: cyber };
  return {
    ...without(s, ["channel", "channelName", "pocMode", "streamingMode", "i2cCommands", "vcConfiguration", "i2cWorker"]),
    input: { ...(s.input ?? {}), ...input },
    output: {
      ...(s.output ?? {}),
      channel: p.outputChannel ?? "", channelName: p.outputChannelName ?? "", i2cCommands: joinPath(i2cDir, p.outputI2cCommands),
      pocMode: p.outputPocMode ?? "", soCsiDataLane: p.soCsiDataLane ?? "4 Lane", SoCsiDatarate: toInt(p.soCsiDatarate) ?? 0,
    },
    cybersecurity: cyber,
  };
}

export function exportVc(v: CNode, pc: CNode | undefined, x: Ctx): Json {
  const s = src(v);
  const n = toInt(v.params.virtualChannel) ?? 0;
  const pvc = pc ? findChild(pc, "frames")?.children.find((f) => f.params.virtualChannelNumber === n) : undefined;
  const deb = (x.catalog.debayerConfigs ?? []).find((d) => d.name === v.params.debayer);
  const faw = v.children.find((k) => k.type === "frameAnalysisWorker");
  const kept: Json[] = Array.isArray(src(faw ?? v).items) ? src(faw!).items : [];
  return {
    ...without(s, []),
    virtualChannel: `VC${n}`,
    name: v.params.name ?? "",
    frameInfo: pvc ? nodeToJson(pvc) : s.frameInfo ?? { virtualChannelNumber: n, virtualChannelName: "", fps: { min: 0, max: 0 }, frameOutput: [] },
    cameraDebayer: v.params.debayer ?? "",
    debayerConfiguration: deb ? debayerToCtp(deb) : s.debayerConfiguration ?? {},
    frameAnalysisWorker: [...(faw?.params.frameVerification === false ? [] : ["Frame Verification"]), ...kept.filter((i) => i !== "Frame Verification")],
  };
}

// ---------------------------------------------------------------------------- reading
const keep = (o: Json, managed: string[]) => ({ [SOURCE]: without(o, managed) });

export function importCameraTester(data: Json): ConfigDocument {
  const t = data.cameraTester;
  if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error("'cameraTester' must be an object");
  const proj = t.project && typeof t.project === "object" ? t.project : {};
  const root = mk("tester", {
    applicationName: t.applicationName ?? "", version: t.version ?? "", author: t.author ?? "", emailAddress: t.emailAddress ?? "",
    date: t.date ?? "", project: proj.name ? projectFileName({ project: proj.name, version: proj.version }) : "",
    ...keep(t, ["applicationName", "version", "author", "emailAddress", "date", "testModes"]),
  });
  for (const m of Array.isArray(t.testModes) ? t.testModes : []) {
    const pass = isPassthrough(m.mode);
    const mode = mk("testerMode", { mode: m.mode ?? "", multipleDisplay: m.multiple_display === true, ...keep(m, ["mode", "multiple_display", "cameraModels"]) });
    for (const c of Array.isArray(m.cameraModels) ? m.cameraModels : []) {
      const cam = mk("testerCamera", {
        cameraModel: c.cameraModel ?? "", name: c.name ?? "", manufacturer: c.manufacturer ?? "", deviceModel: c.deviceModel ?? "",
        deviceMode: c.deviceMode ?? "", deviceResource: c.deviceResource ?? "", fpgaBitFile: baseName(c.fpgaBitFile),
        dataloggerCommands: baseName(c.dataloggerCommands), fpgaBoardName: c.fpgaBoardName ?? "",
        ...keep(c, ["cameraModel", "name", "manufacturer", "deviceModel", "deviceMode", "deviceResource", "fpgaBoardName", "channelInfo", "channelConfiguration"]),
      });
      for (const cc of Array.isArray(c.channelConfiguration) ? c.channelConfiguration : []) cam.children.push(importChannel(cc, pass));
      mode.children.push(cam);
    }
    root.children.push(mode);
  }
  const extraTop: Json = {};
  for (const k of Object.keys(data)) if (k !== "cameraTester") extraTop[k] = data[k];
  return { root, extraTop };
}

function importChannel(cc: Json, pass: boolean): CNode {
  const inp = pass ? cc.input ?? {} : cc;
  const out = pass ? cc.output ?? {} : {};
  const d = DEFS.testerChannel.defaultParams();
  const ch = mk("testerChannel", {
    ...d,
    channel: inp.channel ?? d.channel, channelName: inp.channelName ?? "", pocMode: inp.pocMode ?? "", streamingMode: inp.streamingMode ?? "",
    i2cCommands: baseName(inp.i2cCommands),
    ...(pass ? {
      outputChannel: out.channel ?? d.outputChannel, outputChannelName: out.channelName ?? "", outputPocMode: out.pocMode ?? "",
      outputI2cCommands: baseName(out.i2cCommands), soCsiDataLane: out.soCsiDataLane ?? d.soCsiDataLane, soCsiDatarate: out.SoCsiDatarate ?? d.soCsiDatarate,
    } : {}),
    cybersecurityEnable: cc.cybersecurity?.enable === true, lvClass: cc.cybersecurity?.lvClass ?? "",
    [SOURCE]: pass
      ? { ...without(cc, ["input", "output"]), input: without(inp, ["channel", "channelName", "pocMode", "streamingMode", "i2cCommands", "vcConfiguration", "i2cWorker"]),
        output: without(out, ["channel", "channelName", "pocMode", "i2cCommands", "soCsiDataLane", "SoCsiDatarate"]) }
      : without(cc, ["channel", "channelName", "pocMode", "streamingMode", "i2cCommands", "vcConfiguration", "i2cWorker"]),
  });
  const w = inp.i2cWorker;
  ch.children.push(mk("i2cWorker", w && typeof w === "object"
    ? { i2cWorkerMode: w.i2cWorkerMode ?? "Monitoring", pauseTime: w.pauseTime ?? 0, ...keep(w, ["i2cWorkerMode", "pauseTime"]) }
    : DEFS.i2cWorker.defaultParams()));
  for (const v of Array.isArray(inp.vcConfiguration) ? inp.vcConfiguration : []) {
    const items: Json[] = Array.isArray(v.frameAnalysisWorker) ? v.frameAnalysisWorker : [];
    ch.children.push(mk("testerVc", {
      virtualChannel: toInt(String(v.virtualChannel ?? "").replace(/^VC/i, "")) ?? 0, name: v.name ?? "", debayer: v.cameraDebayer ?? "",
      ...keep(v, ["virtualChannel", "name", "cameraDebayer", "frameAnalysisWorker"]),
    }, [mk("frameAnalysisWorker", { frameVerification: items.includes("Frame Verification"), [SOURCE]: { items: items.filter((i) => i !== "Frame Verification") } })]));
  }
  return ch;
}

// ---------------------------------------------------------------------------- schema check
function validate(json: Json): ErrorObject[] {
  return validateSchema(json) ? [] : [...(validateSchema.errors ?? [])];
}

/**
 * Check the file that Save would write against tester_configuration.schema.json and report the
 * problems on the nodes they come from. Errors of oneOf alternatives that do not apply (the
 * project root, the other channel layout, …) are left out.
 */
export function schemaIssues(root: CNode, catalog: Catalog): Issue[] {
  return [...i2cCheckingIssues(root, catalog), ...schemaErrors(root, catalog)];
}

/** "Monitoring & Checking" needs the project's I2C Monitoring of the camera model to check against. */
function i2cCheckingIssues(root: CNode, catalog: Catalog): Issue[] {
  const x = makeCtx(catalog);
  if (!x.project) return []; // project not loaded: nothing to check against
  const out: Issue[] = [];
  for (const mode of root.children) for (const cam of mode.children) {
    if (cam.type !== "testerCamera") continue;
    const pc = x.projectCamera(cam.params.cameraModel);
    if (!pc) continue;
    const mon = findChild(pc, "monitoring");
    const rows = mon ? ["register_monitor", "error_count", "temperature_monitor"].reduce((a, k) => a + (Array.isArray(mon.params[k]) ? mon.params[k].length : 0), 0) : 0;
    for (const ch of cam.children) for (const w of ch.children) {
      if (w.type !== "i2cWorker" || w.params.i2cWorkerMode !== I2C_CHECKING || rows) continue;
      out.push({
        severity: WARNING, nodeId: w.id, field: "i2cWorkerMode",
        message: mon ? `Camera model '${cam.params.cameraModel}' has no monitors in the project's I2C Monitoring – nothing to check`
          : `Camera model '${cam.params.cameraModel}' has no I2C Monitoring in the project – add it there to check the I2C values`,
      });
    }
  }
  return out;
}

function schemaErrors(root: CNode, catalog: Catalog): Issue[] {
  const json = exportTester(root, catalog);
  const errs = validate(json);
  if (!errs.length) return [];
  const out: Issue[] = [];
  const seen = new Set<string>();
  for (const e of errs) {
    if (e.keyword === "oneOf" || e.schemaPath.startsWith("#/oneOf/1")) continue;
    const parts = e.instancePath.split("/").slice(1);
    const [node, pass] = nodeAt(root, parts);
    if (/DirectChannelConfiguration/.test(e.schemaPath) && pass) continue;
    if (/PassthroughChannelConfiguration/.test(e.schemaPath) && !pass) continue;
    if (/ChannelInfo\/oneOf\/0/.test(e.schemaPath) && pass) continue;
    if (/ChannelInfo\/oneOf\/1/.test(e.schemaPath) && !pass) continue;
    if (/FrameAnalysisWorkerItem\/oneOf\/0/.test(e.schemaPath) && typeof valueAt(json, parts) !== "string") continue;
    if (/FrameAnalysisWorkerItem\/oneOf\/1/.test(e.schemaPath) && typeof valueAt(json, parts) === "string") continue;
    const where = parts.slice(1).join(".").replace(/\.(\d+)/g, "[$1]") || "cameraTester";
    const what = e.keyword === "required" ? `misses '${(e.params as { missingProperty: string }).missingProperty}'`
      : e.keyword === "enum" ? `must be one of ${((e.params as { allowedValues: Json[] }).allowedValues).map((v) => JSON.stringify(v)).join(", ")}`
      : e.message ?? "is invalid";
    const msg = `Tester schema: ${where} ${what}`;
    if (seen.has(msg)) continue;
    seen.add(msg);
    out.push({ severity: ERROR, message: msg, nodeId: node.id });
  }
  return out;
}

function valueAt(json: Json, parts: string[]): Json {
  let v = json;
  for (const p of parts) v = v?.[p];
  return v;
}

/** The node an instance path of the written file belongs to, and whether it is in a PassthroughMode. */
function nodeAt(root: CNode, parts: string[]): [CNode, boolean] {
  let node = root, pass = false;
  const at = (key: string) => parts.indexOf(key);
  const i = at("testModes"), j = at("cameraModels"), k = at("channelConfiguration"), v = at("vcConfiguration");
  if (i >= 0 && root.children[+parts[i + 1]]) {
    node = root.children[+parts[i + 1]];
    pass = isPassthrough(node.params.mode);
    if (j >= 0 && node.children[+parts[j + 1]]) {
      node = node.children[+parts[j + 1]];
      if (k >= 0 && node.children[+parts[k + 1]]) {
        node = node.children[+parts[k + 1]];
        if (v >= 0) node = node.children.filter((c) => c.type === "testerVc")[+parts[v + 1]] ?? node;
        else if (parts.includes("i2cWorker")) node = node.children.find((c) => c.type === "i2cWorker") ?? node;
      }
    }
  }
  return [node, pass];
}

/** The part of the written file that a tester node produces (for the JSON preview). */
export function exportNodeJson(root: CNode, n: CNode, catalog: Catalog): Json {
  const json = exportTester(root, catalog);
  if (n === root) return json;
  for (const [i, m] of root.children.entries()) {
    const jm = json.cameraTester.testModes[i];
    if (m === n) return jm;
    for (const [j, c] of m.children.entries()) {
      const jc = jm.cameraModels[j];
      if (c === n) return jc;
      for (const [k, ch] of c.children.entries()) {
        const jch = jc.channelConfiguration[k];
        if (ch === n) return jch;
        const inner = jch.input ?? jch;
        for (const w of ch.children.filter((x) => x.type === "i2cWorker")) if (w === n) return inner.i2cWorker;
        for (const [v, vc] of ch.children.filter((x) => x.type === "testerVc").entries()) {
          if (vc === n) return inner.vcConfiguration[v];
          if (vc.children.includes(n)) return inner.vcConfiguration[v].frameAnalysisWorker;
        }
      }
    }
  }
  return null;
}
