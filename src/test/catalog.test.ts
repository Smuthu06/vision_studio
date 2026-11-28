import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  applyRenames, cascadeHardware, catalogUsage, defaultCatalog, normalizeCatalog, optionsFor, resolveSpec, usageKey, type Catalog,
} from "../core/catalog";
import { childOptions, DEFS, documentFromJson, TreeIndex, validateTree, type CNode } from "../core/model";

const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, "../../samples/ADAS_Vision_Project_Sample.json"), "utf8"));
const byType = (root: CNode, t: string) => { const out: CNode[] = []; const v = (n: CNode) => { if (n.type === t) out.push(n); n.children.forEach(v); }; v(root); return out; };
const withHw = (): Catalog => ({
  ...defaultCatalog(),
  hardware: [
    { name: "NationalInstruments", models: [
      { name: "NI1487", serializers: ["SER_IC_PART_A"], deserializers: ["DES_IC_PART_B"] },
      { name: "NI1488", serializers: ["SER_B1", "SER_B2"], deserializers: ["DES_B1"] }] },
    { name: "Acme", models: [{ name: "AC-1", serializers: ["SER_AC"], deserializers: ["DES_AC"] }] },
  ],
});

describe("catalog defaults", () => {
  it("the sample project is clean with the shipped lists", () => {
    const doc = documentFromJson(SAMPLE);
    expect(validateTree(doc.root, new TreeIndex(doc.root), defaultCatalog())).toEqual([]);
  });
});

describe("dropdown options", () => {
  it("cascades manufacturer → model → serializer / deserializer", () => {
    const c = withHw();
    expect(optionsFor("manufacturers", c).values).toEqual(["NationalInstruments", "Acme"]);
    expect(optionsFor("models", c, { manufacture: "NationalInstruments" }).values).toEqual(["NI1487", "NI1488"]);
    expect(optionsFor("models", c, { manufacture: "Acme" }).values).toEqual(["AC-1"]);
    expect(optionsFor("hwSerializers", c, { manufacture: "NationalInstruments", model: "NI1488" }).values).toEqual(["SER_B1", "SER_B2"]);
    expect(optionsFor("hwDeserializers", c, { manufacture: "Acme", model: "AC-1" }).values).toEqual(["DES_AC"]);
  });
  it("data types show their description", () => {
    const spec = DEFS.vc.tables![0].columns.find((x) => x.key === "dataIdentifier")!;
    const r = resolveSpec(spec, defaultCatalog(), {});
    expect(r.kind).toBe("enum");
    expect(r.optionLabels!["0x2A"]).toBe("0x2A – RAW8");
  });
  it("changing manufacturer or model keeps valid values and fixes the rest", () => {
    const c = withHw();
    const p = { manufacture: "Acme", model: "NI1488", serializer: "SER_B2", deserializer: "DES_B1" };
    cascadeHardware(p, c);
    expect(p).toEqual({ manufacture: "Acme", model: "AC-1", serializer: "SER_AC", deserializer: "DES_AC" });
    const q = { manufacture: "NationalInstruments", model: "NI1488", serializer: "SER_B2", deserializer: "DES_B1" };
    cascadeHardware(q, c);
    expect(q.serializer).toBe("SER_B2");
  });
});

