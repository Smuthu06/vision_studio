/** Right-hand Details pane: full documentation of the selected node and each of its inputs. */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  columnDoc, constraintRows, containsList, fieldDoc, jsonPathOf, NODE_DOCS, resolveTable, tableDoc, type InputDoc,
} from "../core/docs";
import { DEFS, EMBEDDED_INFO_TABLE, EMBEDDED_LINE_TABLE, nodeLabel, optionRecord, type CNode, type IconName, type Issue, type TreeIndex } from "../core/model";
import { displayValue, getPath, isRequired, RANK, type FieldSpec, type Json, type Severity, type TableSpec } from "../core/schema";
import { Icon, NodeIcon } from "./icons";
import { resolveSpec, type Catalog } from "../core/catalog";

export type ActiveInput =
  | { kind: "field"; key: string }
  | { kind: "cell"; tableId: string; row: number; column: string };

/** Parse an editor input id (f-<node>-<key> / c-<table>-<row>-<col>) into an ActiveInput. */
export function parseInputId(id: string, nodeId: string): ActiveInput | null {
  const f = new RegExp(`^f-${nodeId}-(.+)$`).exec(id);
  if (f) return { kind: "field", key: f[1] };
  const c = /^c-([^-]+)-(\d+)-(.+)$/.exec(id);
  if (c) return { kind: "cell", tableId: c[1], row: +c[2], column: c[3] };
  return null;
}

/** Navigate "frameOutput[1].embeddedLine[0].info" inside params. */
function rowsAt(params: Json, tableId: string): Json[] | undefined {
  let cur = params;
  for (const tok of tableId.match(/[^.[\]]+/g) ?? []) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[/^\d+$/.test(tok) ? +tok : tok];
  }
  return Array.isArray(cur) ? cur : undefined;
}

interface Entry {
  id: string;                 // "f:<key>" or "t:<docId>:<col>"
  spec: FieldSpec;
  doc?: InputDoc;
  table?: TableSpec;
}

const worstOf = (list: Issue[]): Severity | null =>
  list.reduce<Severity | null>((w, i) => (RANK[i.severity] > RANK[w ?? "none"] ? i.severity : w), null);

function fmtJson(v: Json): string {
  if (v === undefined) return "— (not set)";
  const s = JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}

export interface DetailsPaneProps {
  catalog: Catalog;
  node: CNode;
  idx: TreeIndex;
  issues: Issue[];
  active: ActiveInput | null;
  width: number;
  onResize: (w: number) => void;
  onClose: () => void;
}

