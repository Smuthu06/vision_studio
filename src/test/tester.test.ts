import { describe, expect, it } from "vitest";
import sample from "../assets/sample.json";
import { cascadeTesterCamera, defaultCatalog, optionsFor, type Catalog, type TesterContext } from "../core/catalog";
import { configFileName } from "../core/filename";
import {
  childOptions, DEFS, documentFromJson, documentToJson, featureEnabled, findChild, insertChild, mk, newTesterDocument,
  nodeLabel, optionRecord, TreeIndex, validateTree, type CNode,
} from "../core/model";

const project = () => documentFromJson(structuredClone(sample)).root;

function ctx(over: Partial<TesterContext> = {}, root: CNode | null = project()): Catalog {
  return {
    ...defaultCatalog(),
    ctx: {
      projectFiles: ["sample_v1.0.0.json"],
      project: { name: "sample_v1.0.0.json", root },
      bitfiles: ["FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx", "FPGA_8IN_NI1486_capture_v10.0.0.lvbitx"],
      dataloggers: ["logger.json"],
      i2cFiles: ["front_init.txt"],
      dirs: {},
      ...over,
    },
  };
}

/** tester → CaptureMode → one camera model created through the right-click menus */
function build(c: Catalog) {
  const doc = newTesterDocument("sample_v1.0.0.json");
  const t = doc.root;
  let idx = new TreeIndex(t);
  const mode = childOptions(t, idx, c)[0].create();
  insertChild(t, mode);
  idx = new TreeIndex(t);
  const cam = childOptions(mode, idx, c)[0].create();
  insertChild(mode, cam);
  currentRoot = t;
  return { doc, t, mode, cam, idx: new TreeIndex(t) };
}

/** right-click camera › Add Channel (then channel › Add Virtual Channel) */
function addChannel(cam: CNode, c: Catalog, name = "Front") {
  const ch = childOptions(cam, new TreeIndex(rootOf(cam)), c)[0].create();
  ch.params.name = name;
  insertChild(cam, ch);
  return ch;
}
function addVc(ch: CNode, c: Catalog) {
  const opt = childOptions(ch, new TreeIndex(rootOf(ch)), c).find((o) => o.type === "testerVc")!;
  const vc = opt.create();
  insertChild(ch, vc);
  return vc;
}
let currentRoot: CNode;
const rootOf = (_n: CNode) => currentRoot;

