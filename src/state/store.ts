/** Application state: document + selection + undo/redo history (immer-based). */
import { produce } from "immer";
import { useCallback, useReducer } from "react";
import {
  documentFromJson, documentToJson, duplicateNode, insertChild, newDocument,
  type CNode, type ConfigDocument,
} from "../core/model";
import type { Json } from "../core/schema";

export interface AppState {
  doc: ConfigDocument;
  fileName: string | null;
  fileHandle: unknown;          // platform handle (Tauri path / web FileSystemFileHandle)
  dirty: boolean;
  selectedId: string;
  past: ConfigDocument[];
  future: ConfigDocument[];
  lastKey: string | null;       // coalesces consecutive keystrokes into one undo step
  lastTime: number;
  revision: number;             // bumps on every document change (incl. undo)
}

export type Recipe = (params: Json, node: CNode) => void;

export type Action =
  | { type: "load"; doc: ConfigDocument; fileName: string | null; handle: unknown; dirty?: boolean }
  | { type: "mutate"; id: string; recipe: Recipe; key?: string }
  | { type: "add"; parentId: string; node: CNode }
  | { type: "delete"; id: string }
  | { type: "duplicate"; id: string }
  | { type: "select"; id: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "saved"; fileName: string | null; handle: unknown };

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1200;

export function findIn(root: CNode, id: string): CNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findIn(c, id);
    if (f) return f;
  }
  return null;
}
function parentIn(root: CNode, id: string): CNode | null {
  for (const c of root.children) {
    if (c.id === id) return root;
    const f = parentIn(c, id);
    if (f) return f;
  }
  return null;
}

export function initialState(doc: ConfigDocument = newDocument()): AppState {
  return { doc, fileName: null, fileHandle: null, dirty: false, selectedId: doc.root.id, past: [], future: [],
    lastKey: null, lastTime: 0, revision: 0 };
}

function commit(state: AppState, doc: ConfigDocument, extra: Partial<AppState> = {}, key: string | null = null): AppState {
  if (doc === state.doc) return { ...state, ...extra };
  const now = Date.now();
  const coalesce = key !== null && key === state.lastKey && now - state.lastTime < COALESCE_MS;
  const past = coalesce ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT);
  return { ...state, ...extra, doc, past, future: [], dirty: true, lastKey: key, lastTime: now, revision: state.revision + 1 };
}

export function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case "load":
      return { ...initialState(a.doc), fileName: a.fileName, fileHandle: a.handle, dirty: !!a.dirty, revision: state.revision + 1 };
    case "select":
      return state.selectedId === a.id ? state : { ...state, selectedId: a.id, lastKey: null };
    case "mutate": {
      const doc = produce(state.doc, (d) => {
        const n = findIn(d.root, a.id);
        if (n) a.recipe(n.params, n);
      });
      return commit(state, doc, {}, a.key ?? null);
    }
    case "add": {
      const doc = produce(state.doc, (d) => {
        const p = findIn(d.root, a.parentId);
        if (p) insertChild(p, a.node);
      });
      return commit(state, doc, { selectedId: a.node.id });
    }
    case "delete": {
      let select = state.selectedId;
      const doc = produce(state.doc, (d) => {
        const p = parentIn(d.root, a.id);
        if (!p) return;
        const i = p.children.findIndex((c) => c.id === a.id);
        p.children.splice(i, 1);
        select = (p.children[Math.min(i, p.children.length - 1)] ?? p).id;
      });
      return commit(state, doc, { selectedId: select });
    }
    case "duplicate": {
      let select = state.selectedId;
      const doc = produce(state.doc, (d) => {
        const p = parentIn(d.root, a.id);
        const n = p && findIn(p, a.id);
        if (!p || !n) return;
        const c = duplicateNode(JSON.parse(JSON.stringify(n)), p);
        p.children.splice(p.children.indexOf(n) + 1, 0, c);
        select = c.id;
      });
      return commit(state, doc, { selectedId: select });
    }
    case "undo": {
      if (!state.past.length) return state;
      const doc = state.past[state.past.length - 1];
      return { ...state, doc, past: state.past.slice(0, -1), future: [state.doc, ...state.future], dirty: true, lastKey: null,
        selectedId: findIn(doc.root, state.selectedId) ? state.selectedId : doc.root.id, revision: state.revision + 1 };
    }
    case "redo": {
      if (!state.future.length) return state;
      const [doc, ...rest] = state.future;
      return { ...state, doc, past: [...state.past, state.doc], future: rest, dirty: true, lastKey: null,
        selectedId: findIn(doc.root, state.selectedId) ? state.selectedId : doc.root.id, revision: state.revision + 1 };
    }
    case "saved":
      return { ...state, dirty: false, fileName: a.fileName, fileHandle: a.handle, lastKey: null };
  }
}

export function useAppStore(init: () => AppState) {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const mutate = useCallback((id: string, recipe: Recipe, key?: string) => dispatch({ type: "mutate", id, recipe, key }), []);
  return { state, dispatch, mutate };
}

/** Navigate (and optionally create) a nested array inside a node's params. */
export function arrayAt(params: Json, path: (string | number)[], create: boolean): Json[] | null {
  let cur = params;
  for (let i = 0; i < path.length; i++) {
    const k = path[i];
    const last = i === path.length - 1;
    if (cur[k] === undefined || cur[k] === null) {
      if (!create) return null;
      cur[k] = last ? [] : {};
    }
    cur = cur[k];
  }
  return Array.isArray(cur) ? cur : null;
}

export const cloneDoc = (doc: ConfigDocument) => documentFromJson(documentToJson(doc));
