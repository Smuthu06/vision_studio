/**
 * Vector icons (inline SVG, no assets).
 * Node icons: flat, classic tree-view style drawn on a 16×16 grid (crisp at 16 px, scales cleanly).
 * UI icons: line icons using currentColor.
 */
import { useId, type ReactNode } from "react";
import type { IconName } from "../core/model";
import type { Severity } from "../core/schema";

type Id = (s: string) => string;
interface Art { defs?: (id: Id) => ReactNode; body: (id: Id) => ReactNode }

const lg = (id: string, c0: string, c1: string, horizontal = false) => (
  <linearGradient id={id} x1="0" y1="0" x2={horizontal ? "1" : "0"} y2={horizontal ? "0" : "1"}>
    <stop offset="0" stopColor={c0} />
    <stop offset="1" stopColor={c1} />
  </linearGradient>
);

/* Sync arrows (mode) */
const syncArrows = (c1: string, c2: string) => (<>
  <path d="M13.2 6.2A5.5 5.5 0 0 0 3.4 4.6" fill="none" stroke={c1} strokeWidth="1.9" strokeLinecap="round" />
  <path d="M1.6 2.4 L3.2 6.6 L6.9 4.2 Z" fill={c1} />
  <path d="M2.8 9.8A5.5 5.5 0 0 0 12.6 11.4" fill="none" style={{ stroke: c2 }} strokeWidth="1.9" strokeLinecap="round" />
  <path d="M14.4 13.6 L12.8 9.4 L9.1 11.8 Z" style={{ fill: c2 }} />
</>);

/* Green video camera */
const videoCam = (id: Id, dx = 0, dy = 0, faded = false) => (
  <g transform={`translate(${dx},${dy})`} opacity={faded ? 0.5 : 1}>
    <rect x="0.5" y="4.5" width="10" height="8" rx="1.5" fill={`url(#${id("cam")})`} stroke="#1d5e1d" />
    <path d="M10.5 7.2 L15.5 4.6 V12.4 L10.5 9.8 Z" fill="#3c9f3c" stroke="#1d5e1d" strokeLinejoin="round" />
    <circle cx="3.3" cy="7.3" r="1.1" fill="#d9f5d9" />
    <rect x="2" y="10" width="6" height="1" rx="0.5" fill="#1d5e1d" opacity="0.35" />
  </g>
);
const camDefs = (id: Id) => lg(id("cam"), "#7bd67b", "#2f962f");

/* Blue IC / board chip */
const blueChip = (id: Id) => (<>
  {[4.5, 7, 9.5, 12].map((c) => (
    <g key={c} fill="#9aa7b5">
      <rect x={c - 0.6} y="0.6" width="1.2" height="2.4" /><rect x={c - 0.6} y="13" width="1.2" height="2.4" />
      <rect x="0.6" y={c - 0.6} width="2.4" height="1.2" /><rect x="13" y={c - 0.6} width="2.4" height="1.2" />
    </g>))}
  <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill={`url(#${id("chip")})`} stroke="#164a8c" />
  <rect x="5" y="5" width="6" height="6" rx="0.6" fill="none" stroke="#fff" strokeWidth="1.2" />
</>);