describe("tester configuration", () => {
  it("is a separate document kind with its own file name and JSON", () => {
    const c = ctx();
    const { doc, cam } = build(c);
    Object.assign(doc.root.params, { testerName: "HIL_Bench_01", version: "V.2.0.0", author: "eng", emailAddress: "eng@company.com" });
    addVc(addChannel(cam, c), c);
    expect(configFileName(doc.root)).toBe("HIL_Bench_01_v2.0.0.json");
    const json = documentToJson(doc);
    expect(Object.keys(json)).toEqual(["tester"]);
    expect(json.tester.project).toBe("sample_v1.0.0.json");
    expect(json.tester.modes[0].mode).toBe("CaptureMode");
    expect(json.tester.modes[0].cameraModels[0]).toMatchObject({ cameraModel: "ADAS_Camera_Model_A", deviceManufacturer: "NationalInstruments", deviceModel: "NI1487" });
    expect(json.tester.modes[0].cameraModels[0].channels).toEqual([{
      channel: "SI0", name: "Front", pocMode: false, streamingMode: false, i2cInitFile: "",
      i2cWorker: { option: "Monitoring", pauseTime: 100 },
      virtualChannels: [{ virtualChannel: 0, name: "Front", debayer: "Off", frameAnalysisWorker: {} }],
    }]);
    // round trip
    const back = documentFromJson(json);
    expect(back.root.type).toBe("tester");
    expect(documentToJson(back)).toEqual(json);
  });

  it("offers the modes, camera models and hardware of the selected project", () => {
    const c = ctx();
    expect(optionsFor("projectModes", c).values).toEqual(["CaptureMode", "PassthroughMode"]);
    expect(optionsFor("projectCameras", c).values).toEqual(["ADAS_Camera_Model_A"]);
    const rec = { cameraModel: "ADAS_Camera_Model_A", $mode: "CaptureMode" };
    expect(optionsFor("projectManufacturers", c, rec).values).toEqual(["NationalInstruments"]);
    expect(optionsFor("projectDeviceModels", c, { ...rec, deviceManufacturer: "NationalInstruments" }).values).toEqual(["NI1487"]);
    expect(optionsFor("projectManufacturers", c, { cameraModel: "nope", $mode: "CaptureMode" }).values).toEqual([]);
    expect(optionsFor("bitfiles", c).values).toHaveLength(2);
    // nothing loaded yet: unknown, so not checked
    expect(optionsFor("projectModes", defaultCatalog()).unknown).toBe(true);
  });

  it("adds each project mode once and fills a new camera model from the project", () => {
    const c = ctx();
    const { t, cam, idx } = build(c);
    expect(childOptions(t, idx, c)[0]).toMatchObject({ enabled: true, description: "Next: PassthroughMode" });
    insertChild(t, childOptions(t, idx, c)[0].create());
    expect(childOptions(t, new TreeIndex(t), c)[0].enabled).toBe(false);
    expect(cam.params).toMatchObject({ cameraModel: "ADAS_Camera_Model_A", name: "ADAS_Camera_Model_A", fpgaDevice: "PXIe-1486", fpgaBoardDefaults: "Default" });
    expect(nodeLabel(cam)).toBe("ADAS_Camera_Model_A");
    cam.params.name = "Front_Left";
    expect(nodeLabel(cam)).toBe("Front_Left");
    expect(optionRecord(cam, idx).$mode).toBe("CaptureMode");
  });

  it("validates against the project and the bench folders", () => {
    const c = ctx();
    const { doc, t, cam } = build(c);
    Object.assign(t.params, { author: "eng", emailAddress: "eng@company.com" });
    Object.assign(cam.params, { deviceResources: "RIO0", bitFile: "FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx", fpgaDevice: "PXIe-1487" });
    const si0 = addChannel(cam, c);
    addVc(si0, c);
    const so = addChannel(cam, c, "ECU");
    addVc(so, c);
    const errs = () => validateTree(doc.root, new TreeIndex(doc.root), c);
    expect(errs()).toEqual([]);

    so.params.channel = "SI0";
    cam.params.bitFile = "FPGA_8IN_NI1486_capture_v10.0.0.lvbitx";
    cam.params.dataloggerConfiguration = "gone.json";
    t.params.project = "other_v1.0.0.json";
    const msgs = errs().map((i) => `${i.severity}: ${i.message}`);
    expect(msgs).toContain("error: Channel SI0 is used more than once in this camera model");
    expect(msgs).toContain("warning: Bit file FPGA_8IN_NI1486_capture_v10.0.0.lvbitx is built for NI1486, not for PXIe-1487");
    expect(msgs).toContain("error: Datalogger Configuration 'gone.json' is not found in the datalogger_configuration folder");
    expect(msgs).toContain("error: Project Configuration 'other_v1.0.0.json' is not found in the project configuration folder");
  });

  it("explains empty lists, e.g. no bit files", () => {
    const c = ctx({ bitfiles: [] });
    const { doc } = build(c);
    const msgs = validateTree(doc.root, new TreeIndex(doc.root), c).map((i) => i.message);
    expect(msgs).toContain("Bit File: nothing to choose from – there are no .lvbitx files in the fpga_bitfile folder");
  });

  it("shows Multiple Display only when the project enables EMCfeature", () => {
    const off = ctx();
    const { doc, mode, idx } = build(off);
    expect(featureEnabled(idx, "EMCfeature", off)).toBe(false);
    mode.params.multipleDisplay = "not a bool"; // hidden → not checked
    expect(validateTree(doc.root, idx, off).filter((i) => i.field === "multipleDisplay")).toEqual([]);
    const p = project();
    findChild(p, "modes")!.children[0].params.features.push("EMCfeature");
    const on = ctx({}, p);
    expect(featureEnabled(idx, "EMCfeature", on)).toBe(true);
    expect(validateTree(doc.root, idx, on).filter((i) => i.field === "multipleDisplay")).toHaveLength(1);
  });

  it("keeps the device choice consistent with the project camera model", () => {
    const c = ctx();
    const params = { cameraModel: "ADAS_Camera_Model_A", deviceManufacturer: "Acme", deviceModel: "X" };
    cascadeTesterCamera(params, c, "PassthroughMode");
    expect(params).toMatchObject({ deviceManufacturer: "NationalInstruments", deviceModel: "NI1487" });
  });

  it("duplicates a camera model under a new name and rejects duplicate names", () => {
    const c = ctx();
    const { doc, mode } = build(c);
    const copy = mk("testerCamera", { ...mode.children[0].params });
    insertChild(mode, copy);
    const dup = validateTree(doc.root, new TreeIndex(doc.root), c).filter((i) => i.field === "name");
    expect(dup.map((i) => i.message)).toContain("Camera model name 'ADAS_Camera_Model_A' is used more than once in this mode");
    expect(DEFS.testerCamera.duplicable).toBe(true);
  });

  it("gives every channel an I2C worker and every virtual channel a frame analysis worker", () => {
    const c = ctx();
    const { doc, cam } = build(c);
    const ch = addChannel(cam, c);
    expect(ch.params.channel).toBe("SI0");
    expect(ch.children.map((x) => x.type)).toEqual(["i2cWorker"]);
    expect(DEFS.i2cWorker.deletable).toBe(false);
    expect(childOptions(ch, new TreeIndex(doc.root), c).map((o) => o.label)).toEqual(["Add Virtual Channel"]);
    expect(addChannel(cam, c, "Rear").params.channel).toBe("SI1");
    const vc = addVc(ch, c);
    expect(vc.params).toEqual({ virtualChannel: 0, name: "Front", debayer: "Off" });
    expect(vc.children.map((x) => x.type)).toEqual(["frameAnalysisWorker"]);
    expect(nodeLabel(ch)).toBe("SI0 – Front");
    expect(nodeLabel(vc)).toBe("VC0 – Front");
  });

  it("offers the virtual channels of the camera model and the I2C files", () => {
    const c = ctx();
    const { doc, cam } = build(c);
    const ch = addChannel(cam, c);
    const vc = addVc(ch, c);
    const idx = new TreeIndex(doc.root);
    expect(optionsFor("projectVcs", c, optionRecord(vc, idx))).toEqual({ values: ["0"], labels: { "0": "Front" } });
    ch.params.i2cInitFile = "missing.txt";
    ch.children[0].params.option = "Sometimes";
    ch.children[0].params.pauseTime = -1;
    addVc(ch, c); // VC0 twice
    vc.params.debayer = "XYZ";
    const msgs = validateTree(doc.root, new TreeIndex(doc.root), c).map((i) => i.message);
    expect(msgs).toContain("I2C Initialisation File 'missing.txt' is not found in the i2c_configuration folder");
    expect(msgs).toContain("Virtual channel 0 is used more than once on this channel");
    expect(msgs.some((m) => m.startsWith("Option 'Sometimes'"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("Pause Time (ms)"))).toBe(true);
    expect(msgs).toContain("Debayer Configuration 'XYZ' is not one of: Off, RGGB, GRBG, GBRG, BGGR (add it in Settings › Debayer configurations)");
  });

  it("reads older tester files whose channels have no workers yet", () => {
    const d = documentFromJson({ tester: { testerName: "T", version: "V.1.0.0", project: "p.json", modes: [{ mode: "CaptureMode", cameraModels: [{ cameraModel: "A", name: "A", channels: [{ channel: "SI0", name: "Front" }] }] }] } });
    const ch = d.root.children[0].children[0].children[0];
    expect(ch.type).toBe("testerChannel");
    expect(ch.children.map((x) => x.type)).toEqual(["i2cWorker"]);
    expect(documentToJson(d).tester.modes[0].cameraModels[0].channels[0].i2cWorker).toEqual({ option: "Monitoring", pauseTime: 100 });
  });
});
