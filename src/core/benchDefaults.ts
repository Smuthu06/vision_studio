/**
 * FPGA board defaults and debayer configurations – structured entries of ui_config.json,
 * edited in File › Settings and referenced by name from tester configurations
 * (Camera Model › FPGA Board Defaults, Virtual Channel › Debayer Configuration).
 *
 * The fields and their value lists follow the LabVIEW "FPGA Defaults" / "Debayer Settings"
 * dialogs and the [Debayer Settings] documentation (inputFormat, outputFormat,
 * conversionParams, deviceList, Image_Type).
 */
import type { Json } from "./schema";

// ---------------------------------------------------------------------------- FPGA board defaults
export interface RoutingSignal { source: string; destination: string }
export interface BoardDefaults {
  boardName: string;
  description?: string;
  siReferenceClockHz: number;    // SI Reference Clock Frequency (Hz)
  soReferenceClockHz: number;    // SO Reference Clock Frequency (Hz)
  framesOnDma: number;           // # of Frames On DMA
  frameSyncWindow: number;       // Frame Sync Window (# of Frames)
  frameSyncToleranceUs: number;  // Frame Sync Tolerance (us)
  llpFifoDepth: number;          // LLP FIFO Depth
  routingSignals: RoutingSignal[];
}

/** Suggestions for routing sources / destinations (free text is allowed). */
export const ROUTING_SOURCES = [...Array.from({ length: 8 }, (_, i) => `PXI_Trig${i}`), "PXI_Star", "PXIe_DStarA", "PXIe_DStarB"];
export const ROUTING_DESTINATIONS = ["Start_Trig", "BackPlane_CAM_Trig", ...Array.from({ length: 8 }, (_, i) => `PXI_Trig${i}`)];

export const defaultBoard = (boardName = "board1"): BoardDefaults => ({
  boardName,
  siReferenceClockHz: 25_000_000,
  soReferenceClockHz: 25_000_000,
  framesOnDma: 20,
  frameSyncWindow: 30,
  frameSyncToleranceUs: 650,
  llpFifoDepth: 200_000_000,
  routingSignals: [
    { source: "PXI_Trig1", destination: "Start_Trig" },
    { source: "PXI_Trig4", destination: "BackPlane_CAM_Trig" },
  ],
});

/** Numeric board fields: label, unit, integer?, minimum. */
export const BOARD_FIELDS: Array<{ key: keyof BoardDefaults; label: string; int: boolean; min: number; help: string }> = [
  { key: "siReferenceClockHz", label: "SI Reference Clock Frequency (Hz)", int: false, min: 1, help: "Reference clock of the deserializer inputs, e.g. 2.5E+7 (25 MHz)" },
  { key: "soReferenceClockHz", label: "SO Reference Clock Frequency (Hz)", int: false, min: 1, help: "Reference clock of the serializer outputs, e.g. 2.5E+7 (25 MHz)" },
  { key: "framesOnDma", label: "# of Frames On DMA", int: true, min: 1, help: "Frames buffered in the DMA FIFO" },
  { key: "frameSyncWindow", label: "Frame Sync Window (# of Frames)", int: true, min: 1, help: "Number of frames over which the channels are synchronised" },
  { key: "frameSyncToleranceUs", label: "Frame Sync Tolerance (us)", int: true, min: 0, help: "Allowed time difference between synchronised frames, in microseconds" },
  { key: "llpFifoDepth", label: "LLP FIFO Depth", int: true, min: 1, help: "Depth of the LLP packet FIFO (elements)" },
];

// ---------------------------------------------------------------------------- debayer configurations
export const IMAGE_FORMATS = ["IMAGE_FORMAT_RAW", "IMAGE_FORMAT_RGB", "IMAGE_FORMAT_YUV"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];
export const DATA_SIZES = [1, 2, 4] as const;

