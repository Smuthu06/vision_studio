/**
 * File name of a configuration in the project folder: `<project>_v<version>.json`.
 *   project "sample", version "V.1.0.0"  →  sample_v1.0.0.json
 * Characters Windows does not allow in file names become "_".
 */
const clean = (s: string) =>
  s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().replace(/^[. ]+|[. ]+$/g, "");

export function projectFileName(params: Record<string, unknown>): string {
  const project = clean(String(params.project ?? "")) || "Untitled";
  const version = clean(String(params.version ?? "").replace(/^v\.?\s*/i, ""));
  return `${project}${version ? `_v${version}` : ""}.json`;
}

/** File name of any configuration: projects by project name, testers by tester name. */
export function configFileName(root: { type: string; params: Record<string, unknown> }): string {
  return root.type === "tester"
    ? projectFileName({ project: root.params.testerName, version: root.params.version })
    : projectFileName(root.params);
}