export function DetailsPane({ node, idx, issues, active, width, onResize, onClose, catalog }: DetailsPaneProps) {
  const def = DEFS[node.type];
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);   // full input list is on demand
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setExpanded(new Set()); setQuery(""); }, [node.id]);

  const tables: TableSpec[] = useMemo(
    () => [...(def.tables ?? []), ...(node.type === "vc" ? [EMBEDDED_LINE_TABLE, EMBEDDED_INFO_TABLE] : [])],
    [def, node.type]);

  const fieldEntries: Entry[] = (def.fields ?? []).map((s) => ({ id: `f:${s.key}`, spec: resolveSpec(s, catalog, optionRecord(node, idx)), doc: fieldDoc(node.type, s.key) }));
  const tableEntries = tables.map((t) => ({
    table: t,
    entries: t.columns.map((c) => ({ id: `t:${t.docId}:${c.key}`, spec: resolveSpec(c, catalog, {}), doc: columnDoc(t, c.key), table: t } as Entry)),
  }));

  // which entry corresponds to the focused input?
  const activeTable = active?.kind === "cell" ? resolveTable(node, active.tableId) : undefined;
  const activeId = active?.kind === "field" ? `f:${active.key}` : active && activeTable ? `t:${activeTable.docId}:${active.column}` : null;
  const activeEntry = [...fieldEntries, ...tableEntries.flatMap((g) => g.entries)].find((e) => e.id === activeId);

  useEffect(() => {
    // the selected input's documentation is the first card – bring it into view
    if (activeId) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeId]);

  const issuesFor = (e: Entry): Issue[] => {
    if (!e.table) return issues.filter((i) => i.field === e.spec.key && i.table === undefined);
    return issues.filter((i) => i.table !== undefined && i.column === e.spec.key && resolveTable(node, i.table)?.docId === e.table!.docId);
  };
  const currentValue = (e: Entry): { label: string; value: Json } | null => {
    if (!e.table) return { label: "Current value", value: getPath(node.params, e.spec.key) };
    if (active?.kind === "cell" && activeTable?.docId === e.table.docId) {
      const rows = rowsAt(node.params, active.tableId);
      return { label: `Current value (row ${active.row + 1})`, value: rows?.[active.row]?.[e.spec.key] };
    }
    return null;
  };

  const q = query.trim().toLowerCase();
  const match = (e: Entry) => !q || [e.spec.label, e.spec.key, e.doc?.doc, e.doc?.tip, e.table?.title].some((s) => s?.toLowerCase().includes(q));

  const focusInput = (e: Entry) => {
    let id: string | null = null;
    if (!e.table) id = `f-${node.id}-${e.spec.key}`;
    else if (active?.kind === "cell" && activeTable?.docId === e.table.docId) id = `c-${active.tableId}-${active.row}-${e.spec.key}`;
    else if (def.tables?.includes(e.table)) id = `c-${e.table.key}-0-${e.spec.key}`;
    const el = id ? document.getElementById(id) : null;
    if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); (el as HTMLElement).focus({ preventScroll: true }); }
  };
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const startDrag = (ev: React.MouseEvent) => {
    ev.preventDefault();
    const x0 = ev.clientX, w0 = width;
    const move = (m: MouseEvent) => onResize(Math.max(280, Math.min(620, w0 - (m.clientX - x0))));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const nErr = issues.filter((i) => i.severity === "error").length;
  const nWarn = issues.length - nErr;
  const groups = [
    ...(fieldEntries.length ? [{ key: "params", title: "Parameters", icon: undefined as IconName | undefined, doc: undefined as string | undefined, entries: fieldEntries.filter(match) }] : []),
    ...tableEntries.map((g) => ({ key: g.table.docId!, title: g.table.title, icon: g.table.icon as IconName | undefined, doc: tableDoc(g.table)?.doc, entries: g.entries.filter(match) })),
  ].filter((g) => g.entries.length || !q);

  return (
    <aside className="details" style={{ width }} aria-label="Details">
      <div className="details-resizer" onMouseDown={startDrag} title="Drag to resize" />
      <div className="details-head">
        <Icon name="info" size={15} />
        <span>Details</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={onClose} title="Hide details (F1)"><Icon name="x" size={14} /></button>
      </div>
      <div className="details-scroll" ref={scrollRef}>
        {!activeEntry && (fieldEntries.length > 0 || tables.length > 0) && (
          <div className="focus-empty"><Icon name="mouse" size={15} />Click any field or table cell to see its full description here.</div>
        )}
        {activeEntry && (
          <section className="focus-card" aria-live="polite">
            <div className="focus-kicker"><Icon name="mouse" size={12} />Selected input{activeEntry.table ? ` · ${activeEntry.table.title}` : ""}</div>
            <EntryDetail node={node} idx={idx} entry={activeEntry} issues={issuesFor(activeEntry).filter((i) => active?.kind !== "cell" || i.row === active.row)}
              current={currentValue(activeEntry)} tablePath={active?.kind === "cell" ? active.tableId : undefined} />
          </section>
        )}

        <section className="about">
          <div className="about-head">
            <NodeIcon name={def.icon} size={22} />
            <div><b>{nodeLabel(node)}</b><span className="muted small">{def.title}</span></div>
          </div>
          <p>{NODE_DOCS[node.type]}</p>
          <dl className="kv">
            <dt>JSON location</dt><dd><code>{jsonPathOf(node, idx)}</code></dd>
            {containsList(node).length > 0 && (<>
              <dt>Can contain</dt>
              <dd className="contains">{containsList(node).map((t) => (
                <span key={t} className="contain-chip"><NodeIcon name={DEFS[t].icon} size={14} />{t === "mode" ? "CaptureMode / PassthroughMode" : DEFS[t].title}</span>))}</dd>
            </>)}
            <dt>Status</dt>
            <dd>{issues.length ? <span className={nErr ? "sev-error" : "sev-warning"}>{nErr ? `${nErr} error(s)` : ""}{nErr && nWarn ? ", " : ""}{nWarn ? `${nWarn} warning(s)` : ""}</span>
              : <span className="ok-text"><Icon name="check" size={13} /> No issues</span>}</dd>
          </dl>
        </section>

        {(fieldEntries.length > 0 || tables.length > 0) && (
          <button className="list-toggle" onClick={() => setListOpen(!listOpen)} aria-expanded={listOpen}>
            <Icon name={listOpen ? "chevronDown" : "chevronRight"} size={13} />
            All inputs on this node
            <span className="count">{fieldEntries.length + tableEntries.reduce((n, g) => n + g.entries.length, 0)}</span>
          </button>
        )}
        {listOpen && (fieldEntries.length > 0 || tables.length > 0) && (
          <div className="details-search">
            <Icon name="list" size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter inputs…" aria-label="Filter inputs" />
            {query && <button className="icon-btn" onClick={() => setQuery("")} title="Clear"><Icon name="x" size={12} /></button>}
          </div>
        )}

        {listOpen && groups.map((g) => (
          <section key={g.key} className="doc-group">
            <h4>{g.icon && <NodeIcon name={g.icon} size={15} />}{g.title}<span className="count">{g.entries.length}</span></h4>
            {g.doc && !q && <p className="group-doc">{g.doc}</p>}
            {g.entries.map((e) => {
              const iss = issuesFor(e);
              const sev = worstOf(iss);
              const open = expanded.has(e.id) || (q !== "" && g.entries.length <= 3);
              return (
                <div key={e.id} data-entry={e.id} className={`doc-entry ${e.id === activeId ? "is-active" : ""} ${open ? "open" : ""}`}>
                  <button className="doc-entry-head" onClick={() => toggle(e.id)} onDoubleClick={() => focusInput(e)} aria-expanded={open}>
                    <Icon name={open ? "chevronDown" : "chevronRight"} size={12} className="muted" />
                    <span className="doc-label">{e.spec.label}{isRequired(e.spec) && e.spec.kind !== "bool" && <span className="req">*</span>}</span>
                    {sev && <span className={`dot dot-${sev}`} title={`${iss.length} issue(s)`} />}
                    <code className="doc-key">{e.spec.key}</code>
                  </button>
                  {!open && e.doc && <p className="doc-snippet" onClick={() => toggle(e.id)}>{e.doc.doc}</p>}
                  {open && (
                    <div className="doc-body">
                      <EntryDetail node={node} idx={idx} entry={e} issues={iss} current={currentValue(e)} compact />
                      <button className="link small" onClick={() => focusInput(e)}><Icon name="chevronRight" size={12} />Go to input</button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
        {listOpen && q && !groups.some((g) => g.entries.length) && <p className="muted small pad">No inputs match “{query}”.</p>}
        {!fieldEntries.length && !tables.length && (
          <p className="muted small pad">This node has no inputs of its own – it groups its child nodes. Right-click it in the tree to add children.</p>
        )}
      </div>
    </aside>
  );
}

function EntryDetail({ node, idx, entry, issues, current, compact, tablePath }: {
  node: CNode; idx: TreeIndex; entry: Entry; issues: Issue[]; current: { label: string; value: Json } | null;
  compact?: boolean; tablePath?: string;
}) {
  const { spec, doc, table } = entry;
  const base = jsonPathOf(node, idx);
  const generic = table === EMBEDDED_INFO_TABLE ? "frameOutput[i].embeddedLine[j].info"
    : table === EMBEDDED_LINE_TABLE ? "frameOutput[i].embeddedLine" : table?.key;
  const jsonKey = table ? `${base}.${tablePath ?? generic}[n].${spec.key}` : `${base}.${spec.key}`;
  return (
    <div className="entry-detail">
      {!compact && <h3>{spec.label}{isRequired(spec) && spec.kind !== "bool" && <span className="req">*</span>}</h3>}
      {doc ? <p className="entry-doc">{doc.doc}</p> : <p className="entry-doc muted">{spec.help}</p>}
      {issues.length > 0 && (
        <ul className="entry-issues">
          {issues.slice(0, 4).map((i, n) => <li key={n} className={`li-${i.severity}`}><Icon name={i.severity === "error" ? "error" : "alert"} size={13} />{i.message}</li>)}
          {issues.length > 4 && <li className="muted">… {issues.length - 4} more</li>}
        </ul>
      )}
      <dl className="kv">
        {constraintRows(spec).map(([k, v]) => (<span key={k} className="kv-row"><dt>{k}</dt><dd>{v}</dd></span>))}
        {doc?.unit && <span className="kv-row"><dt>Unit</dt><dd>{doc.unit}</dd></span>}
        {doc?.example && <span className="kv-row"><dt>Example</dt><dd><code>{doc.example}</code></dd></span>}
        {current && (
          <span className="kv-row"><dt>{current.label}</dt>
            <dd><code>{fmtJson(current.value)}</code>{spec.hex && typeof current.value === "number" ? <span className="muted"> = {displayValue(spec, current.value)}</span> : null}</dd>
          </span>
        )}
        <span className="kv-row"><dt>JSON key</dt><dd><code className="wrap">{jsonKey}</code></dd></span>
      </dl>
      {doc?.tip && <div className="entry-tip"><Icon name="sparkle" size={13} /><span>{doc.tip}</span></div>}
    </div>
  );
}
