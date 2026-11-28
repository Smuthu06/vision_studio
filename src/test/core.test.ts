import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  autoGpioRoutes, childOptions, documentFromJson, documentFromText, documentToJson, duplicateNode, findChild,
  insertChild, LoadError, mk, newDocument, TreeIndex, validateTree, type CNode, type ConfigDocument,
} from "../core/model";
import { computeSteps } from "../core/guide";
import { coerceValue, parseIntList, parseIntStrict } from "../core/schema";

const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, "../../samples/ADAS_Vision_Project_Sample.json"), "utf8"));
// canonical reference JSON = sample without the extras (header output + monitoring)
const CANONICAL = structuredClone(SAMPLE);
const cam0 = CANONICAL.project.cameraModels[0];
delete cam0.i2c_monitoring;
cam0.frameInformation[0].frameOutput = [cam0.frameInformation[0].frameOutput[0]];

const issues = (doc: ConfigDocument, sev?: string) => validateTree(doc.root).filter((i) => !sev || i.severity === sev);
const byType = (root: CNode, t: string) => { const out: CNode[] = []; const v = (n: CNode) => { if (n.type === t) out.push(n); n.children.forEach(v); }; v(root); return out; };

describe("serialisation", () => {
  it("round-trips the canonical JSON losslessly and in order", () => {
    const out = documentToJson(documentFromJson(CANONICAL));
    expect(out).toEqual(CANONICAL);
    expect(JSON.stringify(out)).toEqual(JSON.stringify(CANONICAL));
  });
  it("round-trips the sample", () => {
    expect(JSON.stringify(documentToJson(documentFromJson(SAMPLE)))).toEqual(JSON.stringify(SAMPLE));
  });
  it("preserves unknown keys", () => {
    const d = structuredClone(CANONICAL);
    d.project.custom = { a: 1 };
    d.project.cameraModels[0].vendorNotes = "keep";
    d.project.cameraModels[0].hw.push({ FutureMode: { x: 1 } });
    d.toolMeta = 5;
    expect(documentToJson(documentFromJson(d))).toEqual(d);
  });
  it.each([["{", "Invalid JSON"], ["[]", "must be an object"], ['{"a":1}', "Missing root key"], ['{"project":{"cameraModels":3}}', "must be a JSON array"]])(
    "rejects %s", (text, frag) => {
      expect(() => documentFromText(text)).toThrow(LoadError);
      expect(() => documentFromText(text)).toThrow(frag);
    });
});

describe("validation", () => {
  it("canonical and sample are clean", () => {
    expect(issues(documentFromJson(CANONICAL))).toEqual([]);
    expect(issues(documentFromJson(SAMPLE))).toEqual([]);
  });
  it.each([
    ["version", "1.0.0", "V.<major>"], ["project", "bad name!", "letters, digits"], ["date", "2026-01-01", "DD/MM/YYYY"],
    ["date", "31-02-2026", "not a valid calendar date"], ["emailAddress", "x", "not a valid email"], ["author", "", "required"],
  ])("project %s=%s", (field, value, frag) => {
    const doc = documentFromJson(CANONICAL);
    doc.root.params[field] = value;
    const e = issues(doc, "error").filter((i) => i.field === field);
    expect(e.length).toBeGreaterThan(0);
    expect(e[0].message).toContain(frag);
  });
  it("non-corporate email is a warning", () => {
    const doc = documentFromJson(CANONICAL);
    doc.root.params.emailAddress = "a@gmail.com";
    expect(issues(doc, "warning").some((i) => i.field === "emailAddress")).toBe(true);
    expect(issues(doc, "error")).toEqual([]);
  });
  it("camera ranges and enums", () => {
    const doc = documentFromJson(CANONICAL);
    const cam = byType(doc.root, "camera")[0];
    byType(doc.root, "mode")[0].params.features.push("EMCfeature");   // imagerAddress is an EMC parameter
    Object.assign(cam.params, { operatingVoltage: 60, imagerAddress: 300, packetFormat: "raw9" });
    const f = new Set(issues(doc, "error").map((i) => i.field));
    ["operatingVoltage", "imagerAddress", "packetFormat"].forEach((k) => expect(f.has(k)).toBe(true));
  });
  it("vc rules, cell-level issues and duplicates", () => {
    const doc = documentFromJson(CANONICAL);
    const frames = byType(doc.root, "frames")[0];
    const vc = frames.children[0];
    vc.params.fps.min = 31;
    frames.children.push(mk("vc", vc.params));
    vc.params.frameOutput[0].dataIdentifier = "0x99";
    vc.params.frameOutput[0].xSize = 0;
    const e = issues(doc, "error");
    expect(e.some((i) => i.message.includes("greater than FPS Max"))).toBe(true);
    expect(e.some((i) => i.message.includes("used more than once"))).toBe(true);
    expect(e.some((i) => i.table === "frameOutput" && i.row === 0 && i.column === "dataIdentifier")).toBe(true);
    expect(e.some((i) => i.table === "frameOutput" && i.column === "xSize")).toBe(true);
  });
  it("gpio auto routes + duplicate detection", () => {
    const doc = documentFromJson(CANONICAL);
    const pt = byType(doc.root, "hwPassthrough")[0];
    expect(autoGpioRoutes(pt.params)).toBe(10);
    expect(issues(doc, "error")).toEqual([]);
    pt.params.gpioRouting.push({ ...pt.params.gpioRouting[0] });
    expect(issues(doc, "error").find((i) => i.table === "gpioRouting")?.row).toBe(12);
  });
  it("fault + cross-node checks", () => {
    const doc = documentFromJson(CANONICAL);
    const fi = byType(doc.root, "fault")[0];
    fi.params.embeddedLine[0].virtualChannel = 5;
    fi.params.embeddedLine[0].crcAlgorithm = 7;
    fi.params.i2c[0].registerAdress = "XYZ";
    const s = validateTree(doc.root).filter((i) => i.nodeId === fi.id).map((i) => `${i.severity}:${i.column}`);
    expect(s).toEqual(expect.arrayContaining(["warning:virtualChannel", "error:crcAlgorithm", "error:registerAdress"]));
    const hw = byType(doc.root, "hardware")[0];
    hw.children.pop();
    expect(issues(doc, "warning").some((i) => i.message.includes("no Passthrough Hardware"))).toBe(true);
    byType(doc.root, "mode")[1].params.features = ["DataLogger"];
    expect(issues(doc, "warning").some((i) => i.message.includes("FaultInjection feature"))).toBe(true);
  });
  it("nested embedded-line issues carry a nested table id", () => {
    const doc = documentFromJson(SAMPLE);
    const vc = byType(doc.root, "vc")[0];
    vc.params.frameOutput[1].embeddedLine[0].info[0].length = 0;
    expect(issues(doc, "error")[0].table).toBe("frameOutput[1].embeddedLine[0].info");
  });
});