const ART: Record<IconName, Art> = {
  /* Blue monitor */
  project: {
    defs: (id) => (<>{lg(id("scr"), "#5db4ff", "#1563c4")}{lg(id("bez"), "#f4f7fa", "#c9d2dc")}</>),
    body: (id) => (<>
      <rect x="3.5" y="13" width="9" height="2.2" rx="0.6" fill="#6b7787" />
      <rect x="6.5" y="11" width="3" height="2.5" fill="#8a96a6" />
      <rect x="0.5" y="1.5" width="15" height="10" rx="1.2" fill={`url(#${id("bez")})`} stroke="#4a5a70" />
      <rect x="2" y="3" width="12" height="7" fill={`url(#${id("scr")})`} />
      <path d="M2 3 H9 L5 10 H2 Z" fill="#fff" opacity="0.22" />
    </>),
  },
  modes: {
    body: () => (<>
      <rect x="0.5" y="0.5" width="15" height="15" rx="2.5" fill="#eef3fa" stroke="#9fb0c6" />
      <g transform="translate(1.6,1.6) scale(0.8)">{syncArrows("#1f5fae", "#1f5fae")}</g>
    </>),
  },
  mode: { body: () => syncArrows("#1f5fae", "var(--icon-ink, #3a4a5e)") },
  camera: { defs: camDefs, body: (id) => videoCam(id) },
  cameras: { defs: camDefs, body: (id) => (<>{videoCam(id, 0, -3.2, true)}{videoCam(id, 0, 1)}</>) },
  /* Green circuit board */
  hardware: {
    defs: (id) => lg(id("pcb"), "#6cc46f", "#2f8a34"),
    body: (id) => (<>
      <rect x="0.5" y="1.5" width="15" height="13" rx="1.5" fill={`url(#${id("pcb")})`} stroke="#1f5e23" />
      <path d="M2.5 5 H5 M2.5 8 H5 M2.5 11 H5 M11 5 H13.5 M11 8 H13.5 M11 11 H13.5" stroke="#e8c45a" strokeWidth="1.1" />
      <rect x="5" y="4" width="6" height="8" rx="0.8" fill="#263238" />
      <circle cx="6.3" cy="5.3" r="0.6" fill="#90a4ae" />
    </>),
  },
  chip: { defs: (id) => lg(id("chip"), "#4f97ea", "#1c5fb8"), body: (id) => blueChip(id) },
  /* Landscape picture */
  film: {
    defs: (id) => (<>{lg(id("sky"), "#7cc8ff", "#d9f0ff")}{lg(id("hill"), "#7bcf5c", "#3d9a2e")}</>),
    body: (id) => (<>
      <rect x="0.5" y="2.5" width="15" height="11" rx="1" fill="#fff" stroke="#5f6f84" />
      <rect x="2" y="4" width="12" height="8" fill={`url(#${id("sky")})`} />
      <circle cx="11.3" cy="6.3" r="1.4" fill="#ffd23f" />
      <path d="M2 12 L2 9.6 Q5 6.4 8 9.4 Q10.3 7.6 14 10.2 L14 12 Z" fill={`url(#${id("hill")})`} />
    </>),
  },
  /* Orange film frame (virtual channel) */
  vc: {
    defs: (id) => lg(id("fr"), "#ffc04d", "#e98b00", true),
    body: (id) => (<>
      <rect x="3" y="0.5" width="10" height="15" rx="1" fill={`url(#${id("fr")})`} stroke="#9a5600" />
      {[2, 5, 8, 11, 13.6].map((y) => (<g key={y} fill="#fff4dc">
        <rect x="4" y={y - 0.6} width="1.3" height="1.3" /><rect x="10.7" y={y - 0.6} width="1.3" height="1.3" /></g>))}
      <rect x="6.2" y="2" width="3.6" height="5" fill="#fff0c2" stroke="#b86d00" strokeWidth="0.6" />
      <rect x="6.2" y="9" width="3.6" height="5" fill="#fff0c2" stroke="#b86d00" strokeWidth="0.6" />
    </>),
  },
  /* Yellow lightning bolt */
  fault: {
    defs: (id) => lg(id("bolt"), "#ffe85c", "#f5a000"),
    body: (id) => (
      <path d="M9.6 0.5 L2.5 9.2 H7 L5.2 15.5 L13.5 6 H9 L11.8 0.5 Z" fill={`url(#${id("bolt")})`} stroke="#9a6200" strokeLinejoin="round" />
    ),
  },
  /* Telemetry gauge */
  gauge: {
    body: () => (<>
      <path d="M0.8 12.5 A7.2 7.2 0 0 1 15.2 12.5 Z" fill="#f3f6f9" stroke="#4a5a70" strokeLinejoin="round" />
      <path d="M2.8 12 A5.2 5.2 0 0 1 5.4 7.5" fill="none" stroke="#43a047" strokeWidth="1.7" />
      <path d="M5.4 7.5 A5.2 5.2 0 0 1 10.6 7.5" fill="none" stroke="#fbc02d" strokeWidth="1.7" />
      <path d="M10.6 7.5 A5.2 5.2 0 0 1 13.2 12" fill="none" stroke="#e53935" strokeWidth="1.7" />
      <path d="M8 12 L11.4 8.2" stroke="#263238" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="12" r="1.3" fill="#263238" />
    </>),
  },
  /* GPIO connector header */
  gpio: {
    body: () => (<>
      <rect x="0.5" y="4.5" width="15" height="7" rx="1" fill="#3b4650" stroke="#1c2329" />
      {[2.6, 5.6, 8.6, 11.6].map((x) => (<g key={x} fill="#e8c45a">
        <rect x={x} y="5.8" width="1.6" height="1.6" /><rect x={x} y="8.6" width="1.6" height="1.6" /></g>))}
      <path d="M3.4 4.5 V1.5 M6.4 4.5 V2.5 M9.4 4.5 V1.5 M12.4 4.5 V2.5" stroke="#9aa7b5" strokeWidth="1.1" />
    </>),
  },
  /* Blue image stream (film strip) */
  stream: {
    defs: (id) => lg(id("st"), "#5aa6f2", "#1f66c2"),
    body: (id) => (<>
      <rect x="0.5" y="3.5" width="15" height="9" rx="1" fill={`url(#${id("st")})`} stroke="#164a8c" />
      {[1.8, 4.6, 7.4, 10.2, 13].map((x) => (<g key={x} fill="#dcecff">
        <rect x={x} y="4.4" width="1.2" height="1" /><rect x={x} y="10.6" width="1.2" height="1" /></g>))}
      {[1.6, 6, 10.4].map((x) => <rect key={x} x={x} y="6" width="4" height="4" fill="#cfe6ff" />)}
    </>),
  },
  /* Embedded-line injection (syringe) */
  inject: {
    defs: (id) => lg(id("syr"), "#b39ddb", "#6a45b8"),
    body: (id) => (<g transform="rotate(45 8 8)">
      <rect x="5.5" y="3" width="5" height="8" rx="0.8" fill={`url(#${id("syr")})`} stroke="#3f2a7a" />
      <rect x="6.6" y="4.5" width="2.8" height="4.5" fill="#ede7f6" opacity="0.7" />
      <rect x="7.3" y="0.4" width="1.4" height="2.6" fill="#3f2a7a" />
      <rect x="5" y="0.2" width="6" height="1" rx="0.4" fill="#3f2a7a" />
      <path d="M8 11 V15.6" stroke="#5f6f84" strokeWidth="0.9" />
    </g>),
  },
  /* I2C IC (dark chip) */
  ic: {
    defs: (id) => lg(id("ic"), "#4b5862", "#222a30"),
    body: (id) => (<>
      {[4, 6.5, 9, 11.5].map((y) => (<g key={y} fill="#b8c2cc">
        <rect x="0.8" y={y - 0.6} width="2.4" height="1.2" /><rect x="12.8" y={y - 0.6} width="2.4" height="1.2" /></g>))}
      <rect x="3" y="1.5" width="10" height="13" rx="1" fill={`url(#${id("ic")})`} stroke="#11171a" />
      <path d="M6.5 1.5 A1.5 1.5 0 0 0 9.5 1.5" fill="#11171a" />
      <text x="8" y="10.4" textAnchor="middle" fontSize="4.2" fontWeight="700" fill="#cfd8dc" fontFamily="system-ui,sans-serif">I²C</text>
    </>),
  },
};

