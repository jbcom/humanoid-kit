import { describe, expect, it } from "vitest";
import { cssColour, cssRamp, fromCssColour } from "../src/editor/ui/cssColour.ts";
import { linearToSrgb } from "../src/surface/skinTone.ts";

describe("panel colours", () => {
  it("writes a linear colour as its sRGB hex", () => {
    expect(cssColour([0, 0, 0])).toBe("#000000");
    expect(cssColour([1, 1, 1])).toBe("#ffffff");
    // Mid-grey in linear light is not mid-grey in sRGB.
    expect(cssColour([0.2, 0.2, 0.2])).toBe(`#${linearToSrgb(0.2).toString(16).repeat(3)}`);
    expect(cssColour([0.274, 0.132, 0.068])).not.toBe("#ffffff");
  });

  it("reads a hex back to the same linear colour", () => {
    for (const hex of ["#000000", "#8f664a", "#3b5f8a", "#ffffff"])
      expect(cssColour(fromCssColour(hex))).toBe(hex);
    expect(fromCssColour("#808080")[0]).toBeCloseTo(0.2158, 3);
  });

  it("ramps through distinct colours", () => {
    const g = cssRamp(3, (t) => [t, t / 2, 0]);
    expect(g).toBe(
      `linear-gradient(90deg, #000000, ${cssColour([0.5, 0.25, 0])}, ${cssColour([1, 0.5, 0])})`,
    );
  });
});
