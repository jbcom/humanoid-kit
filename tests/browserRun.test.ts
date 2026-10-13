import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { browserRun } from "../scripts/lib/browserRun.ts";

describe("the browser configs' launch decision", () => {
  it("opens a headed window on the native GPU for a person at their own machine", () => {
    expect(browserRun({}, "darwin")).toEqual({ gpuMode: "auto", headless: false });
  });

  it("renders headless through Metal on a render Mac, not on SwiftShader", () => {
    const env = {
      CI: "1",
      HEAVY_RENDER_HEADLESS: "1",
      HEAVY_RENDER_HOST: "render-user@render-host.example",
    };
    expect(browserRun(env, "darwin")).toEqual({ gpuMode: "macos-hardware-metal", headless: true });
  });

  it("keeps SwiftShader for CI that is not a render Mac", () => {
    expect(browserRun({ CI: "1" }, "linux")).toEqual({ gpuMode: "software", headless: true });
    expect(browserRun({ CI: "1", HEAVY_RENDER_HOST: "x" }, "linux").gpuMode).toBe("software");
  });

  it("follows the priority lane: headless unless it asks for headed hardware proof", () => {
    const lane = {
      HEAVY_PRIORITY: "1",
      HEAVY_BROWSER_GPU: "macos-hardware-metal",
      HEAVY_BROWSER_MUTE: "1",
    };
    expect(
      browserRun({ ...lane, HEAVY_BROWSER_HEADLESS: "1", PW_HEADLESS: "1" }, "darwin"),
    ).toEqual({
      gpuMode: "macos-hardware-metal",
      headless: true,
    });
    expect(browserRun({ ...lane, HEAVY_BROWSER_HEADLESS: "0" }, "darwin")).toEqual({
      gpuMode: "macos-hardware-metal",
      headless: false,
    });
    expect(browserRun({ PW_HEADLESS: "1" }, "darwin").headless).toBe(true);
  });

  it("lets a person's HK_GPU and HK_HEADED override everything", () => {
    const env = { CI: "1", HEAVY_RENDER_HOST: "x", HK_GPU: "software", HK_HEADED: "1" };
    expect(browserRun(env, "darwin")).toEqual({ gpuMode: "software", headless: false });
  });

  it("is opted in to the priority lane, which refuses a project that has not promised all this", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.heavySlot).toEqual({ priorityLane: true });
  });
});