export function NodeIcon({ name, size = 16, badge }: { name: IconName; size?: number; badge?: Severity | null }) {
  const uid = useId().replace(/:/g, "");
  const id = (s: string) => `${uid}-${s}`;
  const art = ART[name];
  return (
    <svg className="node-icon" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" shapeRendering="geometricPrecision">
      {art.defs && <defs>{art.defs(id)}</defs>}
      <g transform="scale(4)">{art.body(id)}</g>
      {badge && (
        <g>
          <circle cx="50" cy="50" r="13" fill={badge === "error" ? "#E53935" : "#FFB300"} style={{ stroke: "var(--badge-ring, #fff)" }} strokeWidth="4" />
          {badge === "error"
            ? <path d="M45 45 L55 55 M45 55 L55 45" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
            : <path d="M50 43 V51.5 M50 56.5 V56.7" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" />}
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Line icons for the chrome (stroke = currentColor)
// ---------------------------------------------------------------------------
const P: Record<string, ReactNode> = {
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M12 11v6M9 14h6" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  save: <><path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M7 3v5h8V3M7 21v-7h10v7" /></>,
  saveAs: <><path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v3" /><path d="M7 3v5h8V3" /><path d="M18.5 13.5l2 2-5.5 5.5H13v-2z" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  plusCircle: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  tick: <path d="M5 12.5l4.5 4.5L19 7" />,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp: <path d="M18 15l-6-6-6 6" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  alert: <><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  code: <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  route: <><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" /></>,
  wand: <><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4" /><path d="M3 21l9-9" /></>,
  clipboard: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>,
  sample: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" /></>,
  expand: <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />,
  collapse: <path d="M7 20l5-5 5 5M7 4l5 5 5-5" />,
  restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  desktop: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  mouse: <><rect x="6" y="3" width="12" height="18" rx="6" /><path d="M12 7v4" /></>,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z" />,
};

export type UiIconName = keyof typeof P;

export function Icon({ name, size = 16, className, strokeWidth = 2 }: { name: UiIconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg className={`ui-icon ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

export function AppLogo({ size = 26 }: { size?: number }) {
  return <NodeIcon name="camera" size={size} />;
}
