/**
 * The strand layers' shader (body hair): strands drawn at true scale up close,
 * their mean cover from afar, the two in agreement, and running along the hair
 * flow. Rendered on a flat plane facing the camera, whose flow (the bind pose's
 * downward direction) runs down the plane's v.
 */
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_SKIN_APPEARANCE } from "../../src/render/skinMaterial.ts";
import { labFromLinear } from "../../src/surface/cielab.ts";
import type { StrandLayer, StrandPaint } from "../../src/surface/layers.ts";
import { strandCover } from "../../src/surface/layers.ts";
import { VELLUS_LAYER } from "../../src/surface/regions/bodyHair.ts";
import {
  disposeLayerRender,
  mean,
  noFields,
  renderLayers,
  renderLayersRgba,
  SIZE,
  variance,
} from "./layerRender.ts";

afterAll(disposeLayerRender);

const HAIR: StrandPaint = {
  strength: 1,
  colour: [0.02, 0.015, 0.01],
  density: 20,
  length: 0.015,
  width: 80e-6,
  height: 0,
};
const strands = (paint: Partial<StrandPaint> = {}): StrandLayer => ({
  id: "strands",
  kind: "strands",
  targets: [],
  fields: noFields,
  paint: () => ({ ...HAIR, ...paint }),
});
const FRONT: [number, number, number] = [0, 0, 1];
/** A 1 cm view: a pixel is 0.08 mm, finer than a cell across (about 0.67 mm). */
const NEAR = { span: 0.01, centre: [0.3, 0.2] as [number, number] };

/** Mean absolute difference between neighbouring pixels along x (dx) and y (dy). */
function gradients(px: Float32Array) {
  let dx = 0;
  let dy = 0;
  for (let y = 0; y + 1 < SIZE; y++)
    for (let x = 0; x + 1 < SIZE; x++) {
      const p = px[y * SIZE + x] as number;
      dx += Math.abs((px[y * SIZE + x + 1] as number) - p);
      dy += Math.abs((px[(y + 1) * SIZE + x] as number) - p);
    }
  return { dx, dy };
}

describe("strand layers", () => {
  it("draw nothing at no strength, exactly as no layer", () => {
    const none = renderLayers([], { light: FRONT, view: NEAR });
    const zero = renderLayers([strands({ strength: 0 })], { light: FRONT, view: NEAR });
    expect(Math.max(...zero.map((x, i) => Math.abs(x - (none[i] as number))))).toBeLessThan(1e-6);
  });

  it("draw separate strands up close", () => {
    const bare = renderLayers([], { light: FRONT, view: NEAR });
    const hair = renderLayers([strands()], { light: FRONT, view: NEAR });
    expect(variance(hair)).toBeGreaterThan(50 * variance(bare) + 1e-6);
    // Some pixels are bare skin between strands, some are dark hair.
    const skin = mean(bare);
    expect(hair.filter((x) => x > 0.95 * skin).length).toBeGreaterThan(SIZE * SIZE * 0.3);
    expect(hair.filter((x) => x < 0.5 * skin).length).toBeGreaterThan(SIZE * SIZE * 0.02);
  });

  it("run along the flow: down the plane, so the image changes less along it than across", () => {
    const { dx, dy } = gradients(renderLayers([strands()], { light: FRONT, view: NEAR }));
    expect(dy).toBeLessThan(0.5 * dx);
  });

  it("become their mean cover from afar, smooth and as dark on average as up close", () => {
    const bare = mean(renderLayers([], { light: FRONT }));
    const far = renderLayers([strands()], { light: FRONT });
    // Up close over 16 cm² (some 320 roots), still finer than a cell a pixel.
    const near = renderLayers([strands()], {
      light: FRONT,
      view: { span: 0.04, centre: NEAR.centre },
    });
    // Smooth: a 2 m plane in 128 pixels, 16 mm a pixel, far coarser than a cell.
    expect(Math.sqrt(variance(far))).toBeLessThan(0.01 * mean(far));
    const darkFar = 1 - mean(far) / bare;
    const darkNear = 1 - mean(near) / bare;
    expect(darkFar).toBeGreaterThan(0.5 * strandCover(HAIR));
    expect(darkFar).toBeLessThan(1.2 * strandCover(HAIR));
    expect(Math.abs(darkNear - darkFar)).toBeLessThan(0.35 * darkFar);
  });

  it("do not speckle where a cell across is about a pixel: they are their mean there", () => {
    // HAIR's cell across is 1 / (density × half the length) ≈ 0.67 mm; 128 of them.
    const span = 128 / (HAIR.density * 1e4 * 0.5 * HAIR.length);
    const hair = renderLayers([strands()], {
      light: FRONT,
      view: { span, centre: NEAR.centre },
    });
    expect(Math.sqrt(variance(hair))).toBeLessThan(0.01 * mean(hair));
  });

  it("still draw strands at the far corner of the UV layout, where cell indices are large", () => {
    const corner = { span: 0.01, centre: [0.99, 0.99] as [number, number] };
    const bare = renderLayers([], { light: FRONT, view: corner });
    const hair = renderLayers([strands()], { light: FRONT, view: corner });
    expect(variance(hair)).toBeGreaterThan(50 * variance(bare) + 1e-6);
  });

  // Hair is never lighter than the skin it lies on, and vellus, which every
  // measured skin colour already holds, barely moves it: up close, lit from the
  // front and at a graze, at every tone.
  it("draw vellus no lighter than the skin, and within a small ΔL* of it, at every tone", () => {
    const lightness = (px: Float32Array) =>
      Array.from({ length: px.length / 4 }, (_, i) =>
        labFromLinear([px[i * 4] as number, px[i * 4 + 1] as number, px[i * 4 + 2] as number]),
      ).map((lab) => lab[0]);
    for (const melanin of [0.05, 0.35, 0.65, 0.95])
      for (const light of [FRONT, [1, 0, 0.35] as [number, number, number]]) {
        const appearance = {
          ...DEFAULT_SKIN_APPEARANCE,
          tone: { ...DEFAULT_SKIN_APPEARANCE.tone, melanin },
          flush: 0,
        };
        const bare = lightness(renderLayersRgba([], { light, view: NEAR, appearance }));
        const hair = lightness(renderLayersRgba([VELLUS_LAYER], { light, view: NEAR, appearance }));
        const delta = hair.map((L, i) => L - (bare[i] as number));
        const label = `melanin ${melanin}, light ${light}`;
        expect(Math.max(...delta), label).toBeLessThan(0.5);
        expect(delta.reduce((s, d) => s + Math.abs(d), 0) / delta.length, label).toBeLessThan(2);
      }
  });

  it("thin with coverage: half the hair covers about half as much", () => {
    const bare = mean(renderLayers([], { light: FRONT, view: NEAR }));
    const full = 1 - mean(renderLayers([strands()], { light: FRONT, view: NEAR })) / bare;
    const half =
      1 - mean(renderLayers([strands({ strength: 0.5 })], { light: FRONT, view: NEAR })) / bare;
    expect(half / full).toBeGreaterThan(0.3);
    expect(half / full).toBeLessThan(0.7);
  });
});
