/** Right pane: breadcrumb, validation banner and the editor registered for the selected node type. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  autoGpioRoutes, childOptions, defOf, EMBEDDED_INFO_TABLE, EMBEDDED_LINE_TABLE, FRAME_OUTPUT_TABLE, GPIO_TABLE,
  nodeLabel, nodeSummary, type ChildOption, type IconName, type CNode, type Issue, type NodeType, type TreeIndex,
} from "../core/model";
import { delPath, isEmpty, isRequired, kindOf, RANK, setPath, SERIAL_CHANNEL_MAX, type FieldSpec, type Json, type TableSpec } from "../core/schema";
import type { Recipe } from "../state/store";
import { cascadeHardware, resolveSpec, type Catalog } from "../core/catalog";
import { featureEnabled, findChild } from "../core/model";
import { FEATURE_EMC } from "../core/schema";

/** Table spec with its catalog-backed columns turned into dropdowns. */
const resolvedTable = (t: TableSpec, c: Catalog): TableSpec =>
  t.columns.some((x) => x.source) ? { ...t, columns: t.columns.map((x) => resolveSpec(x, c, {})) } : t;
import { DataTable, FieldForm, rowsRecipe } from "./fields";
import { Icon, NodeIcon } from "./icons";

export interface FocusRequest { issue: Issue; nonce: number }

export interface EditorProps {
  node: CNode;
  idx: TreeIndex;
  issues: Issue[];                 // issues of this node only
  mutate: (id: string, recipe: Recipe, key?: string) => void;
  onNodeMenu: (node: CNode, x: number, y: number) => void;
  onSelect: (id: string) => void;
  focus: FocusRequest | null;
  toast: (t: string, k?: "info" | "success" | "error") => void;
  detailsOpen: boolean;            // the Details pane documents inputs → keep the form free of helper text
  catalog: Catalog;                // Settings lists behind the dropdowns
}

/** Registry: node type → custom section renderer (falls back to the generic tables). */
type SectionRenderer = (p: EditorProps & { rowsFor: RowsFor }) => ReactNode;
type RowsFor = (path: (string | number)[]) => (fn: (rows: Json[]) => void, opts?: { key?: string; create?: boolean }) => void;

const SECTION_REGISTRY: Partial<Record<NodeType, SectionRenderer>> = {
  hwPassthrough: (p) => <PassthroughSection {...p} />,
  vc: (p) => <VirtualChannelSection {...p} />,
};

