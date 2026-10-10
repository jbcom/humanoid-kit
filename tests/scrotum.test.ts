import { describe, expect, it } from "vitest";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import { type ReservoirRoot, type RootShape, reservoirRoot } from "../scripts/lib/detail/root.ts";
import {
  LEFT_OVER_MEAN,
  lobeShape,
  RIGHT_OVER_MEAN,
  scrotumTargets,
  TESTES_KEYS,
  TESTES_SIZE,
  testisDimensions,
} from "../scripts/lib/detail/scrotum.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

/**
 * The scrotal lobes and testes (scripts/lib/detail/scrotum.ts), drawn out of the
 * labioscrotal pair of reservoirs and sized from the testis volumes and
 * dimensions of the literature (docs/research/ADULT-ANATOMY-DATA.md, section F).
 */
const assets = loadFixtureAssets(true);
const model = new HumanoidModel(assets, { subdivision: 1 });
const lattice = model.adultDetailLattice(AUTHORING_FIGURE);
if (!lattice) throw new Error("no adult surface");
const rootOf = (id: string): ReservoirRoot => {
  const spec = adultManifest.anatomy?.reservoirs?.find((r) => r.id === id);
  if (!spec) throw new Error(`no reservoir ${id}`);
  return reservoirRoot(lattice, spec);
};
/** The reservoir with x negative: the figure faces +z, so that is its right side. */
const negative = rootOf("labioscrotal-left");
const positive = rootOf("labioscrotal-right");

/** Extent (hi - lo) per axis of a set of points. */
function span(points: Iterable<readonly number[]>): number[] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k] as number, p[k] as number);
      hi[k] = Math.max(hi[k] as number, p[k] as number);
    }
  return lo.map((l, k) => (hi[k] as number) - l);
}
const centroid = (shape: RootShape) =>
  [0, 1, 2].map((k) => shape.reduce((s, p) => s + (p[k] as number), 0) / shape.length);

describe("a testis against the literature", () => {
  it("has the volume it was sized for, by the formula the volumes were measured with", () => {
    for (const key of TESTES_KEYS) {
      const d = testisDimensions(key.volume);
      expect(0.52 * d.length * d.width * d.depth * 1e6).toBeCloseTo(key.volume, 6);
    }
  });

  it("has the proportions of the one full-text dimensions: 37.5 x 19.0 x 22.0 mm", () => {
    const d = testisDimensions(8.151);
    expect(d.length / d.width).toBeCloseTo(37.5 / 19, 9);
    expect(d.depth / d.width).toBeCloseTo(22 / 19, 9);
    // At the volume those dimensions give by the formula (0.52 x 37.5 x 19.0 x 22.0 = 8.151 mL)
    // the dimensions are theirs.
    expect(d.length * 1000).toBeCloseTo(37.5, 1);
    expect(d.width * 1000).toBeCloseTo(19, 1);
  });

  it("is the European mean at the middle key, and the right is larger than the left (17.9 and 16.5)", () => {
    expect(TESTES_KEYS[1]?.volume).toBe(17.2);
    expect(RIGHT_OVER_MEAN * 17.2).toBeCloseTo(17.9, 6);
    expect(LEFT_OVER_MEAN * 17.2).toBeCloseTo(16.5, 6);
    expect(RIGHT_OVER_MEAN).toBeGreaterThan(LEFT_OVER_MEAN);
  });
});

describe("the lobes' shape", () => {
  it("hangs: taller than it is wide or deep, and bigger for a bigger testis", () => {
    let previous = 0;
    for (const key of TESTES_KEYS) {
      const [width, height, depth] = span(lobeShape(negative, key.volume)) as [
        number,
        number,
        number,
      ];
      expect(height).toBeGreaterThan(width);
      expect(height).toBeGreaterThan(depth);
      expect(height).toBeGreaterThan(previous);
      previous = height;
    }
  });

  it("holds a sac of the testis' size and skin: at least its width and length across the widest ring", () => {
    const key = TESTES_KEYS[1];
    if (!key) throw new Error("no key");
    const d = testisDimensions(key.volume);
    const [width, height] = span(lobeShape(negative, key.volume)) as [number, number, number];
    // The lobe's width reaches past the testis' width (skin), and its height past its length plus the neck.
    expect(width).toBeGreaterThan(d.width);
    expect(height).toBeGreaterThan(d.length);
  });

  it("keeps each lobe on its own side of the midline, and the pair apart by more than their roots are", () => {
    // The root's skin faces the midline, so a lobe leaves it inward and turns down; the lean
    // keeps the pair from collapsing onto one another (they overlap a little, as a bilobed sac does).
    for (const key of TESTES_KEYS) {
      const [rightCentroid, leftCentroid] = [negative, positive].map((root) =>
        centroid(lobeShape(root, key.volume)),
      );
      expect(rightCentroid?.[0]).toBeLessThan(0);
      expect(leftCentroid?.[0]).toBeGreaterThan(0);
      const apart = (leftCentroid?.[0] as number) - (rightCentroid?.[0] as number);
      expect(apart, `volume ${key.volume}`).toBeGreaterThan(0.015);
    }
  });

  it("is a mirror image across the midline at equal volume", () => {
    const key = TESTES_KEYS[1] as (typeof TESTES_KEYS)[number];
    const a = lobeShape(negative, key.volume);
    const b = lobeShape(positive, key.volume);
    const ca = centroid(a);
    const cb = centroid(b);
    expect(ca[0]).toBeCloseTo(-(cb[0] as number), 3);
    expect(ca[1]).toBeCloseTo(cb[1] as number, 3);
    expect(ca[2]).toBeCloseTo(cb[2] as number, 3);
    const sa = span(a);
    const sb = span(b);
    for (let k = 0; k < 3; k++) expect(sa[k]).toBeCloseTo(sb[k] as number, 3);
  });

  it("has only finite positions, at every key", () => {
    for (const key of TESTES_KEYS)
      for (const root of [negative, positive])
        for (const p of lobeShape(root, key.volume)) expect(p.every(Number.isFinite)).toBe(true);
  });
});

