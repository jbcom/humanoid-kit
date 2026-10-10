import { describe, expect, it } from "vitest";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import { skinOf } from "../scripts/lib/detail/contact.ts";
import { type ReservoirRoot, reservoirRoot } from "../scripts/lib/detail/root.ts";
import {
  LEFT_OVER_MEAN,
  measureSac,
  RIGHT_OVER_MEAN,
  SculptedScrotum,
  sacSize,
  scrotumTargets,
  TESTES_KEYS,
  TESTES_SIZE,
  testisDimensions,
} from "../scripts/lib/detail/scrotum.ts";
import { maleParts } from "../scripts/lib/detail/sculpt.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";
import { halfWidths, readSac } from "./sacShape.ts";

/**
 * The scrotum (scripts/lib/detail/scrotum.ts): the CC0 sculpt's sac projected onto
 * the labioscrotal reservoir, sized from the testis volumes and dimensions of the
 * literature (docs/research/ADULT-ANATOMY-DATA.md, section F), with a modelled
 * median raphe between its lobes.
 */
const assets = loadFixtureAssets(true);
const model = new HumanoidModel(assets, { subdivision: 1 });
const lattice = model.adultDetailLattice(AUTHORING_FIGURE);
if (!lattice) throw new Error("no adult surface");
const spec = adultManifest.anatomy?.reservoirs?.find((r) => r.id === "labioscrotal");
if (!spec) throw new Error("no labioscrotal reservoir");
const root: ReservoirRoot = reservoirRoot(lattice, spec);
const parts = maleParts(assets, model.controlShape(AUTHORING_FIGURE).control);
const skin = skinOf(lattice, (adultManifest.anatomy?.reservoirs ?? []).map((r) => r.cap));
const sac = new SculptedScrotum(root, parts.scrotum, skin);

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

describe("the sac's shape", () => {
  it("holds two testes of each key's volume side by side, with their skin: width, depth and hang as sized", () => {
    for (const key of TESTES_KEYS) {
      const got = measureSac(root, sac.shape(key));
      const want = sacSize(key.volume);
      // To half a millimetre: the raphe ties the depth to the width, so each is fitted in turn.
      expect(got.width, `${key.volume} mL width`).toBeCloseTo(want.width, 3);
      expect(got.depth, `${key.volume} mL depth`).toBeCloseTo(want.depth, 3);
      expect(got.hang, `${key.volume} mL hang`).toBeCloseTo(want.hang, 3);
      const t = testisDimensions(key.volume);
      expect(want.width).toBeGreaterThan(2 * t.width);
      expect(want.hang).toBeGreaterThan(t.length);
    }
  });

  it("hangs, and is bigger for a bigger testis", () => {
    let previous = 0;
    for (const key of TESTES_KEYS) {
      const got = measureSac(root, sac.shape(key));
      expect(got.hang).toBeGreaterThan(got.depth);
      expect(got.hang).toBeGreaterThan(previous);
      previous = got.hang;
    }
  });

  it("reads as two lobes with a median raphe: the midline lies in behind both lobes at the front and above them at the bottom", () => {
    for (const key of TESTES_KEYS) {
      const r = readSac(sac.shape(key), root.centre[0]);
      expect(r.front, `${key.volume} mL front`).toBeGreaterThan(0.0015);
      expect(r.bottom, `${key.volume} mL bottom`).toBeGreaterThan(0);
    }
    const mean = readSac(sac.shape(TESTES_KEYS[1] as (typeof TESTES_KEYS)[number]), root.centre[0]);
    expect(mean.front).toBeGreaterThan(0.0025);
    expect(mean.bottom).toBeGreaterThan(0.0004);
  });

  it("is larger on the right (x negative, the figure faces +z) by the measured volumes", () => {
    for (const key of TESTES_KEYS) {
      const { left, right } = halfWidths(sac.shape(key), root.centre[0]);
      expect(right, `${key.volume} mL`).toBeGreaterThan(left);
    }
  });

  it("has only finite positions, at every key", () => {
    for (const key of TESTES_KEYS)
      for (const p of sac.shape(key)) expect(p.every(Number.isFinite)).toBe(true);
  });
});

describe("the pack's testes", () => {
  const detail = adultManifest.anatomy?.detail;

  it("names a target per key, each driven by the size alone and on the lattice they were authored on", () => {
    const made = scrotumTargets(root, parts.scrotum, skin);
    expect(made.targets).toHaveLength(TESTES_KEYS.length);
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
      const generated = span(sac.shape(key));
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