export function Editor(props: EditorProps) {
  const { node, idx, issues, mutate, onSelect, focus } = props;
  const def = defOf(node);
  const path = idx.path(node);
  const rowsFor: RowsFor = (p) => (fn, opts) => mutate(node.id, rowsRecipe(p, fn, !!opts?.create), opts?.key ? `${node.id}:${opts.key}` : undefined);

  // focus a field / cell after a problem was activated
  useEffect(() => {
    if (!focus || focus.issue.nodeId !== node.id) return;
    const i = focus.issue;
    if (i.table !== undefined && i.row !== undefined)
      window.dispatchEvent(new CustomEvent("cce:select-row", { detail: { tableId: i.table, row: i.row } }));
    const t = setTimeout(() => {
      const id = i.table !== undefined && i.row !== undefined ? `c-${i.table}-${i.row}-${i.column ?? defOf(node).tables?.[0]?.columns[0].key}` : i.field ? `f-${node.id}-${i.field}` : null;
      let el = id ? document.getElementById(id) : null;
      if (!el && i.table !== undefined && i.row !== undefined) el = document.querySelector(`[id^="c-${CSS.escape(i.table)}-${i.row}-"]`);
      if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); (el as HTMLElement).focus({ preventScroll: true }); }
    }, 140);
    return () => clearTimeout(t);
  }, [focus, node]);

  const onField = (spec: FieldSpec, value: Json) =>
    mutate(node.id, (params) => {
      if (!isRequired(spec) && kindOf(spec) === "str" && isEmpty(value)) delPath(params, spec.key);
      else setPath(params, spec.key, value);
      // hardware: a new manufacturer / model narrows the model and IC lists
      if ((node.type === "hwCapture" || node.type === "hwPassthrough") && (spec.key === "manufacture" || spec.key === "model"))
        cascadeHardware(params, props.catalog);
    }, `${node.id}:${spec.key}`);

  const custom = SECTION_REGISTRY[node.type];
  const opts = childOptions(node, idx, props.catalog);

  return (
    <div className="editor">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        {path.map((n, i) => (
          <span key={n.id} className="crumb-wrap">
            {i > 0 && <Icon name="chevronRight" size={13} className="crumb-sep" />}
            <button className={`crumb ${i === path.length - 1 ? "current" : ""}`} onClick={() => onSelect(n.id)}>
              {i === path.length - 1 && <NodeIcon name={defOf(n).icon} size={15} />}{nodeLabel(n)}
            </button>
          </span>
        ))}
      </nav>
      <div className="editor-scroll" key={node.id}>
        <header className="editor-head compact">
          <NodeIcon name={def.icon} size={26} />
          <h2>{nodeLabel(node)}</h2>
          {nodeLabel(node) !== def.title && <span className="type-pill">{def.title}</span>}
        </header>
        {!props.detailsOpen && <p className="muted editor-desc">{def.description}</p>}

        <Banner issues={issues} />

        {def.fields && def.fields.some((f) => !f.requiresFeature) && (
          <section className="card">
            <h3 className="card-title">Parameters</h3>
            <FieldForm nodeId={node.id} fields={def.fields.filter((f) => !f.requiresFeature).map((f) => resolveSpec(f, props.catalog, node.params))}
              params={node.params} issues={issues} onChange={onField} showHelp={!props.detailsOpen} />
          </section>
        )}
        {[...new Set((def.fields ?? []).map((f) => f.requiresFeature).filter((f): f is string => !!f))].map((feature) => (
          <FeatureSection key={feature} feature={feature} on={featureEnabled(idx, feature)} idx={idx} onSelect={onSelect}>
            <FieldForm nodeId={node.id} fields={def.fields!.filter((f) => f.requiresFeature === feature).map((f) => resolveSpec(f, props.catalog, node.params))}
              params={node.params} issues={issues} onChange={onField} showHelp={!props.detailsOpen} disabled={!featureEnabled(idx, feature)} />
          </FeatureSection>
        ))}

        {custom ? custom({ ...props, rowsFor }) : def.tables && (
          def.tableLayout === "tabs"
            ? <TabbedTables node={node} tables={def.tables.map((t) => resolvedTable(t, props.catalog))} issues={issues} rowsFor={rowsFor} focus={focus} />
            : def.tables.map((t) => (
              <section key={t.key} className="card card-flush">
                <DataTable spec={resolvedTable(t, props.catalog)} rows={node.params[t.key]} tableId={t.key} issues={issues} onRows={rowsFor([t.key])} />
              </section>
            ))
        )}

        {node.children.length > 0 && !def.fields && !def.tables && (
          <section className="card">
            <h3 className="card-title">Contents</h3>
            <div className="child-list">
              {node.children.map((c) => (
                <button key={c.id} className="child-item" onClick={() => onSelect(c.id)}>
                  <NodeIcon name={defOf(c).icon} size={28} />
                  <span className="child-text"><b>{nodeLabel(c)}</b><span className="muted small">{nodeSummary(c) || defOf(c).title}</span></span>
                  <Icon name="chevronRight" className="muted" />
                </button>
              ))}
              {(node.unknown ?? []).map((u, i) => (
                <div key={`u${i}`} className="child-item static"><Icon name="info" /><span className="child-text"><b>{Object.keys(u).join(", ")}</b><span className="muted small">Unrecognised entry – preserved on save</span></span></div>
              ))}
            </div>
          </section>
        )}

        {node.children.length === 0 && opts.some((o) => o.enabled) && <NextHint node={node} opts={opts} onNodeMenu={props.onNodeMenu} />}
      </div>
    </div>
  );
}

/** Inputs that only apply when a project mode enables `feature` (e.g. EMCfeature). */
function FeatureSection({ feature, on, idx, onSelect, children }: {
  feature: string; on: boolean; idx: TreeIndex; onSelect: (id: string) => void; children: ReactNode;
}) {
  const modes = findChild(idx.root, "modes");
  const title = feature === FEATURE_EMC ? "EMC parameters" : `${feature} parameters`;
  return (
    <section className={`card feature-card ${on ? "is-on" : "is-off"}`}>
      <div className="card-title-row">
        <h3 className="card-title">{title}</h3>
        <span className={`feature-pill ${on ? "on" : ""}`}>
          <Icon name={on ? "check" : "info"} size={13} />{on ? `${feature} enabled` : `${feature} off`}
        </span>
      </div>
      {!on && (
        <p className="feature-hint muted">
          These inputs are used only when a project mode enables <b>{feature}</b>. Their current values are kept in the file but not checked.{" "}
          {modes
            ? <button className="link" onClick={() => onSelect((modes.children[0] ?? modes).id)}>Enable it in Project Modes</button>
            : <>Add Project Modes to the project first (right-click the project).</>}
        </p>
      )}
      {children}
    </section>
  );
}

