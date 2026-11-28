/** File › New › Tester: choose the project configuration the tester is created for. Cancel ends the request. */
import { useState } from "react";
import type { ProjectEntry } from "../platform";
import { Icon } from "./icons";

interface Props {
  dir: string | null;            // project configuration folder (null: no folder – built-in sample only)
  files: ProjectEntry[];
  error?: string | null;
  onPick: (name: string) => void;
  onCancel: () => void;
}

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

export function PickProjectDialog({ dir, files, error, onPick, onCancel }: Props) {
  const [name, setName] = useState(files[0]?.name ?? "");
  const chosen = files.find((f) => f.name === name);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
    if (e.key === "Enter" && chosen) { e.preventDefault(); onPick(chosen.name); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal pick-project" role="dialog" aria-modal="true" aria-label="New tester configuration" onKeyDown={key}>
        <h3>New tester configuration</h3>
        <p className="muted" style={{ marginTop: 0 }}>Choose the project configuration this tester is for. Its modes and camera models fill the tester's dropdowns.</p>
        {dir && <div className="open-dir" title={dir}><Icon name="folder" size={14} /><code>{dir}</code></div>}
        {error && <div className="open-error">{error}</div>}
        {files.length ? (
          <>
            <label className="form-label" htmlFor="pick-project">Project configuration</label>
            <select id="pick-project" className="inp sel" value={name} autoFocus onChange={(e) => setName(e.target.value)}>
              {files.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
            {chosen?.modified && <div className="muted small pick-when">Saved {when(chosen.modified)}</div>}
          </>
        ) : (
          <div className="open-empty">No project configurations found. Create a project with File › New › Project and save it first.</div>
        )}
        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn" onClick={onCancel} autoFocus={!files.length}>Cancel</button>
          <button className="btn btn-primary" disabled={!chosen} onClick={() => chosen && onPick(chosen.name)}>Create tester</button>
        </div>
      </div>
    </div>
  );
}
