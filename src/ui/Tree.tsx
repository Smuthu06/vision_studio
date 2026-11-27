/** Single-column configuration tree with icons, status badges, keyboard navigation and context menus. */
import { useEffect, useMemo, useRef } from "react";
import { defOf, nodeLabel, type CNode } from "../core/model";
import type { Severity } from "../core/schema";
import { Icon, NodeIcon } from "./icons";

interface Row { node: CNode; depth: number; parent: CNode | null; hasKids: boolean; open: boolean; last: boolean[] }

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

export function Tree({ root, selectedId, collapsed, severity, ownCount, onSelect, onToggle, onContext, onDelete }: TreeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const out: Row[] = [];
    const visit = (n: CNode, depth: number, parent: CNode | null, last: boolean[]) => {
      const open = !collapsed.has(n.id);
      out.push({ node: n, depth, parent, hasKids: n.children.length > 0, open, last });
      if (open) n.children.forEach((c, i) => visit(c, depth + 1, n, [...last, i === n.children.length - 1]));
    };
    visit(root, 0, null, []);
    return out;
  }, [root, collapsed]);

  const cur = rows.findIndex((r) => r.node.id === selectedId);

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

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
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); go(cur + 1); break;
      case "ArrowUp": e.preventDefault(); go(cur - 1); break;
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

  return (
    <div ref={ref} className="tree" role="tree" tabIndex={0} aria-label="Configuration tree" onKeyDown={onKey}
      onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onContext(root, e.clientX, e.clientY); } }}>
      {rows.map((r) => {
        const sev = severity.get(r.node.id) ?? null;
        const own = ownCount.get(r.node.id);
        const sel = r.node.id === selectedId;
        return (
          <div key={r.node.id} data-id={r.node.id} role="treeitem" aria-selected={sel} aria-level={r.depth + 1}
            aria-expanded={r.hasKids ? r.open : undefined}
            className={`tree-row ${sel ? "selected" : ""}`} style={{ paddingLeft: 6 + r.depth * 18 }}
            onMouseDown={(e) => { if (e.button === 0) onSelect(r.node.id); }}
            onDoubleClick={() => r.hasKids && onToggle(r.node.id)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(r.node.id); onContext(r.node, e.clientX, e.clientY); }}
            title={defOf(r.node).title}>
            {r.depth > 0 && Array.from({ length: r.depth }, (_, d) => (
              <span key={d} className="guide" style={{ left: 6 + d * 18 + 8 }} />
            ))}
            <span className={`twisty ${r.hasKids ? "" : "none"}`}
              onMouseDown={(e) => { e.stopPropagation(); if (r.hasKids) onToggle(r.node.id); }}>
              {r.hasKids && <Icon name={r.open ? "chevronDown" : "chevronRight"} size={14} />}
            </span>
            <NodeIcon name={defOf(r.node).icon} size={16} badge={sev} />
            <span className="tree-label">{nodeLabel(r.node)}</span>
            {own && <span className={`tree-count ${own.sev === "error" ? "err" : "warn"}`} title={`${own.count} issue(s) on this node`}>{own.count}</span>}
          </div>
        );
      })}
    </div>
  );
}
