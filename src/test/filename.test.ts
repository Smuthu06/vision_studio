import { describe, expect, it } from "vitest";
import { projectFileName } from "../core/filename";

describe("projectFileName", () => {
  it("is <project>_v<version>.json", () => {
    expect(projectFileName({ project: "sample", version: "V.1.0.0" })).toBe("sample_v1.0.0.json");
    expect(projectFileName({ project: "Front Cam", version: "v2.3.1" })).toBe("Front Cam_v2.3.1.json");
  });
  it("replaces characters Windows rejects and handles missing parts", () => {
    expect(projectFileName({ project: 'a/b:c*?"<>|', version: "V.1.0.0" })).toBe("a_b_c_______v1.0.0.json");
    expect(projectFileName({ project: "  ..x.. ", version: "" })).toBe("x.json");
    expect(projectFileName({})).toBe("Untitled.json");
  });
});