describe("tree building", () => {
  it("a new document holds only the project", () => {
    const doc = newDocument();
    expect(doc.root.children).toEqual([]);
    const idx = new TreeIndex(doc.root);
    expect(childOptions(doc.root, idx).map((o) => [o.label, o.enabled])).toEqual([["Add Project Modes", true], ["Add Camera Models", true]]);
  });
  it("builds step by step with singletons and canonical order", () => {
    const doc = newDocument();
    const root = doc.root;
    const add = (parent: CNode, label: string) => {
      const opt = childOptions(parent, new TreeIndex(root)).find((o) => o.label === label)!;
      expect(opt.enabled).toBe(true);
      const n = opt.create();
      insertChild(parent, n);
      return n;
    };
    const cams = add(root, "Add Camera Models");
    const modes = add(root, "Add Project Modes");
    expect(root.children.map((c) => c.type)).toEqual(["modes", "cameras"]);
    add(modes, "Add PassthroughMode");
    add(modes, "Add CaptureMode");
    expect(modes.children.map((c) => c.params.mode)).toEqual(["CaptureMode", "PassthroughMode"]);
    expect(childOptions(modes, new TreeIndex(root)).every((o) => !o.enabled)).toBe(true);
    const cam = add(cams, "Add Camera Model");
    const cam2 = add(cams, "Add Camera Model");
    expect([cam.params.model, cam2.params.model]).toEqual(["Camera_Model", "Camera_Model_2"]);
    add(cam, "Add I2C Monitoring");
    const hw = add(cam, "Add Hardware");
    const frames = add(cam, "Add Frame Information");
    expect(cam.children.map((c) => c.type)).toEqual(["hardware", "frames", "monitoring"]);
    cam.params.serializer = "SER_X";                 // not supported by the default board model
    const pt = add(hw, "Add Passthrough Hardware");
    expect(pt.params.serializer).toBe("SER_IC_PART_A"); // → the model's first serializer
    expect(pt.params.deserializer).toBe("DES_IC_PART_B");
    expect(pt.jsonKey).toBe("passthroughMode");
    const vc0 = add(frames, "Add Virtual Channel");
    const vc1 = add(frames, "Add Virtual Channel");
    expect([vc0.params.virtualChannelName, vc1.params.virtualChannelNumber]).toEqual(["Front", 1]);
    const json = documentToJson(doc);
    expect(Object.keys(json.project.cameraModels[0])).toContain("hw");
    expect(json.project.cameraModels[0].hw[0]).toHaveProperty("passthroughMode");
  });
  it("duplicates with fresh ids and unique names", () => {
    const doc = documentFromJson(CANONICAL);
    const cams = byType(doc.root, "cameras")[0];
    const c = duplicateNode(cams.children[0], cams);
    expect(c.params.model).toBe("ADAS_Camera_Model_A_copy");
    expect(c.id).not.toBe(cams.children[0].id);
    expect(c.children[0].id).not.toBe(cams.children[0].children[0].id);
    const frames = findChild(cams.children[0], "frames")!;
    expect(duplicateNode(frames.children[0], frames).params.virtualChannelNumber).toBe(1);
  });
});

