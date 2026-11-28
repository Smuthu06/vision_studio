/** Single-column configuration tree with icons, status badges, keyboard navigation and context menus. */
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defOf, nodeLabel, type CNode } from "../core/model";
import type { Severity } from "../core/schema";
import { Icon, NodeIcon } from "./icons";

interface Row { node: CNode; depth: number; parent: CNode | null; hasKids: boolean; open: boolean }

export interface TreeProps {
  root: CNode;
  selectedId: string;
  collapsed: Set<string>;
  severity: Map<string, Severity>;   // worst severity in subtree
  ownCount: Map<string, { count: number; sev: Severity }>; // own issues
  onSelect: (id: string) => void;
  onToggle: (id: string, open?: boolean) => void;
  onContext: (node: CNode, x: number, y: number) => void;
  onDelete: (node: CNode) => void;
}

/** Above this many visible rows only the rows in view (plus a margin) are rendered. */
export const VIRTUAL_FROM = 200;
const ROW_H = 27;     // .tree-row height (styles.css)
const OVERSCAN = 12;

interface RowHandlers {
  onSelect: (id: string) => void;
  onToggle: (id: string, open?: boolean) => void;
  onContext: (node: CNode, x: number, y: number) => void;
}

export function Tree({ root, selectedId, collapsed, severity, ownCount, onSelect, onToggle, onContext, onDelete }: TreeProps) {
  const ref = useRef<HTMLDivElement>(null);
  // the handlers change on every App render; rows reach them through a ref so memoized rows stay valid
  const handlers = useRef<RowHandlers>({ onSelect, onToggle, onContext });
  handlers.current = { onSelect, onToggle, onContext };

  const rows = useMemo(() => {
    const out: Row[] = [];
    const visit = (n: CNode, depth: number, parent: CNode | null) => {
      const open = !collapsed.has(n.id);
      out.push({ node: n, depth, parent, hasKids: n.children.length > 0, open });
      if (open) for (const c of n.children) visit(c, depth + 1, n);
    };
    visit(root, 0, null);
    return out;
  }, [root, collapsed]);

  const cur = rows.findIndex((r) => r.node.id === selectedId);
  const virtual = rows.length > VIRTUAL_FROM;

  // visible window (virtual mode): first row and number of rows
  const [view, setView] = useState({ top: 0, height: 600 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !virtual) return;
    const update = () => setView((v) => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight }));
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [virtual]);

  // keep the selected row in view
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || cur < 0) return;
    if (!virtual) { el.querySelector<HTMLElement>(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" }); return; }
    const pad = 2; // .tree padding-top
    const y = pad + cur * ROW_H;
    if (y < el.scrollTop) el.scrollTop = cur === 0 ? 0 : y;
    else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight;
    setView((v) => (v.top === el.scrollTop ? v : { top: el.scrollTop, height: el.clientHeight }));
  }, [selectedId, cur, virtual]);

  const openMenuForSelection = () => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"] .tree-label`);
    const r = el?.getBoundingClientRect();
    const row = rows[cur];
    if (row && r) onContext(row.node, r.left + 8, r.bottom + 2);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const row = rows[cur];
    if (!row) return;
    const go = (i: number) => { const t = rows[Math.max(0, Math.min(rows.length - 1, i))]; if (t) onSelect(t.node.id); };
    const page = Math.max(1, Math.floor((ref.current?.clientHeight ?? ROW_H * 10) / ROW_H) - 1);
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); go(cur + 1); break;
      case "ArrowUp": e.preventDefault(); go(cur - 1); break;
      case "PageDown": e.preventDefault(); go(cur + page); break;
      case "PageUp": e.preventDefault(); go(cur - page); break;
      case "Home": e.preventDefault(); go(0); break;
      case "End": e.preventDefault(); go(rows.length - 1); break;
      case "ArrowRight":
        e.preventDefault();
        if (row.hasKids && !row.open) onToggle(row.node.id, true);
        else if (row.hasKids) go(cur + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (row.hasKids && row.open) onToggle(row.node.id, false);
        else if (row.parent) onSelect(row.parent.id);
        break;
      case "Delete": case "Backspace":
        e.preventDefault(); onDelete(row.node); break;
      case "ContextMenu":
        e.preventDefault(); openMenuForSelection(); break;
      case "F10":
        if (e.shiftKey) { e.preventDefault(); openMenuForSelection(); }
        break;
      case "Enter":
        e.preventDefault();
        document.querySelector<HTMLElement>(".editor-scroll input, .editor-scroll select, .editor-scroll button")?.focus();
        break;
    }
  };

  let from = 0, to = rows.length;
  if (virtual) {
    from = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
    to = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);
  }
  const renderRow = (r: Row) => {
    const own = ownCount.get(r.node.id);
    return (
      <TreeRow key={r.node.id} node={r.node} depth={r.depth} hasKids={r.hasKids} open={r.open} selected={r.node.id === selectedId}
        sev={severity.get(r.node.id) ?? null} ownCount={own?.count ?? 0} ownSev={own?.sev ?? null} handlers={handlers} />
    );
  };

  return (
    <div ref={ref} className="tree" role="tree" tabIndex={0} aria-label="Configuration tree" onKeyDown={onKey} data-rows={rows.length}
      onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onContext(root, e.clientX, e.clientY); } }}>
      {virtual && <div className="tree-spacer" style={{ height: from * ROW_H }} />}
      {rows.slice(from, to).map(renderRow)}
      {virtual && <div className="tree-spacer" style={{ height: (rows.length - to) * ROW_H }} />}
    </div>
  );
}

interface TreeRowProps {
  node: CNode; depth: number; hasKids: boolean; open: boolean; selected: boolean;
  sev: Severity | null; ownCount: number; ownSev: Severity | null;
  handlers: React.MutableRefObject<RowHandlers>;
}

/** One row; re-renders only when its node (immer keeps unchanged nodes identical) or its state changes. */
const TreeRow = memo(function TreeRow({ node, depth, hasKids, open, selected, sev, ownCount, ownSev, handlers }: TreeRowProps) {
  const def = defOf(node);
  return (
    <div data-id={node.id} role="treeitem" aria-selected={selected} aria-level={depth + 1}
      aria-expanded={hasKids ? open : undefined}
      className={`tree-row ${selected ? "selected" : ""}`} style={{ paddingLeft: 6 + depth * 18 }}
      onMouseDown={(e) => { if (e.button === 0) handlers.current.onSelect(node.id); }}
      onDoubleClick={() => hasKids && handlers.current.onToggle(node.id)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); handlers.current.onSelect(node.id); handlers.current.onContext(node, e.clientX, e.clientY); }}
      title={def.title}>
      {depth > 0 && Array.from({ length: depth }, (_, d) => (
        <span key={d} className="guide" style={{ left: 6 + d * 18 + 8 }} />
      ))}
      <span className={`twisty ${hasKids ? "" : "none"}`}
        onMouseDown={(e) => { e.stopPropagation(); if (hasKids) handlers.current.onToggle(node.id); }}>
        {hasKids && <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />}
      </span>
      <NodeIcon name={def.icon} size={16} badge={sev} />
      <span className="tree-label">{nodeLabel(node)}</span>
      {ownCount > 0 && <span className={`tree-count ${ownSev === "error" ? "err" : "warn"}`} title={`${ownCount} issue(s) on this node`}>{ownCount}</span>}
    </div>
  );
});
