// CPU profile of validateTree on the large tester: npx vite-node perf/profile_validate.ts
import { Session } from "node:inspector/promises";
import { readFileSync } from "node:fs";
import { defaultCatalog } from "../src/core/catalog";
import { documentFromJson, TreeIndex, validateTree } from "../src/core/model";

const dir = process.argv[2] ?? "/tmp/perfbench";
const pj = JSON.parse(readFileSync(`${dir}/configurations/project_configuration/ADAS_Vision_Project_Sample_v1.0.0.json`, "utf8"));
const tj = JSON.parse(readFileSync(`${dir}/configurations/tester_configuration/PERF_BENCH_v1.0.0.json`, "utf8"));
const proot = documentFromJson(pj).root;
const c = { ...defaultCatalog(), ctx: { projectFiles: [], project: { name: "p", root: proot }, bitfiles: ["FPGA_4IN4OUT_NI1487_Universal_v10.0.0.lvbitx"], dataloggers: [], i2cFiles: ["front_init.txt"], dirs: {} } };
const doc = documentFromJson(tj);
const idx = new TreeIndex(doc.root);
for (let i = 0; i < 50; i++) validateTree(doc.root, idx, c);
const s = new Session(); s.connect();
await s.post("Profiler.enable"); await s.post("Profiler.setSamplingInterval", { interval: 50 }); await s.post("Profiler.start");
const t0 = performance.now(); for (let i = 0; i < 300; i++) validateTree(doc.root, idx, c);
console.log("validateTree ms", ((performance.now() - t0) / 300).toFixed(2));
const { profile } = await s.post("Profiler.stop");
const nodes = new Map(profile.nodes.map((n: any) => [n.id, n]));
const parent = new Map<number, number>(); for (const n of profile.nodes) for (const ch of n.children ?? []) parent.set(ch, n.id);
const self = new Map<string, number>(), incl = new Map<string, number>();
profile.samples.forEach((sid: number, i: number) => {
  const d = profile.timeDeltas[i];
  const key = (n: any) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
  self.set(key(nodes.get(sid)), (self.get(key(nodes.get(sid))) ?? 0) + d);
  const seen = new Set<string>(); let x: number | undefined = sid;
  while (x !== undefined) { const k = key(nodes.get(x)); if (!seen.has(k)) { incl.set(k, (incl.get(k) ?? 0) + d); seen.add(k); } x = parent.get(x); }
});
const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`).join("\n");
console.log("--- self\n" + top(self, 20) + "\n--- inclusive\n" + top(incl, 30));