const BAYER = ["RAWIO_BAYER_MASK_BGGR", "RAWIO_BAYER_MASK_GBRG", "RAWIO_BAYER_MASK_GRBG", "RAWIO_BAYER_MASK_RGGB"];
const YUV = ["YUV_FORMAT_420_NV12", "YUV_FORMAT_422_NV16", "YUV_FORMAT_422_UYVY", "YUV_FORMAT_422_YUYV"];
/** Format_Parameter_1 per image format, as documented for [inputFormat] and [outputFormat]. */
export const FORMAT_PARAMETERS: Record<"input" | "output", Record<ImageFormat, string[]>> = {
  input: {
    IMAGE_FORMAT_RAW: BAYER,
    IMAGE_FORMAT_RGB: [
      "RGB_CHANNEL_ORDER_BGR (without alpha)", "RGB_CHANNEL_ORDER_RGBA (alpha last)", "RGB_CHANNEL_ORDER_ARGB (alpha first)",
      "RGB_CHANNEL_ORDER_BGRA", "RGB_CHANNEL_ORDER_BRG (without alpha)", "RGB_CHANNEL_ORDER_GBR (without alpha)",
      "RGB_CHANNEL_ORDER_GRB (without alpha)", "RGB_CHANNEL_ORDER_RBG (without alpha)", "RGB_CHANNEL_ORDER_RGB (without alpha)",
    ],
    IMAGE_FORMAT_YUV: YUV,
  },
  output: {
    IMAGE_FORMAT_RAW: BAYER,
    IMAGE_FORMAT_RGB: [
      "RGB_CHANNEL_ORDER_RGB (without alpha)", "RGB_CHANNEL_ORDER_RGBA (alpha last)", "RGB_CHANNEL_ORDER_ARGB (alpha first)",
      "RGB_CHANNEL_ORDER_BGRA",
    ],
    IMAGE_FORMAT_YUV: YUV,
  },
};
export const CONVERSION_PARAMETERS = ["BT601_FULL_RANGE", "BT601_REDUCED_RANGE", "BT709_FULL_RANGE", "BT709_REDUCED_RANGE"];
export const DEVICE_TYPES = ["DEVICE_TYPE_GPU", "DEVICE_TYPE_CPU"];
export const IMAGE_TYPES = ["Grayscale (U8)", "Grayscale (I16)", "Grayscale (SGL)", "Complex (CSG)", "RGB (U32)", "HSL (U32)", "RGB (U64)", "Grayscale (U16)"];

export interface PixelFormat {
  dataSize: number;            // bytes per image array element: RAW 1/2/4, YUV 1, RGB 1
  bitDepthPerChannel: number;  // bits holding the intensity; ≤ dataSize × 8
  useBigEndian: number;        // 0 = little endian, 1 = big endian
  imageFormat: ImageFormat;
  formatParameter: number;     // Format_Parameter_1 – meaning depends on imageFormat
}
export interface DebayerConfig {
  name: string;
  description?: string;
  imageWidth: number;
  imageHeight: number;
  inputFormat: PixelFormat;
  outputFormat: PixelFormat;
  conversionParameter: number; // Conv_Param_1
  devicePreferred: string;     // deviceList.preferred
  deviceAlternative: string;   // deviceList.alternative
  imageType: number;           // IMAQ image type
}

export const defaultDebayer = (name = "RAW_RGGB_to_RGB"): DebayerConfig => ({
  name,
  imageWidth: 1632,
  imageHeight: 1290,
  inputFormat: { dataSize: 2, bitDepthPerChannel: 12, useBigEndian: 1, imageFormat: "IMAGE_FORMAT_RAW", formatParameter: 3 },
  outputFormat: { dataSize: 1, bitDepthPerChannel: 8, useBigEndian: 0, imageFormat: "IMAGE_FORMAT_RGB", formatParameter: 3 },
  conversionParameter: 0,
  devicePreferred: "DEVICE_TYPE_GPU",
  deviceAlternative: "DEVICE_TYPE_CPU",
  imageType: 4,
});

