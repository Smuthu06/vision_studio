/** Step-by-step build guide: derives a checklist from the current tree + issues. */
import { DEFS, findChild, projectModes, TreeIndex, type CNode, type Issue, type NodeType } from "./model";
import { FEATURE_FAULTINJECTION, MODE_CAPTURE, MODE_PASSTHROUGH } from "./schema";

export type StepStatus = "done" | "todo" | "optional" | "attention";
export type StepAction =
  | { kind: "select"; nodeId: string }
  | { kind: "add"; parentId: string; type: NodeType; mode?: string };

export interface BuildStep {
  id: string;
  title: string;
  detail: string;
  status: StepStatus;
  action?: StepAction;
}

const hasErrorsIn = (n: CNode, issues: Issue[], idx: TreeIndex) => {
  const ids = new Set<string>();
  const visit = (x: CNode) => { ids.add(x.id); x.children.forEach(visit); };
  visit(n);
  void idx;
  return issues.some((i) => i.severity === "error" && ids.has(i.nodeId));
};

/** Tester configuration: tester info → modes → camera models (with channels) → validate. */
function computeTesterSteps(root: CNode, issues: Issue[], idx: TreeIndex): BuildStep[] {
  const steps: BuildStep[] = [];
  const err = (n: CNode) => issues.some((i) => i.nodeId === n.id && i.severity === "error");
  steps.push({ id: "tester", title: "Tester information", status: err(root) ? "attention" : "done",
    detail: err(root) ? "Fill in tester name, version, author and email" : String(root.params.project || "Metadata complete"),
    action: { kind: "select", nodeId: root.id } });
  const modes = root.children;
  if (!modes.length) steps.push({ id: "modes", title: "Modes", status: "todo", detail: "Right-click the tester to add a mode", action: { kind: "add", parentId: root.id, type: "testerMode" } });
  else {
    const bad = modes.find((m) => err(m));
    steps.push({ id: "modes", title: "Modes", status: bad ? "attention" : "done", detail: modes.map((m) => m.params.mode || "?").join(" + "),
      action: { kind: "select", nodeId: (bad ?? modes[0]).id } });
    const empty = modes.find((m) => !m.children.length);
    const cams = modes.flatMap((m) => m.children);
    const badCam = cams.find((c) => hasErrorsIn(c, issues, idx));
    steps.push(empty
      ? { id: "cameras", title: "Camera models", status: "todo", detail: `Add a camera model to ${empty.params.mode || "the mode"}`, action: { kind: "add", parentId: empty.id, type: "testerCamera" } }
      : { id: "cameras", title: "Camera models", status: badCam ? "attention" : "done",
        detail: badCam ? `Complete ${DEFS.testerCamera.label!(badCam)}` : `${cams.length} camera model(s)`, action: { kind: "select", nodeId: (badCam ?? cams[0]).id } });
    const noCh = cams.find((c) => !(Array.isArray(c.params.channels) && c.params.channels.length));
    if (cams.length) steps.push(noCh
      ? { id: "channels", title: "Channels", status: "todo", detail: `Add channels to ${DEFS.testerCamera.label!(noCh)}`, action: { kind: "select", nodeId: noCh.id } }
      : { id: "channels", title: "Channels", status: "done", detail: `${cams.reduce((a, c) => a + c.params.channels.length, 0)} channel(s)` });
  }
  const nErr = issues.filter((i) => i.severity === "error").length;
  steps.push({ id: "validate", title: "Validate & export", status: nErr ? "attention" : (steps.every((s) => s.status !== "todo") ? "done" : "todo"),
    detail: nErr ? `${nErr} error(s) to resolve` : "Ready to save the JSON" });
  return steps;
}

