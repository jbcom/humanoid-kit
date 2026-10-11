/**
 * The strand layers' shader (body hair): strands drawn at true scale up close,
 * their mean cover from afar, the two in agreement, and running along the hair
 * flow. Rendered on a flat plane facing the camera, whose flow (the bind pose's
 * downward direction) runs down the plane's v.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SKIN_APPEARANCE } from "../../src/render/skinMaterial.ts";
import { STRAND_FILTER } from "../../src/render/strandFootprint.ts";
import { labFromLinear } from "../../src/surface/cielab.ts";
import type { StrandLayer, StrandPaint } from "../../src/surface/layers.ts";
import { strandCover } from "../../src/surface/layers.ts";
import { VELLUS_LAYER } from "../../src/surface/regions/bodyHair.ts";
import { mean, noFields, renderLayers, renderLayersRgba, SIZE, variance } from "./layerRender.ts";

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

/** The pixel's width, metres. */
const PIXEL = NEAR.span / SIZE;

/** The tent's weight up to `x`, for a tent of half-width `r` (`hkTentCdf`, strandFootprint.ts). */
const tentCdf = (x: number, r: number) => {
  const t = Math.max(-1, Math.min(1, x / r));
  return t < 0 ? 0.5 * (1 + t) ** 2 : 1 - 0.5 * (1 - t) ** 2;
};

/**
 * How much of a pixel `PIXEL` across a strand `width` wide covers at `d` from its axis
 * (`hkStrandFootprint`): its width under a tent `STRAND_FILTER` pixels either side.
 */
const footprint = (d: number, width: number) =>
  tentCdf(0.5 * width - d, STRAND_FILTER * PIXEL) -
  tentCdf(-0.5 * width - d, STRAND_FILTER * PIXEL);

/**
 * The most the coverage of a strand `width` wide can change between two samples `shift`
 * metres apart across it: the largest |footprint(d) - footprint(d + shift)| over where
 * the strand lies between them.
 */
function maxCoverStep(width: number, shift: number) {
  const reach = 0.5 * width + STRAND_FILTER * PIXEL;
  let most = 0;
  for (let d = -reach - shift; d <= reach; d += PIXEL / 1000)
    most = Math.max(most, Math.abs(footprint(d, width) - footprint(d + shift, width)));
  return most;
}

/**
 * How much of the skin's value a strand fully covering a pixel takes away: the lit hair
 * against the lit skin, read off a strand ten pixels wide, which covers its middle
 * pixels whole.
 */