/** The documentation's example: YUV 4:2:2 YUYV in, RGB out. */
export const yuvDebayer = (): DebayerConfig => ({
  ...defaultDebayer("YUV422_YUYV_to_RGB"),
  imageWidth: 1920, imageHeight: 1080,
  inputFormat: { dataSize: 1, bitDepthPerChannel: 8, useBigEndian: 0, imageFormat: "IMAGE_FORMAT_YUV", formatParameter: 3 },
  outputFormat: { dataSize: 1, bitDepthPerChannel: 8, useBigEndian: 0, imageFormat: "IMAGE_FORMAT_RGB", formatParameter: 3 },
});

const short = (f: ImageFormat) => f.replace("IMAGE_FORMAT_", "");
const paramShort = (side: "input" | "output", p: PixelFormat) =>
  (FORMAT_PARAMETERS[side][p.imageFormat]?.[p.formatParameter] ?? String(p.formatParameter))
    .replace(/^(RAWIO_BAYER_MASK_|RGB_CHANNEL_ORDER_|YUV_FORMAT_)/, "").replace(/ \(.*\)$/, "");

/** One-line summary for dropdowns, e.g. "1632×1290 RAW RGGB → RGB RGB". */
export const debayerSummary = (d: DebayerConfig) =>
  `${d.imageWidth}×${d.imageHeight} ${short(d.inputFormat.imageFormat)} ${paramShort("input", d.inputFormat)} → ${short(d.outputFormat.imageFormat)} ${paramShort("output", d.outputFormat)}`;
export const boardSummary = (b: BoardDefaults) =>
  `SI ${b.siReferenceClockHz / 1e6} MHz · ${b.framesOnDma} frames on DMA · ${b.routingSignals.length} route(s)`;

// ---------------------------------------------------------------------------- checks
/** Problems of one pixel format, keyed by field name (doc rules: data size per format, bit depth ≤ data size × 8). */
export function pixelFormatProblems(f: PixelFormat, side: "input" | "output"): Array<{ field: keyof PixelFormat; message: string; severity: "error" | "warning" }> {
  const out: Array<{ field: keyof PixelFormat; message: string; severity: "error" | "warning" }> = [];
  if (!(DATA_SIZES as readonly number[]).includes(f.dataSize)) out.push({ field: "dataSize", severity: "error", message: "Data size must be 1, 2 or 4 bytes" });
  else if (f.imageFormat !== "IMAGE_FORMAT_RAW" && f.dataSize !== 1)
    out.push({ field: "dataSize", severity: "warning", message: `${short(f.imageFormat)} data is documented as uint8 (data size 1)` });
  if (!Number.isInteger(f.bitDepthPerChannel) || f.bitDepthPerChannel < 1 || f.bitDepthPerChannel > 32)
    out.push({ field: "bitDepthPerChannel", severity: "error", message: "Bit depth per channel must be 1–32" });
  else if (f.bitDepthPerChannel > f.dataSize * 8)
    out.push({ field: "bitDepthPerChannel", severity: "error", message: `Bit depth ${f.bitDepthPerChannel} does not fit in ${f.dataSize} byte(s) (max ${f.dataSize * 8})` });
  if (f.useBigEndian !== 0 && f.useBigEndian !== 1) out.push({ field: "useBigEndian", severity: "error", message: "Byte order must be 0 (little endian) or 1 (big endian)" });
  if (!(IMAGE_FORMATS as readonly string[]).includes(f.imageFormat)) out.push({ field: "imageFormat", severity: "error", message: "Unknown image format" });
  else if (!Number.isInteger(f.formatParameter) || f.formatParameter < 0 || f.formatParameter >= FORMAT_PARAMETERS[side][f.imageFormat].length)
    out.push({ field: "formatParameter", severity: "error", message: `Format parameter must be 0–${FORMAT_PARAMETERS[side][f.imageFormat].length - 1} for ${short(f.imageFormat)}` });
  return out;
}

