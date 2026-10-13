import { describe, expect, it } from "vitest";
import { jointPosition } from "../src/format/assetFormat.ts";
import { evaluateBinding } from "../src/mhclo/bound.ts";
import { type ResolvedBeard, resolveBeard } from "../src/surface/beard.ts";
import {
  BEARD_CARD_MIN_LENGTH,
  beardCardKey,
  beardCardSpec,
  generateBeardCards,
} from "../src/surface/beardCards.ts";
import type { BeardSpec, BeardStyle } from "../src/surface/bodyHair.ts";
import { type Cards, DRAPE } from "../src/surface/bodyHairCards.ts";
import { beardMasks } from "../src/surface/regions/bodyHairCoat.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const parts = beardMasks(assets);
const CHIN = 1.4;
const beard = (b: BeardStyle | BeardSpec): ResolvedBeard =>
  resolveBeard({ bodyHair: { beard: b } }, CHIN);

/** Every card's vertices at rest on the base mesh, three per vertex. */
const rest = (cards: Cards): Float32Array =>
  evaluateBinding(
    { entry: { scale: null, vertexCount: cards.compiled.vertexCount }, ...cards.compiled.arrays },
    assets.positions,
    new Float32Array(cards.compiled.vertexCount * 3),
  );

/** A card's root and tip: the midpoints of its first and last vertex pairs. */
function ends(cards: Cards, p: Float32Array, c: number) {
  const first = cards.cardStart[c] as number;
  const last = (cards.cardStart[c + 1] as number) - 2;
  const mid = (v: number): [number, number, number] =>
    [0, 1, 2].map((k) => ((p[v * 3 + k] as number) + (p[(v + 1) * 3 + k] as number)) / 2) as [
      number,
      number,
      number,
    ];
  return { root: mid(first), tip: mid(last), vertices: last + 2 - first };
}

const chinY = (() => {
  const p = new Float32Array(3);
  jointPosition(assets, assets.positions, "special04____tail", p, 0);
  return p[1] as number;
})();

