/** Spec-driven inputs: form fields and the editable data table. */
import { useEffect, useId, useMemo, useState } from "react";
import type { Issue } from "../core/model";
import {
  coerceValue, displayValue, getPath, isRequired, kindOf, newRow, RANK,
  type FieldSpec, type Json, type Severity, type TableSpec,
} from "../core/schema";
import { Icon, NodeIcon } from "./icons";
import { SOURCE_INFO } from "../core/catalog";
import type { IconName } from "../core/model";

export interface CellIssue { severity: Severity; messages: string[] }

function worst(list: Issue[]): CellIssue | undefined {
  if (!list.length) return undefined;
  const sev = list.reduce<Severity>((s, i) => (RANK[i.severity] > RANK[s] ? i.severity : s), "warning");
  return { severity: sev, messages: list.map((i) => i.message) };
}

// --------------------------------------------------------------------------
// Single input (used in forms and table cells)
// --------------------------------------------------------------------------
interface InputProps {
  spec: FieldSpec;
  value: Json;
  onChange: (v: Json) => void;
  issue?: CellIssue;
  id?: string;
  cell?: boolean;
  disabled?: boolean;
}

export function FieldInput({ spec, value, onChange, issue, id, cell, disabled }: InputProps) {
  const k = kindOf(spec);
  const cls = `inp ${cell ? "inp-cell" : ""} ${issue ? `has-${issue.severity}` : ""}`;
  const title = issue ? issue.messages.join("\n") : spec.help;
  const listId = useId();
  const [draft, setDraft] = useState<string | null>(null);

  if (k === "enum" || k === "intenum") {
    const opts: Array<[Json, string]> = k === "enum"
      ? (spec.options ?? []).map((o) => [o, spec.optionLabels?.[o] ?? o])
      : (spec.intOptions ?? []).map(([v, l]) => [v, `${v} – ${l}`]);
    // hex data types: "0x2a" in a file matches the listed "0x2A"
    const same = (a: Json, b: Json) => a === b || (spec.source === "dataTypes" && typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase());
    const idx = opts.findIndex(([v]) => same(v, value));
    const known = idx >= 0;
    const empty = value === undefined || value === null || value === "";
    return (
      <select id={id} className={`${cls} sel`} title={title} disabled={disabled} value={known ? String(idx) : "__invalid"}
        onChange={(e) => {
          if (e.target.value === "__settings") {
            window.dispatchEvent(new CustomEvent("cce:open-settings", { detail: { section: spec.source ? SOURCE_INFO[spec.source].section : undefined } }));
            return;
          }
          if (e.target.value !== "__invalid") onChange(opts[+e.target.value][0]);
        }}>
        {!known && <option value="__invalid">{empty ? "— select —" : `${value} (${spec.source ? "not in Settings" : "invalid"})`}</option>}
        {opts.map(([, l], i) => <option key={i} value={String(i)}>{l}</option>)}
        {spec.source && !opts.length && <option value="__invalid" disabled>(list is empty)</option>}
        {spec.source && <option value="__settings">⚙ Edit list in Settings…</option>}
      </select>
    );
  }
  if (k === "bool") {
    return (
      <label className={`switch ${cell ? "switch-cell" : ""}`} title={title}>
        <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track"><span className="switch-thumb" /></span>
        {!cell && <span className="switch-label">{value === true ? "Enabled" : "Disabled"}</span>}
      </label>
    );
  }
  if (k === "multi") {
    const arr: Json[] = Array.isArray(value) ? value : [];
    const unknown = arr.filter((v) => !spec.options?.includes(v));
    return (
      <div id={id} className={`chips ${issue ? `has-${issue.severity}` : ""}`} title={title} role="group">
        {(spec.options ?? []).map((o) => {
          const on = arr.includes(o);
          return (
            <button key={o} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} disabled={disabled}
              onClick={() => onChange(on ? arr.filter((v) => v !== o) : [...(spec.options ?? []).filter((x) => arr.includes(x) || x === o), ...unknown])}>
              <span className="chip-box">{on && <Icon name="tick" size={12} strokeWidth={3} />}</span>{o}
            </button>
          );
        })}
        {spec.source && (
          <button type="button" className="chip chip-edit" title="Edit this list in Settings"
            onClick={() => window.dispatchEvent(new CustomEvent("cce:open-settings", { detail: { section: SOURCE_INFO[spec.source!].section } }))}>
            <Icon name="gear" size={13} />Edit list…
          </button>
        )}
      </div>
    );
  }
  // free text / numeric: keep a local draft while typing so formatting (e.g. 0x..) never jumps
  const shown = draft ?? displayValue(spec, value);
  return (
    <>
      <input id={id} className={cls} title={title} disabled={disabled} value={shown} spellCheck={false}
        placeholder={spec.placeholder ?? (spec.hex ? "decimal or 0x-hex" : "")}
        list={spec.suggestions ? listId : undefined} autoComplete="off"
        inputMode={k === "int" || k === "float" ? "decimal" : undefined}
        onFocus={() => setDraft(displayValue(spec, value))}
        onChange={(e) => { setDraft(e.target.value); onChange(coerceValue(spec, e.target.value)); }}
        onBlur={() => setDraft(null)} />
      {spec.suggestions && <datalist id={listId}>{spec.suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </>
  );
}

// --------------------------------------------------------------------------
// Form
// --------------------------------------------------------------------------
export function FieldForm({ nodeId, fields, params, issues, onChange, showHelp = true, disabled = false }: {
  nodeId: string; fields: FieldSpec[]; params: Json; issues: Issue[];
  onChange: (spec: FieldSpec, value: Json) => void; showHelp?: boolean; disabled?: boolean;
}) {
  return (
    <div className={`form-grid ${showHelp ? "" : "form-grid-tight"}`}>
      {fields.map((spec) => {
        const iss = worst(issues.filter((i) => i.field === spec.key && i.table === undefined));
        const id = `f-${nodeId}-${spec.key}`;
        return (
          <div key={spec.key} className={`form-row ${kindOf(spec) === "multi" || kindOf(spec) === "bool" ? "form-row-wide" : ""}`}>
            <label htmlFor={id} className="form-label">
              {spec.label}{isRequired(spec) && <span className="req" aria-label="required">*</span>}
            </label>
            <FieldInput spec={spec} value={getPath(params, spec.key)} issue={iss} id={id} onChange={(v) => onChange(spec, v)} disabled={disabled} />
            {(iss || showHelp) && (
              <div className={`form-msg ${iss ? `msg-${iss.severity}` : ""}`}>
                {iss ? <><Icon name={iss.severity === "error" ? "error" : "alert"} size={13} />{iss.messages[0]}</> : spec.help}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------------
// Data table
// --------------------------------------------------------------------------
export interface TableProps {
  spec: TableSpec;
  rows: Json[] | null | undefined;
  tableId: string;                       // issue table id
  issues: Issue[];
  /** apply a mutation to the row array (create=true creates the array when missing) */
  onRows: (fn: (rows: Json[]) => void, opts?: { key?: string; create?: boolean }) => void;
  selected?: number;
  onSelect?: (row: number) => void;
  extraActions?: React.ReactNode;
  emptyHint?: string;
  hideTitle?: boolean;
  disabled?: boolean;
  disabledHint?: string;
}

export function DataTable({ spec, rows, tableId, issues, onRows, selected = -1, onSelect, extraActions, emptyHint, hideTitle, disabled, disabledHint }: TableProps) {
  const list = Array.isArray(rows) ? rows : [];
  const mine = useMemo(() => issues.filter((i) => i.table === tableId), [issues, tableId]);
  const [localSel, setLocalSel] = useState(-1);
  const sel = onSelect ? selected : localSel;
  const select = (r: number) => (onSelect ? onSelect(r) : setLocalSel(r));
  useEffect(() => { if (sel >= list.length) select(list.length - 1); }); // keep selection in range
  const gridCols = spec.primary ? spec.columns.filter((c) => spec.primary!.includes(c.key)) : spec.columns;
  const drawerCols = spec.primary ? spec.columns.filter((c) => !spec.primary!.includes(c.key)) : [];
  useEffect(() => { if (drawerCols.length && sel < 0 && list.length) select(0); }); // drawer always shows a row
  useEffect(() => { // problem navigation / Details pane may ask for a row
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { tableId: string; row: number };
      if (d.tableId === tableId && d.row !== sel) select(d.row);
    };
    window.addEventListener("cce:select-row", on);
    return () => window.removeEventListener("cce:select-row", on);
  });

  const cellIssue = (r: number, key: string) => worst(mine.filter((i) => i.row === r && (i.column === key || i.column === undefined)));
  const rowSev = (r: number) => worst(mine.filter((i) => i.row === r))?.severity;
  const tableLevel = mine.filter((i) => i.row === undefined);

  const add = () => { onRows((rs) => { rs.push(newRow(spec, rs)); }, { create: true }); select(list.length); };
  const remove = () => { if (sel < 0) return; onRows((rs) => { rs.splice(sel, 1); }); select(Math.min(sel, list.length - 2)); };
  const dup = () => { if (sel < 0) return; onRows((rs) => { rs.splice(sel + 1, 0, JSON.parse(JSON.stringify(rs[sel]))); }); select(sel + 1); };
  const move = (d: number) => {
    if (sel < 0 || sel + d < 0 || sel + d >= list.length) return;
    onRows((rs) => { const t = rs[sel]; rs[sel] = rs[sel + d]; rs[sel + d] = t; });
    select(sel + d);
  };

  return (
    <div className={`table-card ${disabled ? "is-disabled" : ""}`}>
      <div className="table-bar">
        {!hideTitle && <h4 className="table-title">{spec.icon && <NodeIcon name={spec.icon as IconName} size={16} />}{spec.title}<span className="count">{list.length}</span></h4>}
        {hideTitle && spec.help && <span className="muted small">{spec.help}</span>}
        <span className="spacer" />
        {extraActions}
        <button className="btn btn-sm btn-primary" onClick={add} disabled={disabled}><Icon name="plus" size={14} />{spec.addLabel}</button>
        <div className="btn-group">
          <button className="btn btn-sm" onClick={remove} disabled={disabled || sel < 0} title="Remove selected row"><Icon name="trash" size={14} />Remove</button>
          <button className="btn btn-sm" onClick={dup} disabled={disabled || sel < 0} title="Duplicate selected row"><Icon name="copy" size={14} /></button>
          <button className="btn btn-sm" onClick={() => move(-1)} disabled={disabled || sel <= 0} title="Move up"><Icon name="arrowUp" size={14} /></button>
          <button className="btn btn-sm" onClick={() => move(1)} disabled={disabled || sel < 0 || sel >= list.length - 1} title="Move down"><Icon name="arrowDown" size={14} /></button>
        </div>
      </div>
      {tableLevel.map((i, n) => <div key={n} className={`inline-msg msg-${i.severity}`}><Icon name="alert" size={13} />{i.message}</div>)}
      <div className={drawerCols.length ? "table-split" : ""}>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="rownum">#</th>
              {gridCols.map((c) => (
                <th key={c.key} style={{ minWidth: c.width ?? 90 }} title={c.help ?? c.label}>
                  {c.label}{isRequired(c) && c.kind !== "bool" && <span className="req">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((row, r) => (
              <tr key={r} className={r === sel ? "selected" : ""} onMouseDown={() => r !== sel && select(r)}>
                <td className={`rownum ${rowSev(r) ? `row-${rowSev(r)}` : ""}`}>{r + 1}</td>
                {gridCols.map((c) => (
                  <td key={c.key} className={kindOf(c) === "bool" ? "center" : ""}>
                    <FieldInput cell spec={c} id={`c-${tableId}-${r}-${c.key}`} disabled={disabled || !row || typeof row !== "object"}
                      value={row?.[c.key]} issue={cellIssue(r, c.key)}
                      onChange={(v) => onRows((rs) => { rs[r][c.key] = v; }, { key: `${tableId}:${r}:${c.key}` })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && (
          <div className="table-empty">
            {disabled ? disabledHint : <>{emptyHint ?? `No ${spec.itemName.toLowerCase()}s yet.`} <button className="link" onClick={add}>{spec.addLabel}</button></>}
          </div>
        )}
      </div>
      {drawerCols.length > 0 && (
        <div className="row-drawer" aria-label="More settings for the selected row">
          {sel >= 0 && list[sel] && typeof list[sel] === "object" ? (<>
            <div className="drawer-head">{spec.itemName} {sel + 1}<span className="muted"> · more settings</span></div>
            {drawerCols.map((c) => {
              const iss = cellIssue(sel, c.key);
              return (
                <div key={c.key} className="drawer-row">
                  <label htmlFor={`c-${tableId}-${sel}-${c.key}`}>{c.label}{isRequired(c) && c.kind !== "bool" && <span className="req">*</span>}</label>
                  <FieldInput spec={c} id={`c-${tableId}-${sel}-${c.key}`} disabled={disabled} value={list[sel]?.[c.key]} issue={iss}
                    onChange={(v) => onRows((rs) => { rs[sel][c.key] = v; }, { key: `${tableId}:${sel}:${c.key}` })} />
                  {iss && <div className={`form-msg msg-${iss.severity}`}><Icon name={iss.severity === "error" ? "error" : "alert"} size={12} />{iss.messages[0]}</div>}
                </div>
              );
            })}
          </>) : <div className="muted small drawer-empty">Select a row to see its other settings.</div>}
        </div>
      )}
      </div>
    </div>
  );
}

/** Helper for editors: apply `fn` to the array at `path` inside `params` (immer draft). */
export function rowsRecipe(path: (string | number)[], fn: (rows: Json[]) => void, create: boolean) {
  return (params: Json) => {
    let cur = params;
    for (let i = 0; i < path.length; i++) {
      const k = path[i];
      if (cur[k] === undefined || cur[k] === null) {
        if (!create) return;
        cur[k] = i === path.length - 1 ? [] : {};
      }
      cur = cur[k];
    }
    if (Array.isArray(cur)) fn(cur);
  };
}