// ---------------------------------------------------------------------------- reading ui_config.json
const num = (v: Json, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v
  : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = (v: Json, fallback: string) => (typeof v === "string" && v.trim() ? v.trim() : fallback);

function pixelFormat(raw: Json, fallback: PixelFormat): PixelFormat {
  const r = raw && typeof raw === "object" ? raw : {};
  const fmt = str(r.imageFormat, fallback.imageFormat);
  return {
    dataSize: num(r.dataSize, fallback.dataSize),
    bitDepthPerChannel: num(r.bitDepthPerChannel, fallback.bitDepthPerChannel),
    useBigEndian: num(r.useBigEndian, fallback.useBigEndian),
    imageFormat: ((IMAGE_FORMATS as readonly string[]).includes(fmt) ? fmt : fallback.imageFormat) as ImageFormat,
    formatParameter: num(r.formatParameter, fallback.formatParameter),
  };
}

/** Entries from ui_config.json. Older files had plain {value, description} options: they become entries with default values. */
export function readBoards(raw: Json, warnings: string[]): BoardDefaults[] {
  if (!Array.isArray(raw)) { warnings.push("boardDefaults: expected a list – using defaults"); return [defaultBoard()]; }
  const out: BoardDefaults[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    const name = str(e?.boardName ?? e?.value ?? e, "");
    if (!name || seen.has(name.toLowerCase())) { warnings.push(`boardDefaults: ${name ? `duplicate board '${name}'` : "entry without a board name"} skipped`); continue; }
    seen.add(name.toLowerCase());
    const d = defaultBoard(name);
    const o = e && typeof e === "object" ? e : {};
    out.push({
      boardName: name,
      ...(typeof o.description === "string" && o.description.trim() ? { description: o.description.trim() } : {}),
      siReferenceClockHz: num(o.siReferenceClockHz, d.siReferenceClockHz),
      soReferenceClockHz: num(o.soReferenceClockHz, d.soReferenceClockHz),
      framesOnDma: num(o.framesOnDma, d.framesOnDma),
      frameSyncWindow: num(o.frameSyncWindow, d.frameSyncWindow),
      frameSyncToleranceUs: num(o.frameSyncToleranceUs, d.frameSyncToleranceUs),
      llpFifoDepth: num(o.llpFifoDepth, d.llpFifoDepth),
      routingSignals: Array.isArray(o.routingSignals)
        ? o.routingSignals.filter((r: Json) => r && typeof r === "object").map((r: Json) => ({ source: str(r.source, ""), destination: str(r.destination, "") }))
        : d.routingSignals,
    });
  }
  return out;
}

export function readDebayers(raw: Json, warnings: string[]): DebayerConfig[] {
  if (!Array.isArray(raw)) { warnings.push("debayerConfigs: expected a list – using defaults"); return [defaultDebayer(), yuvDebayer()]; }
  const out: DebayerConfig[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    const name = str(e?.name ?? e?.value ?? e, "");
    if (!name || seen.has(name.toLowerCase())) { warnings.push(`debayerConfigs: ${name ? `duplicate configuration '${name}'` : "entry without a name"} skipped`); continue; }
    seen.add(name.toLowerCase());
    const d = defaultDebayer(name);
    const o = e && typeof e === "object" ? e : {};
    out.push({
      name,
      ...(typeof o.description === "string" && o.description.trim() ? { description: o.description.trim() } : {}),
      imageWidth: num(o.imageWidth, d.imageWidth),
      imageHeight: num(o.imageHeight, d.imageHeight),
      inputFormat: pixelFormat(o.inputFormat, d.inputFormat),
      outputFormat: pixelFormat(o.outputFormat, d.outputFormat),
      conversionParameter: num(o.conversionParameter, d.conversionParameter),
      devicePreferred: str(o.devicePreferred, d.devicePreferred),
      deviceAlternative: str(o.deviceAlternative, d.deviceAlternative),
      imageType: num(o.imageType, d.imageType),
    });
  }
  return out;
}
