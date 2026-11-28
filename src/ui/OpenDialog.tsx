/** File › Open: the configurations in the project folder, plus "Browse…" for any other file. */
import { useMemo, useState } from "react";
import type { ProjectListing } from "../platform";
import { Icon } from "./icons";

interface Props {
  listing: ProjectListing;
  current: string | null;
  onOpen: (name: string) => void;
  onBrowse: () => void;
  onClose: () => void;
}

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

export function OpenDialog({ listing, current, onOpen, onBrowse, onClose }: Props) {
  const [filter, setFilter] = useState("");
  const files = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? listing.files.filter((x) => x.name.toLowerCase().includes(f)) : listing.files;
  }, [filter, listing.files]);
  const [sel, setSel] = useState<string | null>(null);
  const chosen = sel && files.some((f) => f.name === sel) ? sel : files[0]?.name ?? null;

  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    if (e.key === "Enter" && chosen) { e.preventDefault(); onOpen(chosen); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = files.findIndex((f) => f.name === chosen);
      const n = files[Math.max(0, Math.min(files.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (n) {
        setSel(n.name);
        document.getElementById(`open-row-${n.name}`)?.scrollIntoView({ block: "nearest" });
      }
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal open-dialog" role="dialog" aria-modal="true" aria-label="Open configuration" onKeyDown={key}>
        <h3>Open configuration</h3>
        <div className="open-dir" title={listing.dir}><Icon name="folder" size={14} /><code>{listing.dir}</code></div>
        {listing.error && <div className="open-error">{listing.error}</div>}
        <input className="inp open-filter" placeholder="Filter by name…" value={filter} autoFocus
          onChange={(e) => setFilter(e.target.value)} aria-label="Filter configurations" />
        <div className="open-list" role="listbox" aria-label="Configurations">
          {files.map((f) => (
            <div key={f.name} id={`open-row-${f.name}`} role="option" aria-selected={f.name === chosen}
              className={`open-row ${f.name === chosen ? "on" : ""}`}
              onClick={() => setSel(f.name)} onDoubleClick={() => onOpen(f.name)}>
              <Icon name="file" size={15} />
              <span className="open-name">{f.name}</span>
              {f.name === current && <span className="open-tag">open</span>}
              <span className="open-when">{when(f.modified)}</span>
            </div>
          ))}
          {!files.length && (
            <div className="open-empty">
              {listing.files.length ? "No configuration matches the filter." : "No configurations saved here yet. File › Save writes them to this folder."}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onBrowse} title="Open a configuration from another folder">Browse…</button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!chosen} onClick={() => chosen && onOpen(chosen)}>Open</button>
        </div>
      </div>
    </div>
  );
}
