/**
 * Performance benchmark of the work done on every edit (no UI): tree index, validation (incl. the
 * tester schema check), build guide, JSON export, plus load time and retained heap.
 *
 *   npx vite-node perf/perf.ts            # prints a table
 *   npx vite-node perf/perf.ts --json     # machine readable (perf/baseline.json)
 *
 * Sizes: a small document like the sample, and large ones (40 camera models; a tester with
 * 2 modes × 8 camera models × 8 channels × 4 virtual channels ≈ 1300 nodes).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sample from "../src/assets/sample.json";
import { projectFileName } from "../src/core/filename";
import { defaultCatalog, type Catalog } from "../src/core/catalog";
import { exportTester } from "../src/core/ctpTester";
import { computeSteps } from "../src/core/guide";
import {
  childOptions, documentFromJson, documentToJson, insertChild, newTesterDocument, TreeIndex, validateTree, walk,
  type CNode, type ConfigDocument,
} from "../src/core/model";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ------------------------------------------------------------------ documents
function bigProject(cameras: number): Json {
  const s = structuredClone(sample) as Json;
  const cam0 = s.project.cameraModels[0];
  s.project.cameraModels = Array.from({ length: cameras }, (_, i) => ({ ...structuredClone(cam0), model: `CAM_${i}` }));
  return s;
}

function catalogFor(project: CNode): Catalog {
  return {
    ...defaultCatalog(),
    ctx: {
      projectFiles: ["sample_v1.0.0.json"], project: { name: "sample_v1.0.0.json", root: project },
      bitfiles: ["FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx", "FPGA_8IN_NI1486_capture_v10.0.0.lvbitx"],
      dataloggers: ["logger.json"], i2cFiles: ["front_init.txt"], dirs: { bitfile: "/b/fpga_bitfile", i2c: "/b/i2c" },
    },
  };
}

/** A tester built like the UI does (menus), then widened by copying the written file. */
function bigTester(c: Catalog, cams: number, chans: number, vcs: number): Json {
  const doc = newTesterDocument("sample_v1.0.0.json");
  const t = doc.root;
  Object.assign(t.params, { applicationName: "PERF", author: "perf", emailAddress: "p@x.com", date: "01/01/2026" });
  for (let i = 0; i < 2; i++) insertChild(t, childOptions(t, new TreeIndex(t), c)[0].create()); // CaptureMode, PassthroughMode
  for (const mode of t.children) {
    const cam = childOptions(mode, new TreeIndex(t), c)[0].create();
    insertChild(mode, cam);
    Object.assign(cam.params, { deviceResource: "PXI1Slot2", fpgaBitFile: "FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx", deviceMode: "4in/4out" });
    const ch = childOptions(cam, new TreeIndex(t), c)[0].create();
    insertChild(cam, ch);
    const vc = childOptions(ch, new TreeIndex(t), c).find((o) => o.type === "testerVc")!.create();
    insertChild(ch, vc);
  }
  const out = exportTester(t, c) as Json;
  for (const m of out.cameraTester.testModes) {
    const cam0 = m.cameraModels[0];
    const pass = m.mode === "PassthroughMode";
    m.cameraModels = Array.from({ length: cams }, (_, k) => {
      const cam = structuredClone(cam0);
      cam.name = `CAM_${k}`;
      const ch0 = cam.channelConfiguration[0];
      cam.channelConfiguration = Array.from({ length: chans }, (_, j) => {
        const ch = structuredClone(ch0);
        const io = pass ? ch.input : ch;
        io.channel = `SI${j}`;
        if (pass) ch.output.channel = `SO${j}`;
        io.vcConfiguration = Array.from({ length: vcs }, () => structuredClone(io.vcConfiguration[0]));
        return ch;
      });
      return cam;
    });
  }
  return out;
}

// ------------------------------------------------------------------ measuring
const now = () => performance.now();
function time(fn: () => unknown, minMs = 300): number { // median ms per call
  fn(); fn();
  const runs: number[] = [];
  const t0 = now();
  while (now() - t0 < minMs || runs.length < 5) { const a = now(); fn(); runs.push(now() - a); }
  runs.sort((a, b) => a - b);
  return runs[runs.length >> 1];
}
const gc = () => (globalThis as { gc?: () => void }).gc?.();
function heapOf(make: () => unknown): number { // MB retained by the result
  gc(); const before = process.memoryUsage().heapUsed;
  const keep = make();
  gc(); const after = process.memoryUsage().heapUsed;
  void keep;
  return (after - before) / 1048576;
}

/** One "edit": what App recomputes after a change (index, validation, guide). */
function perEdit(doc: ConfigDocument, c: Catalog) {
  const idx = new TreeIndex(doc.root);
  const issues = validateTree(doc.root, idx, c);
  computeSteps(doc.root, issues, idx);
  return issues;
}

const rows: Record<string, Record<string, number | string>> = {};
function measure(name: string, json: Json, c: Catalog) {
  const text = JSON.stringify(json);
  const doc = documentFromJson(JSON.parse(text));
  const nodes = [...walk(doc.root)].length;
  const idx = new TreeIndex(doc.root);
  const issues = validateTree(doc.root, idx, c);
  rows[name] = {
    nodes, issues: issues.length, "file KB": +(text.length / 1024).toFixed(1),
    "load ms": +time(() => documentFromJson(JSON.parse(text))).toFixed(2),
    "index ms": +time(() => new TreeIndex(doc.root)).toFixed(3),
    "validate ms": +time(() => validateTree(doc.root, idx, c)).toFixed(2),
    "guide ms": +time(() => computeSteps(doc.root, issues, idx)).toFixed(3),
    "per edit ms": +time(() => perEdit(doc, c)).toFixed(2),
    "export ms": +time(() => JSON.stringify(documentToJson(doc, c))).toFixed(2),
    "heap MB": +heapOf(() => documentFromJson(JSON.parse(text))).toFixed(2),
  };
}

const projectSmall = documentFromJson(structuredClone(sample)).root;
const cSmall = catalogFor(projectSmall);
measure("project (sample)", sample, defaultCatalog());
measure("project (40 cameras)", bigProject(40), defaultCatalog());
measure("tester (small)", bigTester(cSmall, 1, 1, 1), cSmall);
measure("tester (2×8×8×4)", bigTester(cSmall, 8, 8, 4), cSmall);

// --write <bench>: put the large project + tester into a bench folder for the browser benchmark
const w = process.argv.indexOf("--write");
if (w > 0) {
  const dir = process.argv[w + 1];
  const pj = bigProject(40);
  const proot = documentFromJson(structuredClone(pj)).root;
  const tj = bigTester(catalogFor(proot), 8, 8, 4);
  const pfile = projectFileName(proot.params);
  tj.cameraTester.applicationName = "PERF_BENCH";
  writeFileSync(`${dir}/configurations/project_configuration/${pfile}`, JSON.stringify(pj, null, 2));
  mkdirSync(`${dir}/configurations/tester_configuration`, { recursive: true });
  writeFileSync(`${dir}/configurations/tester_configuration/PERF_BENCH_v1.0.0.json`, JSON.stringify(tj, null, 2));
  console.log(`wrote ${pfile} and PERF_BENCH_v1.0.0.json`);
} else if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else console.table(rows);
