import { describe, expect, it } from "vitest";
import { debayerSummary, defaultBoard, defaultDebayer, pixelFormatProblems, readBoards, readDebayers, FORMAT_PARAMETERS } from "../core/benchDefaults";
import { applyRenames, defaultCatalog, normalizeCatalog, optionsFor } from "../core/catalog";
import { mk } from "../core/model";

describe("FPGA board defaults and debayer configurations (ui_config.json)", () => {
  it("ships the FPGA Defaults dialog values", () => {
    expect(defaultCatalog().boardDefaults).toEqual([{
      boardName: "board1", siReferenceClockHz: 25e6, soReferenceClockHz: 25e6, framesOnDma: 20, frameSyncWindow: 30,
      frameSyncToleranceUs: 650, llpFifoDepth: 200000000,
      routingSignals: [{ source: "PXI_Trig1", destination: "Start_Trig" }, { source: "PXI_Trig4", destination: "BackPlane_CAM_Trig" }],
    }]);
  });

  it("turns older plain list entries into full entries with defaults", () => {
    const w: string[] = [];
    const { catalog } = normalizeCatalog({ boardDefaults: [{ value: "Default", description: "as shipped" }], debayerConfigs: [{ value: "RGGB" }] });
    expect(catalog.boardDefaults[0]).toMatchObject({ boardName: "Default", description: "as shipped", framesOnDma: 20 });
    expect(catalog.debayerConfigs[0]).toMatchObject({ name: "RGGB", inputFormat: { imageFormat: "IMAGE_FORMAT_RAW" } });
    expect(readBoards([{ boardName: "a" }, { boardName: "A" }], w)).toHaveLength(1);
    expect(w[0]).toMatch(/duplicate board 'A'/);
  });

  it("reads numbers written as text (2.5E+7) and keeps unknown formats out", () => {
    const [b] = readBoards([{ boardName: "x", siReferenceClockHz: "2.5E+7" }], []);
    expect(b.siReferenceClockHz).toBe(25_000_000);
    const [d] = readDebayers([{ name: "y", inputFormat: { imageFormat: "IMAGE_FORMAT_HDR", dataSize: 4 } }], []);
    expect(d.inputFormat).toMatchObject({ imageFormat: "IMAGE_FORMAT_RAW", dataSize: 4 });
  });

  it("checks the documented pixel format rules", () => {
    const raw = defaultDebayer().inputFormat;
    expect(pixelFormatProblems(raw, "input")).toEqual([]);
    expect(pixelFormatProblems({ ...raw, bitDepthPerChannel: 20 }, "input")[0].message).toBe("Bit depth 20 does not fit in 2 byte(s) (max 16)");
    expect(pixelFormatProblems({ ...raw, dataSize: 3 }, "input")[0].field).toBe("dataSize");
    expect(pixelFormatProblems({ ...raw, imageFormat: "IMAGE_FORMAT_YUV", dataSize: 2, bitDepthPerChannel: 8 }, "input"))
      .toEqual([{ field: "dataSize", severity: "warning", message: "YUV data is documented as uint8 (data size 1)" }]);
    // RGB channel orders differ between input (0–8) and output (0–3)
    expect(FORMAT_PARAMETERS.input.IMAGE_FORMAT_RGB).toHaveLength(9);
    expect(pixelFormatProblems({ dataSize: 1, bitDepthPerChannel: 8, useBigEndian: 0, imageFormat: "IMAGE_FORMAT_RGB", formatParameter: 8 }, "output")[0].field).toBe("formatParameter");
  });

  it("offers entries by name with a summary, and renames them in tester configurations", () => {
    const c = defaultCatalog();
    expect(optionsFor("debayerConfigs", c).labels.RAW_RGGB_to_RGB).toBe("RAW_RGGB_to_RGB – 1632×1290 RAW RGGB → RGB BGRA");
    expect(debayerSummary(defaultDebayer())).toBe("1632×1290 RAW RGGB → RGB BGRA");
    expect(optionsFor("boardDefaults", c).values).toEqual(["board1"]);
    const cam = mk("testerCamera", { fpgaBoardName: "board1" }, [mk("testerChannel", {}, [mk("testerVc", { debayer: "RAW_RGGB_to_RGB" })])]);
    applyRenames(cam, [{ source: "boardDefaults", from: "board1", to: "bench_A" }, { source: "debayerConfigs", from: "RAW_RGGB_to_RGB", to: "front" }]);
    expect(cam.params.fpgaBoardName).toBe("bench_A");
    expect(cam.children[0].children[0].params.debayer).toBe("front");
    expect(defaultBoard("z").boardName).toBe("z");
  });
});