/** Banner for findings that are not attached to a visible input (cross-node checks).
 *  Field and cell problems are shown inline, so they only get a one-line count here. */
function Banner({ issues }: { issues: Issue[] }) {
  const [open, setOpen] = useState(false);
  const nodeLevel = issues.filter((i) => i.field === undefined && (i.table === undefined || i.row === undefined));
  const inline = issues.length - nodeLevel.length;
  if (!issues.length) return null;
  if (!nodeLevel.length) {
    const errs = issues.filter((i) => i.severity === "error").length;
    return (
      <div className={`banner-mini ${errs ? "sev-error" : "sev-warning"}`} role="status">
        <Icon name={errs ? "error" : "alert"} size={14} />
        {inline} input{inline > 1 ? "s" : ""} need{inline > 1 ? "" : "s"} attention – marked below
      </div>
    );
  }
  const sev = nodeLevel.some((i) => i.severity === "error") ? "error" : "warning";
  const list = [...nodeLevel].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  const shown = open ? list : list.slice(0, 3);
  return (
    <div className={`banner banner-${sev}`} role="status">
      <Icon name={sev === "error" ? "error" : "alert"} size={16} />
      <div className="banner-body">
        <ul>{shown.map((i, n) => <li key={n} className={`li-${i.severity}`}>{i.message}</li>)}</ul>
        {list.length > 3 && <button className="link" onClick={() => setOpen(!open)}>{open ? "Show less" : `Show all ${list.length}`}</button>}
        {inline > 0 && <span className="muted small">{inline} more marked on the inputs below.</span>}
      </div>
    </div>
  );
}

/** Read-only guidance for empty nodes. Adding itself happens in the node's right-click menu. */
function NextHint({ node, opts, onNodeMenu }: { node: CNode; opts: ChildOption[]; onNodeMenu: (n: CNode, x: number, y: number) => void }) {
  return (
    <div className="hint-line" onContextMenu={(e) => { e.preventDefault(); onNodeMenu(node, e.clientX, e.clientY); }}>
      <Icon name="mouse" size={15} />
      <span>Next: right-click <b>{nodeLabel(node)}</b> in the tree to add</span>
      {opts.filter((o) => o.enabled).map((o) => (
        <span key={o.label} className="hint-chip" title={o.description}><NodeIcon name={o.icon} size={13} />{o.label.replace(/^Add /, "")}</span>
      ))}
    </div>
  );
}

function TabbedTables({ node, tables, issues, rowsFor, focus }: {
  node: CNode; tables: TableSpec[]; issues: Issue[]; rowsFor: RowsFor; focus: FocusRequest | null;
}) {
  const [tab, setTab] = useState(0);
  useEffect(() => {
    if (focus?.issue.nodeId === node.id && focus.issue.table) {
      const i = tables.findIndex((t) => t.key === focus.issue.table);
      if (i >= 0) setTab(i);
    }
  }, [focus, node.id, tables]);
  const t = tables[Math.min(tab, tables.length - 1)];
  return (
    <section className="card card-flush">
      <div className="tabs" role="tablist">
        {tables.map((s, i) => {
          const mine = issues.filter((x) => x.table === s.key);
          const sev = mine.reduce<string>((a, x) => (RANK[x.severity] > RANK[a] ? x.severity : a), "none");
          return (
            <button key={s.key} role="tab" aria-selected={i === tab} className={`tab ${i === tab ? "active" : ""}`} onClick={() => setTab(i)}>
              {s.icon && <NodeIcon name={s.icon as IconName} size={16} />}{s.title}<span className="count">{(node.params[s.key] ?? []).length}</span>
              {sev !== "none" && <span className={`dot dot-${sev}`} />}
            </button>
          );
        })}
      </div>
      <DataTable key={t.key} spec={t} rows={node.params[t.key]} tableId={t.key} issues={issues} onRows={rowsFor([t.key])} hideTitle />
    </section>
  );
}

