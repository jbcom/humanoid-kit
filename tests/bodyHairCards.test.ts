import { describe, expect, it } from "vitest";
import {
  type CardSpec,
  generateCards,
  generateStrandMap,
  ROOT_SOLID,
  rootShare,
  SEGMENTS,
  STRAND_COLUMNS,
} from "../scripts/lib/bodyHairCards.ts";
import { groupFaces } from "../src/format/assetFormat.ts";
import { evaluateBinding } from "../src/mhclo/bound.ts";
import { HAIR_STRAND_MEAN } from "../src/surface/hairTone.ts";
import { bodyHairMasks } from "../src/surface/regions/bodyHair.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const masks = bodyHairMasks(assets);
const spec: CardSpec = {
  id: "test-chest",
  mask: masks.chest,
  density: 0.5,
  length: 0.02,
  width: 0.004,
  lift: 0.2,
  spread: 0.4,
  seed: 7,
};
const cards = generateCards(assets, spec);
const { arrays } = cards.compiled;
const PER_CARD = 2 * (SEGMENTS + 1);

describe("body hair cards", () => {
  it("are the same cards for the same spec", () => {
    const again = generateCards(assets, spec);
    expect(again.compiled.arrays.offsets).toEqual(arrays.offsets);
    expect(again.rank).toEqual(cards.rank);
  });

  it("number about the density times the masked skin's area", () => {
    // Masked area, cm², from the triangles the generator walks.
    const P = assets.positions;
    let area = 0;
    for (const f of groupFaces(assets, "body")) {
      const q = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
      for (const [a, b, c] of [
        [q[0], q[1], q[2]],
        [q[0], q[2], q[3]],
      ] as [number, number, number][]) {
        const m =
          ((spec.mask[a] as number) + (spec.mask[b] as number) + (spec.mask[c] as number)) / 3;
        const e1 = [0, 1, 2].map((k) => (P[b * 3 + k] as number) - (P[a * 3 + k] as number));
        const e2 = [0, 1, 2].map((k) => (P[c * 3 + k] as number) - (P[a * 3 + k] as number));
        const cr = [
          (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number),
          (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number),
          (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number),
        ];
        area += (Math.hypot(...cr) / 2) * 1e4 * rootShare(m);
      }
    }
    const expected = area * spec.density;
    expect(cards.cardCount).toBeGreaterThan(0.85 * expected);
    expect(cards.cardCount).toBeLessThan(1.15 * expected);
    expect(cards.compiled.vertexCount).toBe(cards.cardCount * PER_CARD);
    expect(cards.compiled.faceCount).toBe(cards.cardCount * SEGMENTS);
  });

  it("bind to the base mesh so the binding at rest gives the generated card", () => {
    const out = new Float32Array(cards.compiled.vertexCount * 3);
    evaluateBinding(
      { ...arrays, entry: { scale: null, vertexCount: cards.compiled.vertexCount } },
      assets.positions,
      out,
    );
    // Each card's first vertex pair straddles its root on the skin.
    for (let c = 0; c < cards.cardCount; c += 17) {
      const v0 = c * PER_CARD;
      const mid = [0, 1, 2].map(
        (k) => ((out[v0 * 3 + k] as number) + (out[(v0 + 1) * 3 + k] as number)) / 2,
      );
      const root = [0, 1, 2].map((k) =>
        [0, 1, 2].reduce(
          (s, j) =>
            s +
            (arrays.weights[v0 * 3 + j] as number) *
              (assets.positions[(arrays.refVerts[v0 * 3 + j] as number) * 3 + k] as number),
          0,
        ),
      );
      const d = Math.hypot(...mid.map((m, k) => m - (root[k] as number)));
      expect(d).toBeLessThan(5e-4);
    }
  });

  // A card is drawn whole, so one rooted in a mask's faint edge is a lone
  // strip of hair where the hair has all but ended: the beards sheet's
  // splinters down the neck. Cards root only where the mask is solid.
  it("grow only where the mask is solid, and run down the body", () => {
    let down = 0;
    for (let c = 0; c < cards.cardCount; c++) {
      const v0 = c * PER_CARD;
      const [a, b, cc] = [0, 1, 2].map((j) => arrays.refVerts[v0 * 3 + j] as number) as [
        number,
        number,
        number,
      ];
      const mean =
        ((spec.mask[a] as number) + (spec.mask[b] as number) + (spec.mask[cc] as number)) / 3;
      expect(mean).toBeGreaterThan(ROOT_SOLID.lo);
      const tip = (v0 + PER_CARD - 2) * 3 + 1;
      if ((arrays.offsets[tip] as number) < (arrays.offsets[v0 * 3 + 1] as number)) down++;
    }
    expect(down / cards.cardCount).toBeGreaterThan(0.9);
  });

  it("give each card one rank, spread over [0, 1)", () => {
    let low = 0;
    for (let c = 0; c < cards.cardCount; c++) {
      const r = cards.rank[c * PER_CARD] as number;
      for (let k = 1; k < PER_CARD; k++) expect(cards.rank[c * PER_CARD + k]).toBe(r);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      if (r < 0.5) low++;
    }
    expect(low / cards.cardCount).toBeGreaterThan(0.4);
    expect(low / cards.cardCount).toBeLessThan(0.6);
  });

  it("map each card to one column of the strand map, root at v = 0", () => {
    for (let c = 0; c < cards.cardCount; c++) {
      const v0 = c * PER_CARD;
      const u0 = arrays.uvs[v0 * 2] as number;
      const u1 = arrays.uvs[(v0 + 1) * 2] as number;
      expect(u1 - u0).toBeCloseTo(1 / STRAND_COLUMNS);
      expect(arrays.uvs[v0 * 2 + 1]).toBe(0);
      expect(arrays.uvs[(v0 + PER_CARD - 1) * 2 + 1]).toBe(1);
    }
  });
});

describe("the cards' strand map", () => {
  it("has the strand mean every packed hair texture has", () => {
    const w = 128;
    const h = 256;
    const rgba = generateStrandMap(w, h, 3);
    const linear = (b: number) => {
      const c = b / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < w * h; i++) {
      const a = (rgba[i * 4 + 3] as number) / 255;
      sum += linear(rgba[i * 4] as number) * a;
      weight += a;
    }
    expect(sum / weight).toBeCloseTo(HAIR_STRAND_MEAN, 1);
    // Mostly air: strands are thin.
    expect(weight / (w * h)).toBeLessThan(0.5);
    expect(weight / (w * h)).toBeGreaterThan(0.03);
  });
});