export function computeSteps(root: CNode, issues: Issue[], idx = new TreeIndex(root)): BuildStep[] {
  if (root.type === "tester") return computeTesterSteps(root, issues, idx);
  const steps: BuildStep[] = [];
  const rootErr = issues.some((i) => i.nodeId === root.id && i.severity === "error");
  steps.push({
    id: "project", title: "Project information", status: rootErr ? "attention" : "done",
    detail: rootErr ? "Fill in name, version, author, email and date" : "Metadata complete",
    action: { kind: "select", nodeId: root.id },
  });

  const modes = findChild(root, "modes");
  if (!modes) steps.push({ id: "modes", title: "Project modes", status: "todo", detail: "Add the Project Modes container", action: { kind: "add", parentId: root.id, type: "modes" } });
  else if (!modes.children.length) steps.push({ id: "modes", title: "Project modes", status: "todo", detail: "Add CaptureMode and/or PassthroughMode", action: { kind: "add", parentId: modes.id, type: "mode", mode: MODE_CAPTURE } });
  else steps.push({ id: "modes", title: "Project modes", status: hasErrorsIn(modes, issues, idx) ? "attention" : "done",
    detail: modes.children.map((m) => m.params.mode).join(" + "), action: { kind: "select", nodeId: modes.id } });

  const cams = findChild(root, "cameras");
  const cameraList = cams?.children ?? [];
  if (!cams) steps.push({ id: "cameras", title: "Camera models", status: "todo", detail: "Add the Camera Models container", action: { kind: "add", parentId: root.id, type: "cameras" } });
  else if (!cameraList.length) steps.push({ id: "cameras", title: "Camera models", status: "todo", detail: "Add at least one camera model", action: { kind: "add", parentId: cams.id, type: "camera" } });
  else {
    const bad = cameraList.find((c) => issues.some((i) => i.nodeId === c.id && i.severity === "error"));
    steps.push({ id: "cameras", title: "Camera models", status: bad ? "attention" : "done",
      detail: bad ? `Complete ${DEFS.camera.label!(bad)}` : `${cameraList.length} camera model(s)`,
      action: { kind: "select", nodeId: (bad ?? cameraList[0]).id } });
  }

  const pm = projectModes(idx);
  if (cameraList.length) {
    // Hardware for every enabled mode
    let hwStep: BuildStep | null = null;
    for (const cam of cameraList) {
      const hw = findChild(cam, "hardware");
      const label = DEFS.camera.label!(cam);
      if (!hw) { hwStep = { id: "hw", title: "Hardware", status: "todo", detail: `Add Hardware to ${label}`, action: { kind: "add", parentId: cam.id, type: "hardware" } }; break; }
      if (pm.has(MODE_CAPTURE) && !findChild(hw, "hwCapture")) { hwStep = { id: "hw", title: "Hardware", status: "todo", detail: `Add Capture Hardware to ${label}`, action: { kind: "add", parentId: hw.id, type: "hwCapture" } }; break; }
      if (pm.has(MODE_PASSTHROUGH) && !findChild(hw, "hwPassthrough")) { hwStep = { id: "hw", title: "Hardware", status: "todo", detail: `Add Passthrough Hardware to ${label}`, action: { kind: "add", parentId: hw.id, type: "hwPassthrough" } }; break; }
      if (!hw.children.length) { hwStep = { id: "hw", title: "Hardware", status: "todo", detail: `Add a hardware board to ${label}`, action: { kind: "add", parentId: hw.id, type: "hwCapture" } }; break; }
      if (hasErrorsIn(hw, issues, idx)) { hwStep = { id: "hw", title: "Hardware", status: "attention", detail: `Fix hardware of ${label}`, action: { kind: "select", nodeId: (hw.children.find((c) => hasErrorsIn(c, issues, idx)) ?? hw).id } }; break; }
    }
    steps.push(hwStep ?? { id: "hw", title: "Hardware", status: "done", detail: "Boards defined for every enabled mode", action: { kind: "select", nodeId: findChild(cameraList[0], "hardware")!.id } });

    // Frame information
    let frStep: BuildStep | null = null;
    for (const cam of cameraList) {
      const fr = findChild(cam, "frames");
      const label = DEFS.camera.label!(cam);
      if (!fr) { frStep = { id: "frames", title: "Frame information", status: "todo", detail: `Add Frame Information to ${label}`, action: { kind: "add", parentId: cam.id, type: "frames" } }; break; }
      if (!fr.children.length) { frStep = { id: "frames", title: "Frame information", status: "todo", detail: `Add a virtual channel to ${label}`, action: { kind: "add", parentId: fr.id, type: "vc" } }; break; }
      if (hasErrorsIn(fr, issues, idx)) { frStep = { id: "frames", title: "Frame information", status: "attention", detail: `Fix virtual channels of ${label}`, action: { kind: "select", nodeId: (fr.children.find((c) => hasErrorsIn(c, issues, idx)) ?? fr).id } }; break; }
    }
    const vcCount = cameraList.reduce((a, c) => a + (findChild(c, "frames")?.children.length ?? 0), 0);
    steps.push(frStep ?? { id: "frames", title: "Frame information", status: "done", detail: `${vcCount} virtual channel(s)`, action: { kind: "select", nodeId: findChild(cameraList[0], "frames")!.id } });

    // Optional sections
    const fiWanted = [...pm.values()].some((f) => f.has(FEATURE_FAULTINJECTION));
    const firstNoFault = cameraList.find((c) => !findChild(c, "fault"));
    const anyFault = cameraList.map((c) => findChild(c, "fault")).find(Boolean);
    steps.push(firstNoFault && fiWanted
      ? { id: "fault", title: "Fault injection", status: "todo", detail: "FaultInjection is enabled – define faults", action: { kind: "add", parentId: firstNoFault.id, type: "fault" } }
      : anyFault
        ? { id: "fault", title: "Fault injection", status: hasErrorsIn(anyFault, issues, idx) ? "attention" : "done", detail: DEFS.fault.summary!(anyFault), action: { kind: "select", nodeId: anyFault.id } }
        : { id: "fault", title: "Fault injection", status: "optional", detail: "Optional – needs the FaultInjection feature", action: firstNoFault ? { kind: "add", parentId: firstNoFault.id, type: "fault" } : undefined });

    const firstNoMon = cameraList.find((c) => !findChild(c, "monitoring"));
    const anyMon = cameraList.map((c) => findChild(c, "monitoring")).find(Boolean);
    steps.push(anyMon
      ? { id: "monitoring", title: "I2C monitoring", status: hasErrorsIn(anyMon, issues, idx) ? "attention" : "done", detail: DEFS.monitoring.summary!(anyMon), action: { kind: "select", nodeId: anyMon.id } }
      : { id: "monitoring", title: "I2C monitoring", status: "optional", detail: "Optional – link health telemetry", action: firstNoMon ? { kind: "add", parentId: firstNoMon.id, type: "monitoring" } : undefined });
  }

  const nErr = issues.filter((i) => i.severity === "error").length;
  steps.push({ id: "validate", title: "Validate & export", status: nErr ? "attention" : (steps.every((s) => s.status !== "todo") ? "done" : "todo"),
    detail: nErr ? `${nErr} error(s) to resolve` : "Ready to save the JSON" });
  return steps;
}
