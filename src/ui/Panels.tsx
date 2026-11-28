/** Build guide (left), Problems + JSON preview (bottom). */
import { useMemo, useState } from "react";
import type { BuildStep } from "../core/guide";
import { defOf, nodeLabel, type CNode, type Issue, type TreeIndex } from "../core/model";
import { Icon, NodeIcon } from "./icons";

export function BuildGuide({ steps, onStep, open, onToggle }: {
  steps: BuildStep[]; onStep: (s: BuildStep) => void; open: boolean; onToggle: () => void;
}) {
  const required = steps.filter((s) => s.status !== "optional");
  const done = required.filter((s) => s.status === "done").length;
  const pct = Math.round((done / Math.max(1, required.length)) * 100);
  const next = steps.find((s) => s.status === "todo" || s.status === "attention");
  return (
    <div className={`guide-panel ${open ? "open" : ""}`}>
      <button className="guide-head" onClick={onToggle} aria-expanded={open}>
        <Icon name="list" size={15} />
        <span className="guide-title">Build guide</span>
        <span className="guide-progress"><span style={{ width: `${pct}%` }} /></span>
        <span className="muted small">{done}/{required.length}</span>
        <Icon name={open ? "chevronDown" : "chevronUp"} size={14} />
      </button>
      {open && (
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button className={`step step-${s.status} ${s === next ? "is-next" : ""}`} onClick={() => onStep(s)} disabled={!s.action && s.id !== "validate"}>
                <span className="step-mark">{s.status === "done" ? <Icon name="tick" size={12} strokeWidth={3} /> : s.status === "attention" ? "!" : i + 1}</span>
                <span className="step-text">
                  <b>{s.title}{s.status === "optional" && <em> optional</em>}</b>
                  <span>{s.detail}</span>
                </span>
                {s.action?.kind === "add" && s.status !== "done" && <span title="Opens the node's right-click menu"><Icon name="mouse" size={15} className="step-add" /></span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function BottomPanel({ tab, setTab, height, setHeight, issues, idx, onIssue, previewNode, wholeDoc, docJson, quiet }: {
  tab: "problems" | "json" | null; setTab: (t: "problems" | "json" | null) => void;
  height: number; setHeight: (h: number) => void;
  issues: Issue[]; idx: TreeIndex; onIssue: (i: Issue) => void;
  previewNode: CNode; wholeDoc: () => string; docJson: (n: CNode) => string;
  quiet?: boolean;            // before the first validation: neutral count instead of red
}) {
  const [scope, setScope] = useState<"node" | "doc">("node");
  const errs = issues.filter((i) => i.severity === "error").length;
  const sorted = useMemo(() => {
    const order = new Map<string, number>();
    let k = 0;
    const visit = (n: CNode) => { order.set(n.id, k++); n.children.forEach(visit); };
    visit(idx.root);
    return [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1) || (order.get(a.nodeId)! - order.get(b.nodeId)!));
  }, [issues, idx]);
  const jsonText = tab === "json" ? (scope === "doc" ? wholeDoc() : docJson(previewNode)) : "";

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = height;
    const move = (ev: MouseEvent) => setHeight(Math.max(120, Math.min(window.innerHeight * 0.7, h0 + (y0 - ev.clientY))));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="bottom" style={{ height: tab ? height : undefined }}>
      {tab && <div className="resizer" onMouseDown={startDrag} title="Drag to resize" />}
      <div className="bottom-tabs">
        <button className={`tab ${tab === "problems" ? "active" : ""}`} onClick={() => setTab(tab === "problems" ? null : "problems")}>
          <Icon name="alert" size={14} />Problems
          {issues.length > 0 && <span className={`count ${quiet ? "count-quiet" : errs ? "count-err" : "count-warn"}`}>{issues.length}</span>}
        </button>
        <button className={`tab ${tab === "json" ? "active" : ""}`} onClick={() => setTab(tab === "json" ? null : "json")}>
          <Icon name="code" size={14} />JSON Preview
        </button>
        <span className="spacer" />
        {tab === "json" && (
          <>
            <div className="seg">
              <button className={scope === "node" ? "on" : ""} onClick={() => setScope("node")}>Selected node</button>
              <button className={scope === "doc" ? "on" : ""} onClick={() => setScope("doc")}>Whole file</button>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard?.writeText(jsonText)} title="Copy JSON"><Icon name="clipboard" size={14} />Copy</button>
          </>
        )}
        {tab && <button className="btn btn-sm btn-ghost" onClick={() => setTab(null)} title="Hide panel"><Icon name="chevronDown" size={14} /></button>}
      </div>
      {tab === "problems" && (
        <div className="problems">
          {!sorted.length && <div className="empty-ok"><Icon name="check" size={18} />No problems – the configuration is valid.</div>}
          {sorted.map((i, n) => {
            const node = idx.get(i.nodeId);
            return (
              <button key={n} className="problem" onClick={() => onIssue(i)} title="Go to problem">
                <Icon name={i.severity === "error" ? "error" : "alert"} size={15} className={`sev-${i.severity}`} />
                <span className="problem-node">{node && <NodeIcon name={defOf(node).icon} size={15} />}{node ? idx.path(node).slice(1).map(nodeLabel).join(" › ") || nodeLabel(node) : ""}</span>
                <span className="problem-msg">{i.message}</span>
              </button>
            );
          })}
        </div>
      )}
      {tab === "json" && <pre className="json-preview">{jsonText}</pre>}
    </div>
  );
}
