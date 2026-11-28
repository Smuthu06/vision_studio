/**
 * The Vision Studio web API for `npm run dev` / `npm run preview` (Node), so the browser UI saves
 * into the configuration folders without building the native app – handy on Linux.
 * Same endpoints and rules as the native web mode (src-tauri/src/web.rs, projects.rs, ui_config.rs):
 *
 *   GET  /api/ui-config                     the Settings lists (ui_config.json)
 *   PUT  /api/ui-config      {text, baseModified}            → 409 when changed meanwhile
 *   GET  /api/files/<kind>                  folder listing  (project, tester, bitfile, datalogger, i2c)
 *   GET  /api/files/<kind>/<name>           file text
 *   PUT  /api/files/<kind>/<name>[?overwrite=1]  {text}      project / tester only, this PC only
 *
 * Folders come from the INI ([app] *_dir), resolved against the INI's folder:
 *   VS_INI=/path/to/vision-studio.ini npm run dev     – use that INI
 *   otherwise release/VisionStudio/vision-studio.ini  – the one build-linux.sh created, if any
 *   otherwise config/vision-studio.ini, resolved as if it were in release/VisionStudio/
 * so the dev server and the built app use the same folders (<repo>/configurations/… by default).
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

type Kind = "project" | "tester" | "bitfile" | "datalogger" | "i2c";
interface Folder { dir: string; ext: string; writable: boolean }

const DEFAULTS: Record<string, string> = {
  ui_config: "ui_config.json",
  project_dir: "../../configurations/project_configuration",
  tester_dir: "../../configurations/tester_configuration",
  bitfile_dir: "../../fpga_bitfile",
  datalogger_dir: "../../datalogger_configuration",
  i2c_dir: "../../configurations/i2c_configuration",
};
const MAX_BYTES = 32 * 1024 * 1024;

/** `[app]` keys of an INI file (comments with ; or #). */
function readIni(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let section = "";
  for (const raw of fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.replace(/\s[;#].*$/, "").trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { section = sec[1].trim().toLowerCase(); continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (kv && section === "app") out[kv[1].trim().toLowerCase()] = kv[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

export function benchConfig(root: string) {
  const envIni = process.env.VS_INI ? path.resolve(process.env.VS_INI) : null;
  const built = path.join(root, "release/VisionStudio/vision-studio.ini");
  const ini = envIni ?? (fs.existsSync(built) ? built : path.join(root, "config/vision-studio.ini"));
  const base = envIni ? path.dirname(envIni) : path.join(root, "release/VisionStudio");
  const app = { ...DEFAULTS, ...(fs.existsSync(ini) ? readIni(ini) : {}) };
  const at = (v: string) => path.resolve(base, v);
  const folders: Record<Kind, Folder> = {
    project: { dir: at(app.project_dir), ext: ".json", writable: true },
    tester: { dir: at(app.tester_dir), ext: ".json", writable: true },
    bitfile: { dir: at(app.bitfile_dir), ext: ".lvbitx", writable: false },
    datalogger: { dir: at(app.datalogger_dir), ext: ".json", writable: false },
    i2c: { dir: at(app.i2c_dir), ext: ".txt", writable: false },
  };
  return { ini, base, uiConfig: at(app.ui_config), folders };
}

const validName = (name: string, ext: string) =>
  name.length > ext.length && name.length <= 200 && name.toLowerCase().endsWith(ext) && !name.startsWith(".")
  && !name.endsWith(" ") && !/[/\\:*?"<>|\u0000-\u001f]/.test(name);

const mtime = (p: string) => { try { return Math.floor(fs.statSync(p).mtimeMs); } catch { return null; } };

function isLocal(req: IncomingMessage): boolean {
  const peer = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const peerLocal = peer === "::1" || peer.startsWith("127.");
  const host = (req.headers.host ?? "").replace(/^\[([^\]]*)\].*$/, "$1").replace(/:\d+$/, "").toLowerCase();
  return peerLocal && ["localhost", "127.0.0.1", "::1"].includes(host);
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BYTES + 1024) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text.endsWith("\n") ? text : text + "\n");
  fs.renameSync(tmp, file);
}

function jsonError(text: string): string | null {
  try { JSON.parse(text); return null; } catch (e) { return (e as Error).message; }
}

export function benchApi(root: string): Plugin {
  const cfg = benchConfig(root);
  const fileDto = (canSave: boolean) => {
    const p = cfg.uiConfig;
    let text: string | null = null, error: string | null = null;
    try { text = fs.readFileSync(p, "utf8").replace(/^﻿/, ""); } catch (e: any) { if (e.code !== "ENOENT") error = `Could not read ${p}: ${e.message}`; }
    if (text !== null) { const j = jsonError(text); if (j) error = `${path.basename(p)} is not valid JSON: ${j}`; }
    return { path: p, text, modified: mtime(p), canSave, error };
  };

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname.replace(/^.*?(\/api\/)/, "/api/");
    if (!p.startsWith("/api/")) return next();
    const local = isLocal(req);
    const marked = !!req.headers["x-vision-studio"];
    try {
      if (p === "/api/ui-config") {
        if (req.method === "GET" || req.method === "HEAD") return send(res, 200, fileDto(local));
        if (req.method !== "PUT") return send(res, 405, { kind: "invalid", message: "Method not allowed" });
        if (!local || !marked) return send(res, 403, { kind: "forbidden", message: "Settings can only be saved on the PC running Vision Studio" });
        const body = JSON.parse(await readBody(req));
        if (typeof body?.text !== "string") return send(res, 400, { kind: "invalid", message: "Malformed request" });
        const bad = jsonError(body.text);
        if (bad) return send(res, 400, { kind: "invalid", message: `Not valid JSON: ${bad}` });
        const now = mtime(cfg.uiConfig);
        if (now !== null && body.baseModified !== now)
          return send(res, 409, { kind: "conflict", message: `${path.basename(cfg.uiConfig)} was changed by someone else after you opened it`, current: fileDto(local) });
        writeAtomic(cfg.uiConfig, body.text);
        return send(res, 200, fileDto(local));
      }
      const m = /^\/api\/files\/([a-z0-9]+)(?:\/(.*))?$/.exec(p);
      if (!m) return send(res, 404, { kind: "notFound", message: "Not found" });
      const folder = cfg.folders[m[1] as Kind];
      if (!folder) return send(res, 404, { kind: "invalid", message: `Unknown folder '${m[1]}'` });
      if (m[2] === undefined) {
        if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { kind: "invalid", message: "Method not allowed" });
        let files: Array<{ name: string; modified: number | null; size: number }> = [];
        let error: string | null = null;
        try {
          files = fs.readdirSync(folder.dir, { withFileTypes: true })
            .filter((e) => e.isFile() && validName(e.name, folder.ext))
            .map((e) => { const f = path.join(folder.dir, e.name); return { name: e.name, modified: mtime(f), size: fs.statSync(f).size }; })
            .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || a.name.localeCompare(b.name));
        } catch (e: any) { if (e.code !== "ENOENT") error = `Could not read ${folder.dir}: ${e.message}`; }
        return send(res, 200, { dir: folder.dir, files, canSave: local && folder.writable, error });
      }
      let name: string;
      try { name = decodeURIComponent(m[2]); } catch { return send(res, 400, { kind: "invalid", message: "Malformed file name" }); }
      if (!validName(name, folder.ext)) return send(res, 400, { kind: "invalid", message: `'${name}' is not a valid file name` });
      const file = path.join(folder.dir, name);
      if (req.method === "GET" || req.method === "HEAD") {
        if (!fs.existsSync(file)) return send(res, 404, { kind: "notFound", message: `${name} is no longer in ${folder.dir}` });
        return send(res, 200, fs.readFileSync(file, "utf8").replace(/^﻿/, ""), "application/json; charset=utf-8");
      }
      if (req.method !== "PUT") return send(res, 405, { kind: "invalid", message: "Method not allowed" });
      if (!local || !marked) return send(res, 403, { kind: "forbidden", message: "Configurations can only be saved on the PC running Vision Studio" });
      if (!folder.writable) return send(res, 403, { kind: "forbidden", message: `${folder.dir} is read-only for Vision Studio` });
      const body = JSON.parse(await readBody(req));
      if (typeof body?.text !== "string") return send(res, 400, { kind: "invalid", message: "Malformed request" });
      const bad = jsonError(body.text);
      if (bad) return send(res, 400, { kind: "invalid", message: `Not valid JSON: ${bad}` });
      if (url.searchParams.get("overwrite") !== "1" && fs.existsSync(file))
        return send(res, 409, { kind: "exists", message: `${name} already exists in ${folder.dir}` });
      writeAtomic(file, body.text);
      return send(res, 200, { name, path: file, modified: mtime(file) });
    } catch (e) {
      return send(res, 500, { kind: "io", message: (e as Error).message });
    }
  };

  const announce = () => {
    console.log(`\n  Vision Studio bench API (INI: ${path.relative(root, cfg.ini) || cfg.ini})`);
    for (const [k, f] of Object.entries(cfg.folders)) console.log(`    ${k.padEnd(10)} ${f.dir}${f.writable ? "" : "  (read only)"}`);
    console.log(`    ui_config  ${cfg.uiConfig}\n`);
  };
  return {
    name: "vision-studio-bench-api",
    configureServer(server) { announce(); server.middlewares.use((req, res, next) => void handler(req, res, next)); },
    configurePreviewServer(server) { announce(); server.middlewares.use((req, res, next) => void handler(req, res, next)); },
  };
}
