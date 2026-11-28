/** Context/dropdown menus, modal confirm dialog and toasts. */
import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon, NodeIcon, type UiIconName } from "./icons";
import type { IconName } from "../core/model";

// --------------------------------------------------------------------------
// Menu
// --------------------------------------------------------------------------
export type MenuItem =
  | { kind?: "item"; label: string; nodeIcon?: IconName; icon?: UiIconName; hint?: string; shortcut?: string;
      disabled?: boolean; danger?: boolean; onSelect: () => void }
  | { kind: "submenu"; label: string; icon?: UiIconName; hint?: string; items: MenuItem[]; disabled?: boolean }
  | { kind: "separator" }
  | { kind: "header"; label: string; nodeIcon?: IconName };

export interface MenuState { x: number; y: number; items: MenuItem[]; minWidth?: number }

const isActionable = (it: MenuItem) => (it.kind ?? "item") === "item" || it.kind === "submenu";

/**
 * Menu with optional submenus. A submenu opens on hover, click, Enter or →, and closes with ← or Esc.
 * `onBack` is set for submenus (return focus to the parent menu).
 */
export function Menu({ menu, onClose, onBack, rightOf }: { menu: MenuState; onClose: () => void; onBack?: () => void; rightOf?: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const actionable = menu.items.map((it, i) => (isActionable(it) && !(it as { disabled?: boolean }).disabled ? i : -1)).filter((i) => i >= 0);
  const [active, setActive] = useState<number>(actionable[0] ?? -1);
  const [sub, setSub] = useState<{ index: number; rect: DOMRect; focus: boolean } | null>(null);
  const btns = useRef<Array<HTMLButtonElement | null>>([]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = Math.max(6, Math.min(menu.x, window.innerWidth - r.width - 6));
    if (rightOf && menu.x + r.width > window.innerWidth - 6) left = Math.max(6, rightOf.left - r.width + 2); // flip to the left
    const top = menu.y + r.height > window.innerHeight - 6 ? Math.max(6, (rightOf ? rightOf.bottom : menu.y) - r.height) : menu.y;
    setPos({ left, top });
    el.focus();
  }, [menu, rightOf]);

  const openSub = (i: number, focus: boolean) => {
    const b = btns.current[i];
    if (b) setSub({ index: i, rect: b.getBoundingClientRect(), focus });
  };

  useEffect(() => {
    if (onBack) return; // the root menu handles outside clicks for the whole stack
    // submenus are portalled to <body>: a click in any open menu is "inside"
    const close = (e: Event) => { if (!(e.target as Element | null)?.closest?.(".menu")) onClose(); };
    const onResize = () => onClose();
    window.addEventListener("mousedown", close, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onResize);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onResize);
    };
  }, [onClose]);

  const choose = (i: number) => {
    const it = menu.items[i];
    if (it?.kind === "submenu") { if (!it.disabled) openSub(i, true); return; }
    if (it && (it.kind ?? "item") === "item" && !(it as { disabled?: boolean }).disabled) {
      onClose();
      (it as { onSelect: () => void }).onSelect();
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const pos = actionable.indexOf(active);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); (onBack ?? onClose)(); }
    else if (e.key === "ArrowLeft" && onBack) { e.preventDefault(); e.stopPropagation(); onBack(); }
    else if (e.key === "ArrowRight" && menu.items[active]?.kind === "submenu") { e.preventDefault(); openSub(active, true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(actionable[(pos + 1) % actionable.length]); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(actionable[(pos - 1 + actionable.length) % actionable.length]); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
    else if (e.key === "Tab") { e.preventDefault(); onClose(); }
  };

  return (
    <div ref={ref} className="menu" role="menu" tabIndex={-1} style={{ left: pos.left, top: pos.top, minWidth: menu.minWidth }}
      onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) => {
        if (it.kind === "separator") return <div key={i} className="menu-sep" />;
        if (it.kind === "header") return (
          <div key={i} className="menu-header">{it.nodeIcon && <NodeIcon name={it.nodeIcon} size={16} />}<span>{it.label}</span></div>
        );
        if (it.kind === "submenu") return (
          <button key={i} ref={(b) => { btns.current[i] = b; }} role="menuitem" aria-haspopup="menu" aria-expanded={sub?.index === i}
            className={`menu-item ${i === active ? "active" : ""} ${sub?.index === i ? "open" : ""}`} disabled={it.disabled}
            onMouseEnter={() => { if (!it.disabled) { setActive(i); openSub(i, false); } }} onClick={() => choose(i)}>
            <span className="menu-icon">{it.icon ? <Icon name={it.icon} /> : null}</span>
            <span className="menu-text">
              <span className="menu-label">{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
            </span>
            <Icon name="chevronRight" size={13} className="menu-sub-arrow" />
          </button>
        );
        return (
          <button key={i} role="menuitem" className={`menu-item ${i === active ? "active" : ""} ${it.danger ? "danger" : ""}`}
            disabled={it.disabled} onMouseEnter={() => { if (!it.disabled) { setActive(i); setSub(null); } }} onClick={() => choose(i)}>
            <span className="menu-icon">{it.nodeIcon ? <NodeIcon name={it.nodeIcon} size={16} /> : it.icon ? <Icon name={it.icon} /> : null}</span>
            <span className="menu-text">
              <span className="menu-label">{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
            </span>
            {it.shortcut && <kbd className="menu-kbd">{it.shortcut}</kbd>}
          </button>
        );
      })}
      {sub && menu.items[sub.index]?.kind === "submenu" && createPortal(
        <Menu key={sub.index} menu={{ x: sub.rect.right - 2, y: sub.rect.top - 5, items: (menu.items[sub.index] as { items: MenuItem[] }).items, minWidth: 200 }}
          rightOf={sub.rect} onClose={onClose} onBack={() => { setSub(null); ref.current?.focus(); }} />, document.body,
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Dialog + toasts (context so any component can use them)
// --------------------------------------------------------------------------
export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  extraLabel?: string;       // third button (e.g. "Don't save")
  danger?: boolean;
}
type ConfirmResult = "confirm" | "extra" | "cancel";
interface Toast { id: number; text: string; kind: "info" | "success" | "error" }

interface OverlayApi {
  confirm: (o: ConfirmOptions) => Promise<ConfirmResult>;
  toast: (text: string, kind?: Toast["kind"]) => void;
}
const Ctx = createContext<OverlayApi>({ confirm: async () => "cancel", toast: () => undefined });
export const useOverlay = () => useContext(Ctx);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (r: ConfirmResult) => void }) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<ConfirmResult>((resolve) => setDialog({ ...o, resolve })), []);
  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 2600);
  }, []);
  const finish = (r: ConfirmResult) => { dialog?.resolve(r); setDialog(null); };

  return (
    <Ctx.Provider value={{ confirm, toast }}>
      {children}
      {dialog && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && finish("cancel")}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={dialog.title}
            onKeyDown={(e) => { if (e.key === "Escape") finish("cancel"); }}>
            <h3>{dialog.title}</h3>
            <div className="modal-body">{dialog.message}</div>
            <div className="modal-actions">
              {dialog.extraLabel && <button className="btn" onClick={() => finish("extra")}>{dialog.extraLabel}</button>}
              <span className="spacer" />
              <button className="btn" onClick={() => finish("cancel")}>{dialog.cancelLabel ?? "Cancel"}</button>
              <button className={`btn ${dialog.danger ? "btn-danger" : "btn-primary"}`} autoFocus onClick={() => finish("confirm")}>
                {dialog.confirmLabel ?? "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={t.kind === "error" ? "error" : t.kind === "success" ? "check" : "info"} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
