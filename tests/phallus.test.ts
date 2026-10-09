import { describe, expect, it } from "vitest";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import {
  ERECT_ANGLE,
  ERECT_GIRTH,
  ERECT_LENGTH,
  GIRTH_RANGE,
  keyShape,
  LENGTH_RANGE,
  PHALLUS_GIRTH,
  PHALLUS_KEYS,
  PHALLUS_LENGTH,
  PHALLUS_SIZE,
  phallusGeometry,
  phallusTargets,
  type Variation,
} from "../scripts/lib/detail/phallus.ts";
import { type ReservoirRoot, type RootShape, reservoirRoot } from "../scripts/lib/detail/root.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

/**
 * The phallic organ (scripts/lib/detail/phallus.ts): authored from the
 * reservoir's loop and the measured length, girth and growth of the literature
 * (docs/research/ADULT-ANATOMY-DATA.md, section F). The generator's shapes are
 * measured against those numbers, and the surface a figure gets is held to the
 * generator's shape for every variant it can ask for.
 */
const assets = loadFixtureAssets(true);
const model = new HumanoidModel(assets, { subdivision: 1 });
const lattice = model.adultDetailLattice(AUTHORING_FIGURE);
if (!lattice) throw new Error("no adult surface");
const spec = adultManifest.anatomy?.reservoirs?.find((r) => r.id === "phallic");
if (!spec) throw new Error("no phallic reservoir");
const root: ReservoirRoot = reservoirRoot(lattice, spec);
const LOOP = root.loop.length;

/** The perimeter of ring `j` (1-based) of a shape, metres. */
function ringPerimeter(shape: RootShape, j: number): number {
  let sum = 0;
  for (let i = 0; i < LOOP; i++) {
    const a = shape[root.cap.length + (j - 1) * LOOP + i] as readonly number[];
    const b = shape[root.cap.length + (j - 1) * LOOP + ((i + 1) % LOOP)] as readonly number[];
    sum += Math.hypot(
      (a[0] as number) - (b[0] as number),
      (a[1] as number) - (b[1] as number),
      (a[2] as number) - (b[2] as number),
    );
  }
  return sum;
}

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

const DEFAULT = PHALLUS_KEYS[2];
if (!DEFAULT) throw new Error("no default key");

describe("the organ's shape against the literature", () => {
  const flaccid = phallusGeometry(root, {
    length: DEFAULT.length,
    measure: DEFAULT.measure,
    radius: DEFAULT.circumference / (2 * Math.PI),
    angle: (DEFAULT.hang * Math.PI) / 180,
  });
  const erect = phallusGeometry(root, {
    length: DEFAULT.length * ERECT_LENGTH,
    measure: DEFAULT.measure,
    radius: (DEFAULT.circumference * ERECT_GIRTH) / (2 * Math.PI),
    angle: (ERECT_ANGLE * Math.PI) / 180,
  });
  /** A ring on the shaft: past the root's flare, before the glans. */
  const SHAFT_RING = Math.round(root.rings * 0.45);

  it("is as long as the default key says: Veale's pooled flaccid length, 9.16 cm, along the top", () => {
    expect(flaccid.dorsal).toBeCloseTo(0.0916, 6);
    expect(flaccid.axial).toBeLessThan(flaccid.dorsal);
    expect(flaccid.axial).toBeGreaterThan(0.05);
  });

  it("is as round as the default key says: Veale's pooled flaccid circumference, 9.31 cm", () => {
    // A 44-sided ring is a hair short of its circle.
    expect(ringPerimeter(flaccid.shape, SHAFT_RING)).toBeCloseTo(0.0931 * 0.9991, 3);
  });

  it("erects by the measured growth: length +43% and circumference +25% (13.12 / 9.16, 11.66 / 9.31)", () => {
    expect(erect.dorsal / flaccid.dorsal).toBeCloseTo(13.12 / 9.16, 5);
    expect(
      ringPerimeter(erect.shape, SHAFT_RING) / ringPerimeter(flaccid.shape, SHAFT_RING),
    ).toBeCloseTo(11.66 / 9.31, 2);
  });

  it("rises when erect and hangs when flaccid", () => {
    const tipAt = (shape: RootShape) => {
      // The cap vertex farthest from the root along the organ.
      let best = shape[0] as readonly number[];
      let far = 0;
      for (let k = 0; k < root.cap.length; k++) {
        const p = shape[k] as readonly number[];
        const d = Math.hypot((p[1] as number) - root.centre[1], (p[2] as number) - root.centre[2]);
        if (d > far) {
          far = d;
          best = p;
        }
      }
      return best;
    };
    const f = tipAt(flaccid.shape);
    const e = tipAt(erect.shape);
    expect(f[1] as number).toBeLessThan(root.centre[1] - 0.05);
    expect(e[1] as number).toBeGreaterThan(root.centre[1]);
    expect(e[2] as number).toBeGreaterThan(f[2] as number);
  });

  it("grows with size through the keys, in length and in girth", () => {
    const keys = PHALLUS_KEYS.map((key) => {
      const g = phallusGeometry(root, {
        length: key.length,
        measure: key.measure,
        radius: key.circumference / (2 * Math.PI),
        angle: (key.hang * Math.PI) / 180,
      });
      return { dorsal: g.dorsal, axial: g.axial, girth: ringPerimeter(g.shape, 8) };
    });
    for (let k = 1; k < keys.length; k++) {
      expect((keys[k] as { axial: number }).axial).toBeGreaterThan(
        (keys[k - 1] as { axial: number }).axial,
      );
      expect((keys[k] as { girth: number }).girth).toBeGreaterThan(
        (keys[k - 1] as { girth: number }).girth,
      );
    }
  });

  it("has only finite positions, for every key and variation", () => {
    for (const key of PHALLUS_KEYS)
      for (const v of [
        {},
        { state: 0.5 },
        { state: 1 },
        { length: 1 + LENGTH_RANGE },
        { girth: 1 - GIRTH_RANGE, state: 1 },
      ])
        for (const p of keyShape(root, key, v)) expect(p.every(Number.isFinite)).toBe(true);
  });

  it("keeps the loop where the skin is: a ring's first vertices stay near the root", () => {
    // Ring 1 is a sliver off the loop, not a jump.
    const g = flaccid.shape;
    for (let i = 0; i < LOOP; i++) {
      const p = g[root.cap.length + i] as readonly number[];
      const q = root.loop[i] as readonly number[];
      expect(Math.hypot(...[0, 1, 2].map((k) => (p[k] as number) - (q[k] as number)))).toBeLessThan(
        0.012,
      );
    }
  });
});