function PassthroughSection({ node, issues, rowsFor, mutate, toast }: EditorProps & { rowsFor: RowsFor }) {
  const [channel, setChannel] = useState(0);
  const auto = () => {
    const added = autoGpioRoutes(JSON.parse(JSON.stringify(node.params)), channel); // dry run for the message
    if (added) mutate(node.id, (params) => { autoGpioRoutes(params, channel); });
    toast(added ? `Added ${added} GPIO route(s) on channel ${channel}` : `GPIO 0–11 are already routed on channel ${channel}`, added ? "success" : "info");
  };
  return (
    <section className="card card-flush">
      <DataTable spec={GPIO_TABLE} rows={node.params.gpioRouting} tableId="gpioRouting" issues={issues} onRows={rowsFor(["gpioRouting"])}
        emptyHint="No GPIO routes yet. Use Auto 1:1 to route GPIO 0–11 straight through, or"
        extraActions={
          <div className="auto-route">
            <select className="inp sel inp-sm" value={channel} onChange={(e) => setChannel(+e.target.value)} title="Serial channel for auto routing">
              {Array.from({ length: SERIAL_CHANNEL_MAX + 1 }, (_, i) => <option key={i} value={i}>Ch {i}</option>)}
            </select>
            <button className="btn btn-sm" onClick={auto} title="Add GPIO n → GPIO n for every pin not yet routed on this channel">
              <Icon name="wand" size={14} />Auto 1:1 (GPIO 0–11)
            </button>
          </div>
        } />
    </section>
  );
}

function VirtualChannelSection({ node, issues, rowsFor, focus, catalog }: EditorProps & { rowsFor: RowsFor }) {
  const outputs: Json[] = Array.isArray(node.params.frameOutput) ? node.params.frameOutput : [];
  const initial = useMemo(() => Math.max(0, outputs.findIndex((o) => Array.isArray(o?.embeddedLine) && o.embeddedLine.length)), [node.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [outSel, setOutSel] = useState(outputs.length ? initial : -1);
  const [lineSel, setLineSel] = useState(0);

  useEffect(() => { // focus request into nested tables
    const t = focus?.issue.nodeId === node.id ? focus.issue.table : undefined;
    const m = t && /^frameOutput\[(\d+)\]\.embeddedLine(?:\[(\d+)\]\.info)?$/.exec(t);
    if (m) { setOutSel(+m[1]); setLineSel(m[2] !== undefined ? +m[2] : (focus!.issue.row ?? 0)); }
    else if (t === "frameOutput" && focus!.issue.row !== undefined) setOutSel(focus!.issue.row);
  }, [focus, node.id]);

  const out = outSel >= 0 ? outputs[outSel] : undefined;
  const lines: Json[] | undefined = out?.embeddedLine;
  const line = Array.isArray(lines) && lineSel >= 0 ? lines[lineSel] : undefined;
  const linesId = `frameOutput[${outSel}].embeddedLine`;

  return (
    <>
      <section className="card card-flush">
        <DataTable spec={resolvedTable(FRAME_OUTPUT_TABLE, catalog)} rows={outputs} tableId="frameOutput" issues={issues} onRows={rowsFor(["frameOutput"])}
          selected={outSel} onSelect={(r) => { setOutSel(r); setLineSel(0); }} />
      </section>
      <section className="card">
        <div className="card-title-row">
          <h3 className="card-title">Embedded Lines {out ? <span className="muted">— {out.name || `Output ${outSel + 1}`}</span> : null}</h3>
          <span className="muted small">Optional metadata line definitions (typically for the “Header” stream)</span>
        </div>
        <div className="master-detail">
          <DataTable spec={EMBEDDED_LINE_TABLE} rows={lines} tableId={linesId} issues={issues}
            onRows={rowsFor(["frameOutput", outSel, "embeddedLine"])} selected={lineSel} onSelect={setLineSel}
            disabled={!out} disabledHint="Select a frame output above." emptyHint="No embedded lines for this output." />
          <DataTable spec={{ ...EMBEDDED_INFO_TABLE, title: line ? `Line ${line.lineNumber ?? lineSel} Fields` : "Line Fields" }}
            rows={line?.info} tableId={`${linesId}[${lineSel}].info`} issues={issues}
            onRows={rowsFor(["frameOutput", outSel, "embeddedLine", lineSel, "info"])}
            disabled={!line} disabledHint="Select an embedded line to edit its fields." emptyHint="No fields in this line." />
        </div>
      </section>
    </>
  );
}