describe("beard cards", () => {
  it("grow nothing for a clean-shaven face or stubble", () => {
    expect(beardCardSpec(assets, beard("none"))).toBeNull();
    expect(beardCardSpec(assets, beard("stubble"))).toBeNull();
    expect(generateBeardCards(assets, beard({ style: "full", length: 0.002 }))).toBeNull();
  });

  it("are the same cards for the same beard, and keyed by it", () => {
    const a = generateBeardCards(assets, beard("full")) as Cards;
    const b = generateBeardCards(assets, beard("full")) as Cards;
    expect(b.compiled.arrays.offsets).toEqual(a.compiled.arrays.offsets);
    expect(beardCardKey(beard("full"))).toBe(beardCardKey(beard("full")));
    expect(beardCardKey(beard("full"))).not.toBe(
      beardCardKey(beard({ style: "full", length: 0.05 })),
    );
    expect(beardCardKey(beard("full"))).not.toBe(beardCardKey(beard("goatee")));
  });

  it("root only on the parts a style grows", () => {
    const cards = generateBeardCards(assets, beard("moustache")) as Cards;
    expect(cards.cardCount).toBeGreaterThan(20);
    const { refVerts, weights } = cards.compiled.arrays;
    for (let c = 0; c < cards.cardCount; c++) {
      const v = cards.cardStart[c] as number;
      let m = 0;
      for (let k = 0; k < 3; k++) {
        const b = refVerts[v * 3 + k] as number;
        m += (weights[v * 3 + k] as number) * (parts.moustache[b] as number);
      }
      // Cards root where the mask is solid (`ROOT_SOLID`), a triangle's mean over its corners.
      expect(m).toBeGreaterThan(0.3);
    }
  });

  it("grow as long as the beard, and no longer", () => {
    for (const [b, lo] of [
      [beard("full"), 0.02],
      [beard({ style: "full", length: 0.08 }), 0.06],
      [beard("longstreet"), 0.28],
    ] as const) {
      const cards = generateBeardCards(assets, b) as Cards;
      const longest = Math.max(...cards.growth);
      expect(longest).toBeLessThanOrEqual(b.length + 1e-6);
      expect(longest).toBeGreaterThan(lo);
    }
  });

  it("give long cards more segments, so they can bend", () => {
    const short = generateBeardCards(assets, beard("full")) as Cards;
    const long = generateBeardCards(assets, beard("longstreet")) as Cards;
    const most = (c: Cards) =>
      Math.max(...Array.from({ length: c.cardCount }, (_, i) => ends(c, rest(c), i).vertices));
    expect(most(long)).toBeGreaterThan(most(short) * 2);
  });

  it("let a long beard hang under the chin, outside the body", () => {
    const b = beard("longstreet");
    const cards = generateBeardCards(assets, b) as Cards;
    const p = rest(cards);
    let lowest = Number.POSITIVE_INFINITY;
    for (let c = 0; c < cards.cardCount; c++) lowest = Math.min(lowest, ends(cards, p, c).tip[1]);
    expect(chinY - lowest).toBeGreaterThan(0.2);
    // Nothing past its first centimetre lies inside the body.
    expect(cards.inside).toBeLessThan(0.002);
  });

  it("drape a floor-length beard in short quads that follow the body down", () => {
    const b = beard({ style: "longstreet", length: CHIN });
    const cards = generateBeardCards(assets, b) as Cards;
    const p = rest(cards);
    let longestQuad = 0;
    let lowest = Number.POSITIVE_INFINITY;
    for (let c = 0; c < cards.cardCount; c++) {
      const first = cards.cardStart[c] as number;
      const end = cards.cardStart[c + 1] as number;
      for (let v = first; v + 3 < end; v += 2) {
        const d = [0, 1, 2].map(
          (k) =>
            ((p[(v + 2) * 3 + k] as number) +
              (p[(v + 3) * 3 + k] as number) -
              (p[v * 3 + k] as number) -
              (p[(v + 1) * 3 + k] as number)) /
            2,
        ) as [number, number, number];
        longestQuad = Math.max(longestQuad, Math.hypot(...d));
      }
      lowest = Math.min(lowest, ends(cards, p, c).tip[1]);
    }
    // Quads about DRAPE.segmentLength long (pushing a point off the body can
    // stretch one a little), so the beard bends over chest, belly and thighs.
    expect(longestQuad).toBeLessThan(DRAPE.segmentLength * 2);
    expect(chinY - lowest).toBeGreaterThan(CHIN * 0.8);
    expect(cards.inside).toBeLessThan(0.002);
  });

  it("fork the chin's hair into two points", () => {
    const spreadOf = (fork: number) => {
      const cards = generateBeardCards(assets, beard({ style: "forked", fork })) as Cards;
      const p = rest(cards);
      let sum = 0;
      let n = 0;
      for (let c = 0; c < cards.cardCount; c++) {
        const { tip } = ends(cards, p, c);
        if (tip[1] < chinY - 0.1) {
          sum += Math.abs(tip[0]);
          n++;
        }
      }
      return sum / n;
    };
    expect(spreadOf(1)).toBeGreaterThan(spreadOf(0) + 0.015);
  });

  it("part and sweep the moustache out from the middle", () => {
    const sweep = (part: number) => {
      const cards = generateBeardCards(
        assets,
        beard({ style: "moustache", length: 0.03, part }),
      ) as Cards;
      const p = rest(cards);
      let sum = 0;
      for (let c = 0; c < cards.cardCount; c++) {
        const { root, tip } = ends(cards, p, c);
        sum += (tip[0] - root[0]) * Math.sign(root[0]);
      }
      return sum / cards.cardCount;
    };
    expect(sweep(1)).toBeGreaterThan(sweep(0) + 0.004);
  });

  it("thicken with volume", () => {
    const one = generateBeardCards(assets, beard({ style: "full", volume: 1 })) as Cards;
    const two = generateBeardCards(assets, beard({ style: "full", volume: 2 })) as Cards;
    expect(two.cardCount / one.cardCount).toBeGreaterThan(1.7);
    expect(two.cardCount / one.cardCount).toBeLessThan(2.3);
  });

  it("start at the shortest length worth a card", () => {
    expect(BEARD_CARD_MIN_LENGTH).toBeGreaterThan(0.002);
    expect(
      beardCardSpec(assets, beard({ style: "full", length: BEARD_CARD_MIN_LENGTH * 2 })),
    ).not.toBeNull();
  });
});