describe("the pack's organ", () => {
  const detail = adultManifest.anatomy?.detail;

  it("names its targets, all driven, on the lattice they were authored on", () => {
    if (!detail) throw new Error("the pack has no detail");
    expect(detail.surfaceKey).toBe(lattice.key);
    expect(Object.keys(detail.drives ?? {}).sort()).toEqual([...detail.targets].sort());
    expect(detail.targets).toEqual(phallusTargets(root).targets.map((t) => t.name));
  });

  it("is read by the arousal signal and by nothing in the body's own state morphs", () => {
    expect(adultManifest.anatomy?.stateMorphs).toEqual([]);
    const erectDrives = Object.entries(detail?.drives ?? {}).filter(([, f]) =>
      f.some((x) => x.startsWith("sramp:arousal:")),
    );
    expect(erectDrives.length).toBeGreaterThan(0);
    for (const [name] of erectDrives) expect(name).toMatch(/-(mid|erect)$/);
    // Every key that erects is drawn at both states, with its variations.
    const erecting = PHALLUS_KEYS.filter((k) => k.erects).length;
    expect(erectDrives.length).toBe(erecting * 2 * 5);
  });

  it("offers a size, a length and a girth, all adult-only and none with a target of its own", () => {
    for (const id of [PHALLUS_SIZE, PHALLUS_LENGTH, PHALLUS_GIRTH]) {
      const m = adultManifest.modifiers.find((x) => x.id === id);
      expect(m, id).toBeDefined();
      expect(m?.adultOnly).toBe(true);
      expect(m?.hi).toBe("");
      expect(m?.lo === null || m?.lo === "").toBe(true);
    }
  });
});