describe("build guide", () => {
  it("guides a new project step by step", () => {
    const doc = newDocument();
    doc.root.params.author = "me"; doc.root.params.emailAddress = "me@company.com";
    let steps = computeSteps(doc.root, validateTree(doc.root));
    expect(steps.map((s) => s.status).slice(0, 3)).toEqual(["done", "todo", "todo"]);
    expect(steps[1].action).toEqual({ kind: "add", parentId: doc.root.id, type: "modes" });
    const full = documentFromJson(SAMPLE);
    steps = computeSteps(full.root, validateTree(full.root));
    expect(steps.every((s) => s.status === "done")).toBe(true);
  });
});

describe("parsers", () => {
  it("parses ints, hex and lists", () => {
    expect(parseIntStrict("0x2A")).toBe(42);
    expect(() => parseIntStrict("1.5")).toThrow();
    expect(parseIntList("[0, 19]")).toEqual([0, 19]);
    expect(coerceValue({ key: "x", label: "X", kind: "int" }, "abc")).toBe("abc");
    expect(coerceValue({ key: "x", label: "X", kind: "intlist" }, "0x00, 0x13")).toEqual([0, 19]);
  });
});

import { columnDoc, constraintRows, FIELD_DOCS, fieldDoc, jsonPathOf, NODE_DOCS, resolveTable, TABLE_DOCS } from "../core/docs";
import { DEFS, EMBEDDED_INFO_TABLE, EMBEDDED_LINE_TABLE } from "../core/model";

describe("input documentation", () => {
  const allTables = () => {
    const t = new Set([EMBEDDED_LINE_TABLE, EMBEDDED_INFO_TABLE]);
    Object.values(DEFS).forEach((d) => d.tables?.forEach((x) => t.add(x)));
    return [...t];
  };
  it("documents every node, field and table column", () => {
    for (const [type, def] of Object.entries(DEFS)) {
      expect(NODE_DOCS[type as keyof typeof NODE_DOCS], type).toBeTruthy();
      for (const f of def.fields ?? []) expect(fieldDoc(def.type, f.key)?.doc, `${type}.${f.key}`).toBeTruthy();
    }
    for (const t of allTables()) {
      expect(t.docId && TABLE_DOCS[t.docId]?.doc, t.title).toBeTruthy();
      for (const c of t.columns) expect(columnDoc(t, c.key)?.doc, `${t.title}.${c.key}`).toBeTruthy();
      // no stale docs for columns that no longer exist
      expect(Object.keys(TABLE_DOCS[t.docId!].columns).sort()).toEqual(t.columns.map((c) => c.key).sort());
    }
    for (const [type, docs] of Object.entries(FIELD_DOCS)) {
      const keys = (DEFS[type as keyof typeof DEFS].fields ?? []).map((f) => f.key);
      for (const k of Object.keys(docs)) expect(keys, `${type}.${k}`).toContain(k);
    }
  });
  it("generates constraint summaries from the specs", () => {
    const cam = DEFS.camera.fields!.find((f) => f.key === "imagerAddress")!;
    expect(constraintRows(cam)).toEqual(expect.arrayContaining([["Range", "0 (0x0) – 255 (0xFF)"], ["Required", "Yes"]]));
    const crc = DEFS.fault.tables![0].columns.find((c) => c.key === "crcAlgorithm")!;
    expect(constraintRows(crc).find(([k]) => k === "Allowed")?.[1]).toBe("0 = None, 1 = CRC-8, 2 = CRC-16, 3 = CRC-32");
  });
  it("computes JSON locations and resolves nested tables", () => {
    const doc = documentFromJson(SAMPLE);
    const idx = new TreeIndex(doc.root);
    const pt = byType(doc.root, "hwPassthrough")[0];
    expect(jsonPathOf(pt, idx)).toBe("project.cameraModels[0].hw[1].passthroughMode");
    expect(jsonPathOf(byType(doc.root, "vc")[0], idx)).toBe("project.cameraModels[0].frameInformation[0]");
    expect(jsonPathOf(byType(doc.root, "mode")[1], idx)).toBe("project.projectModes[1]");
    const vc = byType(doc.root, "vc")[0];
    expect(resolveTable(vc, "frameOutput[1].embeddedLine[0].info")).toBe(EMBEDDED_INFO_TABLE);
    expect(resolveTable(byType(doc.root, "fault")[0], "embeddedLine")?.docId).toBe("elFault");
  });
});

describe("decluttered validation", () => {
  it("a new project only reports its empty required fields – no 'nothing added yet' warnings", () => {
    const doc = newDocument();
    const msgs = validateTree(doc.root).map((i) => i.message);
    expect(msgs.every((m) => / is required$/.test(m))).toBe(true);
  });
  it("wide tables list valid primary columns", () => {
    for (const def of Object.values(DEFS)) for (const t of def.tables ?? []) {
      if (!t.primary) continue;
      const keys = t.columns.map((c) => c.key);
      t.primary.forEach((k) => expect(keys, `${t.title}.${k}`).toContain(k));
      expect(t.primary.length).toBeLessThan(keys.length);
    }
  });
});