describe("the pack's testes", () => {
  const detail = adultManifest.anatomy?.detail;

  it("names a target per key and side, each driven by the size alone and on the lattice they were authored on", () => {
    const made = scrotumTargets([negative, positive]);
    expect(made.targets).toHaveLength(TESTES_KEYS.length * 2);
    for (const t of made.targets) {
      expect(detail?.targets).toContain(t.name);
      expect(detail?.drives?.[t.name]).toEqual(made.drives[t.name]);
      expect(made.drives[t.name]?.every((f) => f.startsWith(`ramp:${TESTES_SIZE}:`))).toBe(true);
    }
    expect(detail?.surfaceKey).toBe(lattice.key);
  });

  it("has a size that is adult-only, one-sided and has no target of its own", () => {
    const m = adultManifest.modifiers.find((x) => x.id === TESTES_SIZE);
    expect(m?.adultOnly).toBe(true);
    expect(m?.lo).toBeNull();
    expect(m?.hi).toBe("");
  });
});

describe("the testes on the adult surface", { timeout: 300_000 }, () => {
  const figure = (modifiers: Record<string, number> = {}) =>
    createRecipe({ macros: AUTHORING_FIGURE.macros, modifiers });
  const rest = model.evaluate(figure()).positions;
  const moved = (positions: Float32Array) => {
    const out: number[][] = [];
    for (let v = 0; v < positions.length / 3; v++) {
      let did = false;
      for (let k = 0; k < 3; k++)
        if (Math.abs((positions[v * 3 + k] as number) - (rest[v * 3 + k] as number)) > 1e-7)
          did = true;
      if (did) out.push([0, 1, 2].map((k) => positions[v * 3 + k] as number));
    }
    return out;
  };

  it("draws nothing at size 0", () => {
    expect(moved(model.evaluate(figure()).positions)).toHaveLength(0);
  });

  it("is the generator's shape at each key's size: the pipeline keeps what was authored", () => {
    for (const key of TESTES_KEYS) {
      const surface = span(moved(model.evaluate(figure({ [TESTES_SIZE]: key.size })).positions));
      const generated = span([
        ...lobeShape(negative, key.volume * RIGHT_OVER_MEAN),
        ...lobeShape(positive, key.volume * LEFT_OVER_MEAN),
      ]);
      for (let k = 0; k < 3; k++)
        expect(surface[k], `axis ${k}`).toBeCloseTo(generated[k] as number, 3);
    }
  });

  it("grows with the size, without a jump at a key", () => {
    let prev = 0;
    for (let s = 0.05; s <= 1.0001; s += 0.05) {
      const height = span(
        moved(model.evaluate(figure({ [TESTES_SIZE]: s })).positions),
      )[1] as number;
      expect(height, `size ${s}`).toBeGreaterThanOrEqual(prev - 5e-4);
      prev = height;
    }
  });

  it("does not answer the arousal signal: its change is unmeasured, so the sac holds still", () => {
    const sac = figure({ [TESTES_SIZE]: 0.6 });
    expect(Array.from(model.evaluate(sac, { arousal: 1 }).positions)).toEqual(
      Array.from(model.evaluate(sac).positions),
    );
  });

  it("is refused under 18", () => {
    const minor = createRecipe({
      macros: { ...AUTHORING_FIGURE.macros, age: 15 },
      modifiers: { [TESTES_SIZE]: 0.6 },
    });
    expect(() => model.evaluate(minor)).toThrow(AgePolicyError);
  });
});
