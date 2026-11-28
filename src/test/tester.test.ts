import { describe, expect, it } from "vitest";
import sample from "../assets/sample.json";
import { cascadeTesterCamera, defaultCatalog, optionsFor, type Catalog, type TesterContext } from "../core/catalog";
import { configFileName } from "../core/filename";
import { exportTester, i2cCheckingMonitoring, schemaIssues } from "../core/ctpTester";
import Ajv from "ajv";
import schema from "../assets/tester_configuration.schema.json";
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
  ch.params.channelName = name;
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

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

/** A complete CaptureMode tester: camera with one channel (I2C worker) and one virtual channel. */
function complete(c: Catalog) {
  const b = build(c);
  Object.assign(b.t.params, { applicationName: "Nissan_ADAS_8MP_TESTER", author: "smuthusa", emailAddress: "user@valeo.com", date: "16/09/2026" });
  Object.assign(b.cam.params, { deviceResource: "PXI1Slot2", fpgaBitFile: "FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx", deviceMode: "4in/4out", dataloggerCommands: "logger.json" });
  const ch = addChannel(b.cam, c);
  ch.params.i2cCommands = "front_init.txt";
  const vc = addVc(ch, c);
  return { ...b, ch, vc };
}

describe("tester configuration (CTP cameraTester schema)", () => {
  it("writes a self-contained cameraTester file that passes the schema", () => {
    const c = ctx({ dirs: { bitfile: "C:\\bench\\fpga_bitfile", datalogger: "/bench/datalogger_configuration", i2c: "C:\\bench\\configurations\\i2c_configuration" } });
    const { doc } = complete(c);
    const json = documentToJson(doc, c);
    expect(validate(json)).toBe(true);
    const t = json.cameraTester;
    expect(t).toMatchObject({ author: "smuthusa", emailAddress: "user@valeo.com", date: "16/09/2026", applicationName: "Nissan_ADAS_8MP_TESTER",
      version: "V.1.0.0", serviceName: "Nissan_ADAS_8MP_TESTER", project: { name: "ADAS_Vision_Project_Sample", version: "V.1.0.0" } });
    const m = t.testModes[0];
    expect(m.mode).toBe("CaptureMode");
    expect(m.features).toEqual(["DataLogger"]);
    expect(m.hardwareInfo).toEqual([{ manufacture: "NationalInstruments", model: "NI1487", deserializer: "DES_IC_PART_B" }]);
    const cam = m.cameraModels[0];
    expect(cam).toMatchObject({
      name: "ADAS_Camera_Model_A", cameraModel: "ADAS_Camera_Model_A", deviceResource: "PXI1Slot2", deviceModel: "NI1487",
      manufacturer: "NationalInstruments", fpgaBoardName: "board1", deviceMode: "4in/4out", operatingVoltage: 12,
      imager: "SENSOR_MODEL_X", packetFromat: "raw16", serializer: "SER_IC_PART_A",
      fpgaBitFile: "C:\\bench\\fpga_bitfile\\FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx",
      dataloggerCommands: "/bench/datalogger_configuration/logger.json", fifoCommands: {},
      fpgaDefaults: { "SI_Ref_Clk_Freq_(Hz)": 25000000, "SO_Ref_Clk_Freq_(Hz)": 25000000, Frames_on_DMA_Buffer: 20,
        "Frame_Sync_Window_(# of Frames)": 30, "Frame_Sync_Tolerance_(us)": 650, LLP_FIFO_Depth: 200000000 },
      channelInfo: [{ Channel: "SI0", Name: "Front" }],
    });
    const ch = cam.channelConfiguration[0];
    expect(ch).toMatchObject({ channel: "SI0", channelName: "Front", pocMode: "Internal", streamingMode: "Single",
      i2cCommands: "C:\\bench\\configurations\\i2c_configuration\\front_init.txt", cybersecurity: { enable: false, lvClass: "" } });
    expect(ch.i2cWorker).toMatchObject({ i2cWorkerMode: "Monitoring", pauseTime: 100 });
    expect(ch.i2cWorker.i2cCheckingConfig).toBeNull(); // Monitoring only: nothing is checked
    const vc = ch.vcConfiguration[0];
    expect(vc).toMatchObject({ virtualChannel: "VC0", name: "Front", cameraDebayer: "RAW_RGGB_to_RGB", frameAnalysisWorker: ["Frame Verification"] });
    expect(vc.frameInfo).toMatchObject({ virtualChannelNumber: 0, virtualChannelName: "Front", fps: { max: 30.1, min: 29.9 } });
    expect(vc.debayerConfiguration).toMatchObject({ imageSize: { width: 1632, height: 1290 }, conversionParams: { Conv_Param_1: 0 },
      inputFormat: { dataSize: 2, bitDepthPerChannel: 12, useBigEndian: 1 } });
    // only the keys the schema defines
    expect(Object.keys(vc.debayerConfiguration).sort()).toEqual(["conversionParams", "imageSize", "inputFormat", "outputFormat"]);
    expect(Object.keys(vc.debayerConfiguration.inputFormat).sort()).toEqual(["bitDepthPerChannel", "dataSize", "useBigEndian"]);
    expect(Object.keys(vc.debayerConfiguration.outputFormat).sort()).toEqual(["bitDepthPerChannel", "dataSize", "useBigEndian"]);
    expect(Object.keys(cam.fpgaDefaults).sort()).toEqual(["Frame_Sync_Tolerance_(us)", "Frame_Sync_Window_(# of Frames)",
      "Frames_on_DMA_Buffer", "LLP_FIFO_Depth", "SI_Ref_Clk_Freq_(Hz)", "SO_Ref_Clk_Freq_(Hz)"]);
    expect(configFileName(doc.root)).toBe("Nissan_ADAS_8MP_TESTER_v1.0.0.json");
    expect(validateTree(doc.root, new TreeIndex(doc.root), c).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("writes PassthroughMode channels as input/output pairs with GPIO routing", () => {
    const c = ctx();
    const doc = newTesterDocument("sample_v1.0.0.json");
    currentRoot = doc.root;
    const pass = mk("testerMode", { mode: "PassthroughMode", multipleDisplay: false });
    insertChild(doc.root, pass);
    const cam = childOptions(pass, new TreeIndex(doc.root), c)[0].create();
    insertChild(pass, cam);
    const opt = childOptions(cam, new TreeIndex(doc.root), c)[0];
    expect(opt.label).toBe("Add Channel Pair");
    const ch = opt.create();
    Object.assign(ch.params, { channelName: "CH0_In", outputChannelName: "CH0_Out", cybersecurityEnable: true, lvClass: "X3F(OVT)" });
    insertChild(cam, ch);
    addVc(ch, c);
    const json = documentToJson(doc, c);
    expect(validate(json)).toBe(true);
    const m = json.cameraTester.testModes[0];
    expect(m.features).toEqual(["DataLogger", "FaultInjection"]);
    const jc = m.cameraModels[0];
    expect(jc.channelInfo).toEqual([{ inputChannel: "SI0", outputChannel: "SO0", name: "CH0_In" }]);
    expect(jc.channelConfiguration[0]).toMatchObject({
      input: { channel: "SI0", channelName: "CH0_In", pocMode: "Internal", streamingMode: "Single" },
      output: { channel: "SO0", channelName: "CH0_Out", pocMode: "Auxiliary", soCsiDataLane: "4 Lane", SoCsiDatarate: 1300000000 },
      cybersecurity: { enable: true, lvClass: "X3F(OVT)" },
    });
    expect(jc.channelConfiguration[0].input.vcConfiguration).toHaveLength(1);
    expect(jc.gpioRouting).toEqual([
      { direction: "SO to SI", serialChannel: 0, source: "GPIO 0", destination: "GPIO 0" },
      { direction: "SO to SI", serialChannel: 0, source: "GPIO 1", destination: "GPIO 1" },
    ]);
  });

  it("maps EMCfeature to EMCFeatures and writes the EMC values and multiple_display", () => {
    const p = project();
    findChild(p, "modes")!.children[0].params.features.push("EMCfeature");
    findChild(p, "cameras")!.children[0].params.imagerAddress = "0x34";
    const c = ctx({}, p);
    const { doc, mode } = complete(c);
    mode.params.multipleDisplay = true;
    const t = documentToJson(doc, c).cameraTester;
    expect(t.testModes[0].features).toEqual(["DataLogger", "EMCFeatures"]);
    expect(t.testModes[0].multiple_display).toBe(true);
    expect(t.testModes[0].cameraModels[0]).toMatchObject({ imagerAddress: 52, eeprom: { Lenght: 0, Address: [] } });
    expect(validate(documentToJson(doc, c))).toBe(true);
  });

  it("opens an existing file and writes everything it does not edit back unchanged", () => {
    const c = ctx({ dirs: { bitfile: "C:\\bench\\fpga_bitfile" } });
    const { doc } = complete(c);
    const json = documentToJson(doc, c);
    const cam = json.cameraTester.testModes[0].cameraModels[0];
    cam.fifoCommands = { _comments: "kept", "0x01": { name: "channel", "address[0:7]": "0x01" } };
    cam.reactionAnalysis = { reaction_analysis: [] };
    cam.channelConfiguration[0].i2cWorker.monitoringCmd = { eventNumber: 3, dataStructure: [] };
    cam.channelConfiguration[0].vcConfiguration[0].frameAnalysisWorker.push({ Height: ["1536"], Width: ["1824"] });
    json.cameraTester.customKey = "x";
    const back = documentFromJson(structuredClone(json));
    expect(back.root.type).toBe("tester");
    expect(back.root.params.project).toBe("ADAS_Vision_Project_Sample_v1.0.0.json");
    expect(back.root.children[0].children[0].params.fpgaBitFile).toBe("FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx");
    expect(documentToJson(back, c)).toEqual(json);
    // without the project / settings the values from the file are kept
    const bare = documentToJson(back, defaultCatalog());
    expect(bare.cameraTester.testModes[0].cameraModels[0]).toMatchObject({ imager: "SENSOR_MODEL_X", fpgaDefaults: cam.fpgaDefaults });
    expect(bare.cameraTester.testModes[0].hardwareInfo).toEqual(json.cameraTester.testModes[0].hardwareInfo);
  });

  it("offers the modes, camera models and hardware of the selected project", () => {
    const c = ctx();
    expect(optionsFor("projectModes", c).values).toEqual(["CaptureMode", "PassthroughMode"]);
    expect(optionsFor("projectCameras", c).values).toEqual(["ADAS_Camera_Model_A"]);
    const rec = { cameraModel: "ADAS_Camera_Model_A", $mode: "CaptureMode" };
    expect(optionsFor("projectManufacturers", c, rec).values).toEqual(["NationalInstruments"]);
    expect(optionsFor("projectDeviceModels", c, { ...rec, manufacturer: "NationalInstruments" }).values).toEqual(["NI1487"]);
    expect(optionsFor("projectModes", defaultCatalog()).unknown).toBe(true);
    const params = { cameraModel: "ADAS_Camera_Model_A", manufacturer: "Acme", deviceModel: "X" };
    cascadeTesterCamera(params, c, "PassthroughMode");
    expect(params).toMatchObject({ manufacturer: "NationalInstruments", deviceModel: "NI1487" });
  });

  it("adds each project mode once and fills a new camera model from the project", () => {
    const c = ctx();
    const { t, cam, idx } = build(c);
    expect(childOptions(t, idx, c)[0]).toMatchObject({ enabled: true, description: "Next: PassthroughMode" });
    insertChild(t, childOptions(t, idx, c)[0].create());
    expect(childOptions(t, new TreeIndex(t), c)[0].enabled).toBe(false);
    expect(cam.params).toMatchObject({ cameraModel: "ADAS_Camera_Model_A", name: "ADAS_Camera_Model_A", deviceMode: "8in", fpgaBoardName: "board1" });
    expect(optionRecord(cam, idx).$mode).toBe("CaptureMode");
  });

  it("checks bit file, device and channels", () => {
    const c = ctx();
    const { doc, cam, ch } = complete(c);
    cam.params.fpgaBitFile = "FPGA_8IN_NI1486_capture_v10.0.0.lvbitx";
    cam.params.dataloggerCommands = "gone.json";
    const so = addChannel(cam, c, "ECU");
    so.params.channel = ch.params.channel;
    const msgs = validateTree(doc.root, new TreeIndex(doc.root), c).map((i) => `${i.severity}: ${i.message}`);
    expect(msgs).toContain("warning: Bit file FPGA_8IN_NI1486_capture_v10.0.0.lvbitx is built for NI1486, not for NI1487");
    expect(msgs).toContain("warning: Bit file FPGA_8IN_NI1486_capture_v10.0.0.lvbitx is a 8in build, but Device Mode is 4in/4out");
    expect(msgs).toContain("error: Datalogger Configuration 'gone.json' is not found in the datalogger_configuration folder");
    expect(msgs).toContain("error: Channel SI0 is used more than once in this camera model");
  });

  it("reports what the schema rejects on the node it comes from", () => {
    const c = ctx();
    const { doc, mode, vc } = complete(c);
    mode.params.mode = "EMCMode"; // not a CTP test mode
    vc.params.virtualChannel = 7;  // not in the project → frameInfo comes out incomplete? no: default frameInfo is valid
    const issues = schemaIssues(doc.root, c);
    expect(issues.map((i) => i.message)).toContain('Tester schema: testModes[0].mode must be one of "CaptureMode", "PassthroughMode"');
    expect(issues.find((i) => i.message.includes("testModes[0].mode"))!.nodeId).toBe(mode.id);
  });

  it("writes i2cCheckingConfig from the project only with Monitoring & Checking", () => {
    const c = ctx();
    const { t, ch } = complete(c);
    const w = ch.children.find((x) => x.type === "i2cWorker")!;
    const idx = new TreeIndex(t);
    expect(i2cCheckingMonitoring(w, idx, c).checking).toBe(false);
    w.params.i2cWorkerMode = "Monitoring & Checking";
    const info = i2cCheckingMonitoring(w, idx, c);
    expect(info.checking).toBe(true);
    expect(info.monitoring?.type).toBe("monitoring");
    const out = exportTester(t, c) as any;
    const cfg = out.cameraTester.testModes[0].cameraModels[0].channelConfiguration[0].i2cWorker.i2cCheckingConfig;
    expect(Object.keys(cfg).sort()).toEqual(["error_count", "register_monitor", "temperature_monitor"]);
    expect(cfg.register_monitor).toEqual(info.monitoring!.params.register_monitor);
    expect(validate(out)).toBe(true);
    expect(schemaIssues(t, c).filter((i) => i.nodeId === w.id)).toEqual([]);
    // the project's camera model has no I2C Monitoring → warning on the worker, file carries null
    const p = project();
    const pc = findChild(p, "cameras")!.children[0];
    pc.children = pc.children.filter((k) => k.type !== "monitoring");
    const c2 = ctx({}, p);
    const out2 = exportTester(t, c2) as any;
    expect(out2.cameraTester.testModes[0].cameraModels[0].channelConfiguration[0].i2cWorker.i2cCheckingConfig).toBeNull();
    expect(schemaIssues(t, c2).filter((i) => i.nodeId === w.id).map((i) => i.severity)).toEqual(["warning"]);
  });

  it("gives every channel an I2C worker and every virtual channel a frame analysis worker", () => {
    const c = ctx();
    const { cam } = build(c);
    const ch = addChannel(cam, c);
    expect(ch.children.map((x) => x.type)).toEqual(["i2cWorker"]);
    expect(DEFS.i2cWorker.deletable).toBe(false);
    const vc = addVc(ch, c);
    expect(vc.children.map((x) => x.type)).toEqual(["frameAnalysisWorker"]);
    expect(vc.children[0].params.frameVerification).toBe(true);
    expect(nodeLabel(ch)).toBe("SI0 – Front");
    expect(nodeLabel(vc)).toBe("VC0 – Front");
  });

  it("shows Multiple Display only when the project enables EMCfeature", () => {
    const off = ctx();
    const { doc, mode, idx } = build(off);
    expect(featureEnabled(idx, "EMCfeature", off)).toBe(false);
    mode.params.multipleDisplay = "not a bool";
    expect(validateTree(doc.root, idx, off).filter((i) => i.field === "multipleDisplay")).toEqual([]);
  });

  it("exports without a project loaded (all lists unknown)", () => {
    const doc = newTesterDocument("x_v1.0.0.json");
    expect(exportTester(doc.root, defaultCatalog()).cameraTester.project).toEqual({ name: "x", version: "" });
  });
});
