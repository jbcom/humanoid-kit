import { describe, expect, it } from "vitest";
import { BLEED_PASSES, bleedEdges } from "../scripts/lib/edgeBleed.ts";

/** An 8×8 card: opaque grey 160 on the left half, a faint black edge column, clear black beyond. */
function card() {
  const w = 8;
  const h = 8;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = x < 4 ? 140 + 10 * (y % 3) : 0;
      rgba.set([v, v, v, x < 4 ? 255 : x === 4 ? 40 : 0], i);
    }
  return { rgba, w, h };
}

describe("edge bleeding", () => {
  it("gives a faint or clear texel the colour of the opaque texels beside it, never darker", () => {
    const { rgba, w, h } = card();
    bleedEdges(rgba, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 4; x < w; x++) {
        const v = rgba[(y * w + x) * 4] as number;
        expect(v, `${x},${y}`).toBeGreaterThanOrEqual(140);
        expect(v, `${x},${y}`).toBeLessThanOrEqual(160);
      }
  });

  it("leaves every opaque texel's colour and every alpha as it was", () => {
    const { rgba, w, h } = card();
    const before = Uint8Array.from(rgba);
    bleedEdges(rgba, w, h);
    for (let i = 0; i < w * h; i++) {
      expect(rgba[i * 4 + 3]).toBe(before[i * 4 + 3]);
      if ((before[i * 4 + 3] as number) === 255)
        expect([...rgba.subarray(i * 4, i * 4 + 3)]).toEqual([
          ...before.subarray(i * 4, i * 4 + 3),
        ]);
    }
  });

  it("reaches BLEED_PASSES texels out and no further", () => {
    const w = BLEED_PASSES + 4;
    const rgba = new Uint8Array(w * 4);
    rgba.set([200, 200, 200, 255], 0);
    bleedEdges(rgba, w, 1);
    expect(rgba[BLEED_PASSES * 4]).toBe(200);
    expect(rgba[(BLEED_PASSES + 1) * 4]).toBe(0);
  });
});