function darkening(skin: number) {
  const wide = renderLayers([strands({ width: 10 * PIXEL })], { light: FRONT, view: NEAR });
  return 1 - Math.min(...wide) / skin;
}

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
    // Some pixels are bare skin between strands, some are dark hair (a strand
    // about a pixel wide, soft-edged, darkens its middle pixel by around half).
    const skin = mean(bare);
    expect(hair.filter((x) => x > 0.95 * skin).length).toBeGreaterThan(SIZE * SIZE * 0.3);
    expect(hair.filter((x) => x < 0.6 * skin).length).toBeGreaterThan(SIZE * SIZE * 0.02);
  });

  // A strand about a pixel wide is a thin hair, soft at its edges: a box filter
  // made it flip from skin to hair within a pixel, hundreds of hard black
  // dashes on a chest close-up (here, a step of 0.73 of the skin in one pixel).
  //
  // The bound is derived from the footprint, not picked. The strand is 80 µm wide and a
  // pixel 78 µm, so it is 1.024 pixels wide at its root (it thins to 0.4 of that at the
  // tip, and a tilt only brings the samples closer across it). Under the footprint, a
  // tent 1.25 pixels either side, one strand covers at most 0.65 of a pixel (a pixel on
  // its axis), and between two neighbouring pixels its coverage changes by at most
  // max |F(d) - F(d + 1 px)| = 0.528 (a pixel 1.25 px from the axis and the next 0.25 px
  // from it). A box filter changes by up to 1. A whole pixel of the hair takes 0.73 of the
  // skin's value away (the lit hair against the lit skin, read off a wide strand), so no
  // step between neighbouring pixels may exceed 0.73 × 0.528 = 0.386 of the skin's value.
  //
  // That holds for one strand. Two that cross a pixel combine as 1 - (1 - a)(1 - b) and
  // can pass it, as the dense scene of the tests above does (it was once checked against
  // "half the skin", 0.5, which it passed on SwiftShader at 0.467 and so said nothing
  // about the footprint). So this draws a few strands a view apart (a twentieth of the
  // roots carry one) and states that they do not overlap: none is darker than a single
  // strand's peak, 0.73 × 0.65. The worst step measured is 0.384, within 0.5% of the bound.
  it("draw a strand about a pixel wide soft-edged, not as a hard dash", () => {
    const size = 512;
    // The same pixel as NEAR (78 µm) over a 4 cm view, 16 cm² and some 13 strands.
    const view = { span: NEAR.span * (size / SIZE), centre: NEAR.centre };
    const skin = mean(renderLayers([], { light: FRONT, view, size }));
    const hair = renderLayers([strands({ strength: 0.04 })], { light: FRONT, view, size });
    let worst = 0;
    let darkest = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const here = hair[y * size + x] as number;
        darkest = Math.max(darkest, 1 - here / skin);
        if (x + 1 < size)
          worst = Math.max(worst, Math.abs((hair[y * size + x + 1] as number) - here));
      }
    const dark = darkening(skin);
    // One part in a thousand for the float render and the lit-hair measurement.
    const slack = 1.001;
    expect(darkest, "no two strands overlap").toBeLessThanOrEqual(
      dark * footprint(0, HAIR.width) * slack,
    );
    expect(darkest, "there are strands").toBeGreaterThan(0.9 * dark * footprint(0, HAIR.width));
    const bound = dark * maxCoverStep(HAIR.width, PIXEL);
    expect(bound, "the bound is below a box filter's step").toBeLessThan(0.5);
    expect(worst / skin).toBeLessThanOrEqual(bound * slack);
  });

  // The strands' grid is chosen from the flow's direction, quantised to eight over a half
  // turn, and the two grids round the flow are blended by a hash weighted by closeness.
  // Hair running straight down is exactly on a boundary between two of them, and the
  // rounding of a GPU's derivatives, which gives the flow, puts some pixels either side
  // (on Apple's, in blocks of them). Each side used to draw its grid with its own seed,
  // so the same direction gave two different sets of roots, and strands were cut off where
  // the sets met: a step of 0.58 of the skin where the footprint allows 0.386. A grid is
  // now the same grid from either side of its direction (a bin names it), so the hair
  // a little either side of the boundary is the same hair.
  it("draw the same strands just either side of a direction boundary", () => {
    const size = 256;
    const view = { span: NEAR.span * (size / SIZE), centre: [0, 0] as [number, number] };
    const turn = 0.006;
    const paint = strands({ strength: 0.2 });
    const under = renderLayers([paint], { light: FRONT, view, size, turn: -turn });
    const over = renderLayers([paint], { light: FRONT, view, size, turn });
    const skin = mean(renderLayers([], { light: FRONT, view, size }));
    // The images are one plane turned by 2 × turn about the middle of the view: a pixel
    // within `half` of the middle has moved by at most this many pixels.
    const half = 32;
    const moved = 2 * turn * half * Math.SQRT2;
    let worst = 0;
    let darkest = 0;
    for (let y = size / 2 - half; y < size / 2 + half; y++)
      for (let x = size / 2 - half; x < size / 2 + half; x++) {
        const i = y * size + x;
        worst = Math.max(worst, Math.abs((under[i] as number) - (over[i] as number)));
        darkest = Math.max(darkest, 1 - (under[i] as number) / skin);
      }
    const dark = darkening(skin);
    const slack = 1.001;
    expect(darkest, "no two strands overlap").toBeLessThanOrEqual(
      dark * footprint(0, HAIR.width) * slack,
    );
    expect(darkest, "there are strands").toBeGreaterThan(0.5 * dark * footprint(0, HAIR.width));
    // Moved by `moved` pixels, a strand's coverage changes by at most this.
    const bound = dark * maxCoverStep(HAIR.width, moved * PIXEL);
    expect(worst / skin).toBeLessThanOrEqual(bound * slack);
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