describe("validation against the catalog", () => {
  it("strict lists give errors, the others warnings", () => {
    const doc = documentFromJson(SAMPLE);
    const c = defaultCatalog();
    c.features = [{ value: "DataLogger" }];               // FaultInjection removed
    c.imagers = [{ value: "IMX490" }];                    // SENSOR_MODEL_X removed
    c.imageFormats = c.imageFormats.filter((f) => f.value !== "raw16");
    const issues = validateTree(doc.root, new TreeIndex(doc.root), c);
    const find = (field: string) => issues.filter((i) => i.field === field || i.column === field);
    expect(find("features").map((i) => i.severity)).toContain("error");
    expect(find("features")[0].message).toContain("Settings › Mode features");
    expect(find("imager").map((i) => [i.severity, i.message])).toEqual([["warning", "Imager 'SENSOR_MODEL_X' is not in the list in Settings › Imagers"]]);
    expect(find("packetFormat")[0].severity).toBe("error");
    expect(find("dataFormat").every((i) => i.severity === "error")).toBe(true);
  });
  it("data IDs compare as hex values and keep their range check", () => {
    const doc = documentFromJson(SAMPLE);
    const vc = byType(doc.root, "vc")[0];
    vc.params.frameOutput[0].dataIdentifier = "0x2a";       // lower case → still listed
    expect(validateTree(doc.root)).toEqual([]);
    vc.params.frameOutput[0].dataIdentifier = "0x24";       // valid hex, not listed → warning
    expect(validateTree(doc.root).map((i) => i.severity)).toEqual(["warning"]);
    vc.params.frameOutput[0].dataIdentifier = "0x99";       // out of range → error
    expect(validateTree(doc.root).some((i) => i.severity === "error")).toBe(true);
  });
  it("new boards take their defaults from the catalog", () => {
    const c = withHw();
    c.hardware = [c.hardware[1], c.hardware[0]];          // Acme first
    const cam = byType(documentFromJson(SAMPLE).root, "camera")[0];
    const hw = cam.children.find((x) => x.type === "hardware")!;
    hw.children = [];
    const idx = new TreeIndex(cam);
    const cap = childOptions(hw, idx, c).find((o) => o.type === "hwCapture")!.create();
    expect(cap.params).toEqual({ manufacture: "Acme", model: "AC-1", deserializer: "DES_AC" });
  });
});

describe("settings import", () => {
  it("normalises, de-duplicates and falls back to defaults", () => {
    const { catalog, warnings } = normalizeCatalog({
      imagers: ["IMX490", " IMX490 ", { value: "AR0233", description: "onsemi" }, ""],
      dataTypes: ["2a", "0x99", { value: "0x12", description: "Embedded" }],
      hardware: [{ name: "Acme", models: [{ name: "AC-1", serializers: ["S1"], deserializers: ["D1", "D1"] }] }],
      imageFormats: [],
    });
    expect(catalog.imagers).toEqual([{ value: "IMX490" }, { value: "AR0233", description: "onsemi" }]);
    expect(catalog.dataTypes.map((d) => d.value)).toEqual(["0x2A", "0x12"]);
    expect(catalog.hardware[0].models[0].deserializers).toEqual(["D1"]);
    expect(catalog.features).toEqual(defaultCatalog().features);       // missing → defaults
    expect(catalog.imageFormats).toEqual(defaultCatalog().imageFormats); // empty → defaults
    expect(warnings.length).toBeGreaterThanOrEqual(4);
    expect(normalizeCatalog("x").warnings[0]).toContain("not a JSON object");
  });
});

describe("usage and renames", () => {
  it("counts uses and renames them across the tree (scoped for hardware)", () => {
    const doc = documentFromJson(SAMPLE);
    const use = catalogUsage(doc.root);
    expect(use.get(usageKey("imagers", "SENSOR_MODEL_X"))).toBe(1);
    expect(use.get(usageKey("hwDeserializers", "DES_IC_PART_B", "NationalInstruments", "NI1487"))).toBe(2);
    expect(use.get(usageKey("imageFormats", "raw16"))).toBe(3);   // camera + 2 frame outputs
    const n = applyRenames(doc.root, [
      { source: "imagers", from: "SENSOR_MODEL_X", to: "IMX490" },
      { source: "manufacturers", from: "NationalInstruments", to: "NI" },
      { source: "models", from: "NI1487", to: "NI-1487", manufacturer: "NationalInstruments" },
      { source: "hwDeserializers", from: "DES_IC_PART_B", to: "MAX96712", manufacturer: "NationalInstruments", model: "NI1487" },
      { source: "dataTypes", from: "0x2A", to: "0x2E" },
    ]);
    expect(n).toBe(1 + 2 + 2 + 2 + 1);
    const hw = byType(doc.root, "hwPassthrough")[0].params;
    expect([hw.manufacture, hw.model, hw.deserializer]).toEqual(["NI", "NI-1487", "MAX96712"]);
    expect(byType(doc.root, "camera")[0].params.imager).toBe("IMX490");
    expect(byType(doc.root, "vc")[0].params.frameOutput[0].dataIdentifier).toBe("0x2E");
  });
});

describe("shipped ui_config.json", () => {
  it("is exactly the built-in defaults", () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, "../../config/ui_config.json"), "utf8"));
    const { catalog, warnings } = normalizeCatalog(shipped);
    expect(warnings).toEqual([]);
    expect(catalog).toEqual(defaultCatalog());
  });
});
