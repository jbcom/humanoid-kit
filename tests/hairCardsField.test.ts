/** A value over the cards' texture from where each texel lies on the head, and the fade it drives. */
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { HeadFrame } from "../scripts/lib/hairCards/head.ts";
import { fadeKeep } from "../scripts/lib/hairCards/index.ts";
import { headAngles, texelField } from "../scripts/lib/hairCards/uvField.ts";

const origin = { centre: new Vector3(0, 0, 0) } as HeadFrame;

describe("headAngles", () => {
  it("reads azimuth from the front either side and elevation from the horizontal", () => {
    expect(headAngles(origin, new Vector3(0, 0, 1))).toEqual({ azimuth: 0, elevation: 0 });
    const side = headAngles(origin, new Vector3(-1, 0, 0));
    expect(side.azimuth).toBeCloseTo(90, 6);
    expect(side.elevation).toBeCloseTo(0, 6);
    const top = headAngles(origin, new Vector3(0, 1, 1));
    expect(top.elevation).toBeCloseTo(45, 6);
  });
});

describe("texelField", () => {
  // One quad facing +z, y from -1 (V = 0) to +1 (V = 1), covering the texture's left half.
  const cards = {
    positions: Float32Array.of(-1, -1, 4, 1, -1, 4, 1, 1, 4, -1, 1, 4),
    faceVerts: Uint32Array.of(0, 1, 2, 3),
    faceUvs: Uint32Array.of(0, 1, 2, 3),
    uvs: Float32Array.of(0, 0, 0.5, 0, 0.5, 1, 0, 1),
  };
  const field = texelField(cards, origin, 8, 8, (_azimuth, elevation) => elevation);

  it("is NaN where no card covers the texture, and a value where one does", () => {
    for (let y = 0; y < 8; y++) {
      expect(Number.isNaN(field[y * 8 + 7] as number)).toBe(true);
      expect(Number.isNaN(field[y * 8 + 1] as number)).toBe(false);
    }
  });

  it("puts the quad's top (V = 1) on the texture's top row, so elevation falls down the rows", () => {
    const column = (x: number) => Array.from({ length: 8 }, (_, y) => field[y * 8 + x] as number);
    const left = column(1);
    for (let y = 1; y < 8; y++) expect(left[y] as number).toBeLessThan(left[y - 1] as number);
    expect(left[0] as number).toBeGreaterThan(0);
    expect(left[7] as number).toBeLessThan(0);
  });
});

describe("the fade", () => {
  it("leaves the front and the top whole", () => {
    expect(fadeKeep(0, -20)).toBe(1);
    expect(fadeKeep(90, 60)).toBe(1);
  });

  it("is bare skin at the ear's level and round the nape, and tapers between", () => {
    expect(fadeKeep(90, 0)).toBeLessThan(0.1);
    expect(fadeKeep(170, -20)).toBeLessThan(0.05);
    const taper = [0, 6, 12, 18, 24].map((e) => fadeKeep(90, e));
    for (let i = 1; i < taper.length; i++)
      expect(taper[i] as number).toBeGreaterThanOrEqual(taper[i - 1] as number);
    expect(fadeKeep(90, 12)).toBeGreaterThan(0.1);
    expect(fadeKeep(90, 12)).toBeLessThan(0.9);
  });
});