describe("the organ on the adult surface", { timeout: 300_000 }, () => {
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
  const surfaceSpan = (modifiers: Record<string, number>, signals: Record<string, number> = {}) =>
    span(moved(model.evaluate(figure(modifiers), signals).positions));
  const generated = (key: number, v: Variation) =>
    span(keyShape(root, PHALLUS_KEYS[key] as (typeof PHALLUS_KEYS)[number], v));
  const near = (a: number[], b: number[]) => {
    for (let k = 0; k < 3; k++) expect(a[k], `axis ${k}`).toBeCloseTo(b[k] as number, 3);
  };

  it("draws nothing at size 0, whatever the length, girth or arousal", () => {
    expect(moved(model.evaluate(figure()).positions)).toHaveLength(0);
    expect(
      moved(
        model.evaluate(figure({ [PHALLUS_LENGTH]: 1, [PHALLUS_GIRTH]: -1 }), { arousal: 1 })
          .positions,
      ),
    ).toHaveLength(0);
  });

  it("is the generator's shape at each key's size: the pipeline keeps what was authored", () => {
    PHALLUS_KEYS.forEach((key, k) => {
      near(surfaceSpan({ [PHALLUS_SIZE]: key.size }), generated(k, {}));
    });
  });

  it("is the generator's shape for every variation a key offers, erect ones too", () => {
    const k = 2;
    const size = { [PHALLUS_SIZE]: (PHALLUS_KEYS[k] as { size: number }).size };
    near(surfaceSpan({ ...size, [PHALLUS_LENGTH]: 1 }), generated(k, { length: 1 + LENGTH_RANGE }));
    near(
      surfaceSpan({ ...size, [PHALLUS_LENGTH]: -1 }),
      generated(k, { length: 1 - LENGTH_RANGE }),
    );
    near(surfaceSpan({ ...size, [PHALLUS_GIRTH]: 1 }), generated(k, { girth: 1 + GIRTH_RANGE }));
    near(surfaceSpan({ ...size, [PHALLUS_GIRTH]: -1 }), generated(k, { girth: 1 - GIRTH_RANGE }));
    // The states it erects through: midway and erect, each drawn, with their variations.
    for (const [arousal, state] of [
      [0.5, 0.5],
      [1, 1],
    ] as const) {
      near(surfaceSpan(size, { arousal }), generated(k, { state }));
      near(
        surfaceSpan({ ...size, [PHALLUS_LENGTH]: 1 }, { arousal }),
        generated(k, { length: 1 + LENGTH_RANGE, state }),
      );
      near(
        surfaceSpan({ ...size, [PHALLUS_GIRTH]: -1 }, { arousal }),
        generated(k, { girth: 1 - GIRTH_RANGE, state }),
      );
    }
  });

  it("erects through its midpoint: between two drawn states a vertex is halfway, and the tube never shortens", () => {
    const size = { [PHALLUS_SIZE]: 0.65 };
    const at = (arousal: number) => model.evaluate(figure(size), { arousal }).positions;
    const tipVertex = (() => {
      const p = at(1);
      let best = 0;
      for (let v = 1; v < p.length / 3; v++)
        if (
          Math.abs((p[v * 3 + 2] as number) - (rest[v * 3 + 2] as number)) >
          Math.abs((p[best * 3 + 2] as number) - (rest[best * 3 + 2] as number))
        )
          best = v;
      return best;
    })();
    const point = (arousal: number) =>
      [0, 1, 2].map((k) => at(arousal)[tipVertex * 3 + k] as number);
    const [a0, a25, a50, a75, a100] = [0, 0.25, 0.5, 0.75, 1].map(point);
    for (let k = 0; k < 3; k++) {
      expect(a25?.[k]).toBeCloseTo(((a0?.[k] as number) + (a50?.[k] as number)) / 2, 5);
      expect(a75?.[k]).toBeCloseTo(((a50?.[k] as number) + (a100?.[k] as number)) / 2, 5);
    }
    // The distance of that vertex from the root keeps growing: the swing is not a shortening.
    const away = (p: number[] | undefined) =>
      Math.hypot(...[0, 1, 2].map((k) => (p?.[k] as number) - (rest[tipVertex * 3 + k] as number)));
    const reaches = [a0, a25, a50, a75, a100].map(away);
    for (let i = 1; i < reaches.length; i++)
      expect(reaches[i] as number, `step ${i}`).toBeGreaterThan(reaches[i - 1] as number);
  });

  it("holds still for a phallus below the first erecting key", () => {
    // A phallus smaller than the first erecting key has no erect state: it holds still.
    const small = { [PHALLUS_SIZE]: (PHALLUS_KEYS[0] as { size: number }).size };
    const a = moved(model.evaluate(figure(small)).positions);
    const b = moved(model.evaluate(figure(small), { arousal: 1 }).positions);
    expect(b).toEqual(a);
  });

  it("grows smoothly between keys: more size is further out, with no jump at a key", () => {
    // How far the organ reaches down: its height from top to bottom.
    const reach = (size: number) => surfaceSpan({ [PHALLUS_SIZE]: size })[1] as number;
    let prev = 0;
    for (let s = 0.04; s <= 1.0001; s += 0.04) {
      const r = reach(s);
      // A nub on its skirt may thin by a fraction of a millimetre as it grows; it never shrinks more.
      expect(r, `size ${s}`).toBeGreaterThanOrEqual(prev - 5e-4);
      prev = r;
    }
  });

  it("refuses every one of these controls under 18, and the signal too", () => {
    const minor = (modifiers: Record<string, number>) =>
      createRecipe({ macros: { ...AUTHORING_FIGURE.macros, age: 15 }, modifiers });
    for (const id of [PHALLUS_SIZE, PHALLUS_LENGTH, PHALLUS_GIRTH])
      expect(() => model.evaluate(minor({ [id]: 0.5 })), id).toThrow(AgePolicyError);
    expect(() => model.evaluate(minor({}), { arousal: 1 })).toThrow(AgePolicyError);
  });
});
