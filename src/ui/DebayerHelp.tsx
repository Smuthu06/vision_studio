/**
 * Settings › Debayer configurations › Show help: the [Debayer Settings] documentation, section by
 * section. The section of the input being edited is highlighted, and the current values are marked
 * in the value tables.
 */
import { useEffect, useRef } from "react";
import { CONVERSION_PARAMETERS, DEVICE_TYPES, FORMAT_PARAMETERS, IMAGE_FORMATS, IMAGE_TYPES } from "../core/benchDefaults";
import type { DDebayer } from "./BenchSettings";
import { Icon } from "./icons";

export type HelpId =
  | "overview" | "size" | "imageFormat" | "formatParameter" | "dataSize" | "bitDepth" | "endian"
  | "conversion" | "devices" | "imageType";

const DRIVER_GUIDE = "https://sites.google.com/valeo.com/test-infrastructure-and-tools/projects/common/common-adtf-tools/valeo-dat-file-player-how-to-view-yuv-and-raw-frames";

/** A documented value list; `marks` labels the rows in use, e.g. [[3, "input"], [0, "output"]] (by index or value). */
function Values({ rows, marks = [] }: { rows: string[]; marks?: Array<[number | string | undefined, string]> }) {
  return (
    <table className="help-values">
      <tbody>
        {rows.map((r, i) => {
          const tags = marks.filter(([v]) => v === i || v === r).map(([, l]) => l);
          return (
            <tr key={r} className={tags.length ? "on" : ""}>
              <td className="num">{i}</td><td><code>{r}</code></td>
              <td className="cur">{tags.length ? <><Icon name="check" size={12} />{tags.join(", ")}</> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Section({ id, active, title, ini, children }: { id: HelpId; active: HelpId; title: string; ini?: string; children: React.ReactNode }) {
  return (
    <section className={`help-sec ${active === id ? "on" : ""}`} data-help-sec={id}>
      <h4>{title}{ini && <code className="help-ini">{ini}</code>}</h4>
      {children}
    </section>
  );
}

export function DebayerHelp({ d, active, onClose }: { d?: DDebayer; active: HelpId; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { // bring the section of the edited input into view
    const el = ref.current?.querySelector<HTMLElement>(`[data-help-sec="${active}"]`);
    // the panel is the offset parent (position: sticky): offsetTop is already relative to it; keep clear of the header
    if (el && ref.current) ref.current.scrollTo({ top: Math.max(0, el.offsetTop - 48), behavior: "smooth" });
  }, [active]);
  const sides = (pick: (f: DDebayer["input"]) => number | string): Array<[number | string, string]> =>
    (d ? [[pick(d.input), "input"], [pick(d.output), "output"]] : []);
  return (
    <aside className="debayer-help" ref={ref} aria-label="Debayer settings help">
      <div className="help-head">
        <Icon name="help" size={15} /><b>Debayer settings</b><span className="spacer" />
        <button className="icon-btn" onClick={onClose} title="Hide help"><Icon name="x" size={14} /></button>
      </div>

      <Section id="overview" active={active} title="What it does">
        <p>A debayer configuration describes how the image data of a virtual channel is converted: the
          camera's <b>input format</b> (for example RAW Bayer data) is converted into the <b>output format</b>{" "}
          (for example RGB) on the preferred device. It corresponds to the <code>[Debayer Settings]</code> file
          with the sections <code>[inputFormat]</code>, <code>[outputFormat]</code>, <code>[conversionParams]</code>,{" "}
          <code>[deviceList]</code> and <code>[Image_Type]</code>. Click an input to jump to its explanation.</p>
      </Section>

      <Section id="size" active={active} title="Image Width / Image Height">
        <p>Size of the image in pixels, as delivered on the virtual channel.</p>
      </Section>

      <Section id="imageFormat" active={active} title="Image Format" ini="ImageFormat">
        <p>Format of the image data, for the input and the output separately.</p>
        <Values rows={[...IMAGE_FORMATS]} marks={sides((f) => f.imageFormat)} />
      </Section>

      <Section id="formatParameter" active={active} title="Image Format Parameter" ini="Image Format Settings.Format_Parameter_1">
        <p>Its meaning depends on the image format: the Bayer mask for RAW, the channel order for RGB and the
          layout for YUV. The documentation lists different RGB channel orders for the input and the output.</p>
        {(["input", "output"] as const).map((side) => {
          const f = d?.[side];
          return (
            <div key={side} className="help-sub">
              <div className="help-subtitle">{side === "input" ? "[inputFormat]" : "[outputFormat]"}{f && <span className="muted"> – {f.imageFormat}</span>}</div>
              {(IMAGE_FORMATS).map((fmt) => (
                <details key={fmt} open={!f || f.imageFormat === fmt}>
                  <summary>If {fmt}</summary>
                  <Values rows={FORMAT_PARAMETERS[side][fmt]} marks={f && f.imageFormat === fmt ? [[f.formatParameter, side]] : []} />
                </details>
              ))}
            </div>
          );
        })}
      </Section>

      <Section id="dataSize" active={active} title="Data Size" ini="dataSize">
        <p>Number of bytes used to store a single image array element (sizeof element):</p>
        <ul>
          <li>RAW: uint8 = 1, uint16 = 2, uint32 = 4</li>
          <li>YUV: uint8 = 1</li>
          <li>RGB: uint8 = 1</li>
        </ul>
        {d && <p className="muted small">Current: input {d.input.dataSize}, output {d.output.dataSize}.</p>}
      </Section>

      <Section id="bitDepth" active={active} title="Bit Depth Per Channel" ini="bitDepthPerChannel">
        <p>Number of bits used to store the intensity value. It must fit into the data size:
          bit depth ≤ data size × 8 (for example at most 16 bits with a data size of 2).</p>
        {d && <p className="muted small">Current: input {d.input.bitDepthPerChannel || "–"} of {d.input.dataSize * 8}, output {d.output.bitDepthPerChannel || "–"} of {d.output.dataSize * 8}.</p>}
      </Section>

      <Section id="endian" active={active} title="Use Big Endian" ini="useBigEndian">
        <Values rows={["Little Endian", "Big Endian"]} marks={sides((f) => f.useBigEndian)} />
      </Section>

      <Section id="conversion" active={active} title="Conversion Parameter" ini="[conversionParams] Conv_Param_1">
        <p>Colour conversion standard and range used between YUV and RGB.</p>
        <Values rows={CONVERSION_PARAMETERS} marks={[[d?.conversionParameter, "current"]]} />
      </Section>

      <Section id="devices" active={active} title="Device Preferred / Device Alternative" ini="[deviceList] preferred, alternative">
        <p>Device that runs the conversion; the alternative is used when the preferred device is not available.</p>
        <Values rows={DEVICE_TYPES} marks={d ? [[d.devicePreferred, "preferred"], [d.deviceAlternative, "alternative"]] : []} />
        <p className="help-note"><Icon name="alert" size={13} /> Please check that the needed drivers are installed on the bench PC.
          See the section “x2rgbApp to view the RAW frames” of the <a href={DRIVER_GUIDE} target="_blank" rel="noreferrer">DAT file player guide</a>.</p>
      </Section>

      <Section id="imageType" active={active} title="Image Type" ini="[Image_Type] Image Type">
        <p>Image type for the IMAQ reference.</p>
        <Values rows={IMAGE_TYPES} marks={[[d?.imageType, "current"]]} />
      </Section>
    </aside>
  );
}
