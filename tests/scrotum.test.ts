import { describe, expect, it } from "vitest";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import { skinOf } from "../scripts/lib/detail/contact.ts";
import { PHALLUS_SIZE } from "../scripts/lib/detail/phallus.ts";
import { type ReservoirRoot, reservoirRoot } from "../scripts/lib/detail/root.ts";
import {
  measureSac,
  SculptedScrotum,
  SKIN,
  sacSize,
  scrotumTargets,
  TESTES_KEYS,
  TESTES_SIZE,
  testisDimensions,
} from "../scripts/lib/detail/scrotum.ts";
import { type MaleParts, maleParts } from "../scripts/lib/detail/sculpt.ts";
import { sculptsForTests } from "../scripts/lib/detail/sculptSources.ts";
import { fairCap } from "../scripts/lib/detail/transfer.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadFixtureAssets, loadOrganOnlyAssets } from "./fixtures.ts";
import { readSac } from "./sacShape.ts";

// The sculpts are not committed. The default run is hermetic (no network, no Blender), so
// what needs their real geometry skips, counted by the skip ledger, unless the verified
// cache is there (`pnpm test:adult-sculpts`, which makes a missing cache a failure).
const real = sculptsForTests();

/**
 * The scrotum (scripts/lib/detail/scrotum.ts): the CC0 sculpt's sac, with its own
 * two lobes and median raphe, projected onto the labioscrotal reservoir and scaled
 * evenly to the width of two testes of the literature's volumes
 * (docs/research/ADULT-ANATOMY-DATA.md, section F).
 */
const assets = loadFixtureAssets(true);
const model = new HumanoidModel(assets, { subdivision: 1 });
const lattice = model.adultDetailLattice(AUTHORING_FIGURE);
if (!lattice) throw new Error("no adult surface");
const spec = adultManifest.anatomy?.reservoirs?.find((r) => r.id === "labioscrotal");
if (!spec) throw new Error("no labioscrotal reservoir");
const root: ReservoirRoot = reservoirRoot(lattice, spec);
// `parts` and `sac` are read only by what is gated on `real`.
const parts = (
  real ? maleParts(assets, model.controlShape(AUTHORING_FIGURE).control) : undefined
) as MaleParts;
const skin = skinOf(
  lattice,
  (adultManifest.anatomy?.reservoirs ?? []).map((r) => r.cap),
);
const sac = (real ? new SculptedScrotum(root, parts.scrotum, skin) : undefined) as SculptedScrotum;

type Point = readonly [number, number, number];
type Triangle = readonly [number, number, number];

const pointAt = (positions: ArrayLike<number>, vertex: number): Point => [
  positions[vertex * 3] as number,
  positions[vertex * 3 + 1] as number,
  positions[vertex * 3 + 2] as number,
];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Whether any edge of `edges` passes through the strict interior of `triangle`. */
function edgesCross(edges: readonly Point[], triangle: readonly Point[]): boolean {
  const [t0, t1, t2] = triangle as [Point, Point, Point];
  const e1 = subtract(t1, t0);
  const e2 = subtract(t2, t0);
  for (let k = 0; k < 3; k++) {
    const origin = edges[k] as Point;
    const direction = subtract(edges[(k + 1) % 3] as Point, origin);
    const h = cross(direction, e2);
    const determinant = dot(e1, h);
    if (Math.abs(determinant) < 1e-14) continue;
    const toOrigin = subtract(origin, t0);
    const u = dot(toOrigin, h) / determinant;
    if (u <= 1e-6 || u >= 1 - 1e-6) continue;
    const q = cross(toOrigin, e1);
    const v = dot(direction, q) / determinant;
    if (v <= 1e-6 || u + v >= 1 - 1e-6) continue;
    const distance = dot(e2, q) / determinant;
    if (distance > 1e-6 && distance < 1 - 1e-6) return true;
  }
  return false;
}

/** Pairs of triangles with no shared vertex that cross through one another. */
function crossingPairs(positions: ArrayLike<number>, triangles: readonly Triangle[]): number {
  const cell = 0.004;
  const grid = new Map<string, number[]>();
  const cells = (triangle: Triangle) => {
    const points = triangle.map((vertex) => pointAt(positions, vertex));
    const lo = [0, 1, 2].map((axis) =>
      Math.floor(Math.min(...points.map((point) => point[axis] as number)) / cell),
    );
    const hi = [0, 1, 2].map((axis) =>
      Math.floor(Math.max(...points.map((point) => point[axis] as number)) / cell),
    );
    const out: string[] = [];
    for (let x = lo[0] as number; x <= (hi[0] as number); x++)
      for (let y = lo[1] as number; y <= (hi[1] as number); y++)
        for (let z = lo[2] as number; z <= (hi[2] as number); z++) out.push(`${x},${y},${z}`);
    return out;
  };
  triangles.forEach((triangle, index) => {
    for (const cell of cells(triangle)) {
      const here = grid.get(cell) ?? [];
      here.push(index);
      grid.set(cell, here);
    }
  });
  const tested = new Set<string>();
  let crossings = 0;
  triangles.forEach((a) => {
    const candidates = new Set<number>();
    for (const cell of cells(a))
      for (const candidate of grid.get(cell) ?? []) candidates.add(candidate);
    for (const candidate of candidates) {
      const b = triangles[candidate] as Triangle;
      if (a.some((vertex) => b.includes(vertex))) continue;
      const key = [...a, ...b].sort((left, right) => left - right).join(",");
      if (tested.has(key)) continue;
      tested.add(key);
      const from = a.map((vertex) => pointAt(positions, vertex));
      const through = b.map((vertex) => pointAt(positions, vertex));
      if (edgesCross(from, through) || edgesCross(through, from)) crossings++;
    }
  });
  return crossings;
}

function capTriangles(root: ReservoirRoot): Triangle[] {
  const cap = root.cap.length;
  const ring = (corner: { loop: number } | { cap: number }) =>
    "loop" in corner ? cap + (root.rings - 1) * root.loop.length + corner.loop : corner.cap;
  const triangles: Triangle[] = [];
  for (const polygon of root.capPolygons)
    for (let corner = 1; corner + 1 < polygon.length; corner++)
      triangles.push([
        ring(polygon[0] as { loop: number } | { cap: number }),
        ring(polygon[corner] as { loop: number } | { cap: number }),
        ring(polygon[corner + 1] as { loop: number } | { cap: number }),
      ]);
  return triangles;
}

const maxDisplacement = (from: readonly Point[], to: readonly Point[]) =>
  Math.max(
    ...from.map((point, index) => {
      const moved = to[index] as Point;
      return Math.hypot(moved[0] - point[0], moved[1] - point[1], moved[2] - point[2]);
    }),
  );

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

  it("is the European mean at the middle key", () => {
    expect(TESTES_KEYS[1]?.volume).toBe(17.2);
  });
});

describe.skipIf(!real)("the sac's shape", () => {
  it("fairs only connected cap interior samples, retaining the source and ring bytes", () => {
    const source = Float64Array.from(parts.scrotum.positions);
    new SculptedScrotum(root, parts.scrotum, skin);
    expect(parts.scrotum.positions).toEqual(source);

    const transferred = sac.projected;
    const fair = fairCap(root, transferred);
    expect(fair.slice(root.cap.length)).toEqual(transferred.slice(root.cap.length));
    // The calibrated cap correction moves its source-derived samples by under half a millimetre.
    expect(
      maxDisplacement(transferred.slice(0, root.cap.length), fair.slice(0, root.cap.length)),
    ).toBeLessThan(0.0005);

    const isolated: ReservoirRoot = {
      ...root,
      cap: [root.cap[0] as (typeof root.cap)[number]],
      capPolygons: [],
    };
    const one = [[0.1, 0.2, 0.3] as const, ...transferred.slice(1)];
    expect(fairCap(isolated, one)).toEqual(one);
  });

  it("keeps the clean CC0 source cap from crossing after transfer and placement", () => {
    const sourceTriangles: Triangle[] = [];
    for (let i = 0; i < parts.scrotum.triangles.length; i += 3)
      sourceTriangles.push([
        parts.scrotum.triangles[i] as number,
        parts.scrotum.triangles[i + 1] as number,
        parts.scrotum.triangles[i + 2] as number,
      ]);
    expect(crossingPairs(parts.scrotum.positions, sourceTriangles), "CC0 source").toBe(0);
    const triangles = capTriangles(root);
    for (const key of TESTES_KEYS)
      expect(crossingPairs(sac.shape(key).flat(), triangles), `${key.volume} mL cap`).toBe(0);
  });

  it("is as wide as two testes of each key's volume side by side, with their skin", () => {
    for (const key of TESTES_KEYS) {
      const got = measureSac(root, sac.shape(key));
      const want = sacSize(key.volume);
      const testis = testisDimensions(key.volume);
      const hold = testis.length + 2 * SKIN;
      // Exactly that wide, unless the sculpt's hang at that width could not hold a testis
      // and the sac was grown to: then wider, by that growth and no more than a few per cent.
      if (measureSac(root, sac.shape(key)).hang > hold * (1 + 1e-6))
        expect(got.width, `${key.volume} mL width`).toBeCloseTo(want.width, 5);
      else {
        expect(got.width, `${key.volume} mL width`).toBeGreaterThan(want.width);
        expect(got.width / want.width, `${key.volume} mL width`).toBeLessThan(1.05);
      }
      expect(want.width).toBeGreaterThan(2 * testis.width);
    }
  });

  it("is deep and long enough for its testes at that width: the sculpt's proportions hold them", () => {
    // Scaled evenly, the depth and hang are the sculpt's. Each must hold one testis with
    // skin round it: the hang at least the testis's length with skin at both ends (the
    // neck above it is the sculpt's own; sacSize's NECK is a modelled choice, not a
    // measure to hold the sculpt to). Neither is more than half as much again as sacSize.
    for (const key of TESTES_KEYS) {
      const got = measureSac(root, sac.shape(key));
      const want = sacSize(key.volume);
      const testis = testisDimensions(key.volume);
      expect(got.depth / want.depth, `${key.volume} mL depth`).toBeGreaterThan(0.85);
      expect(got.depth / want.depth, `${key.volume} mL depth`).toBeLessThan(1.5);
      // Sizing grows a sac to exactly hold its testis where the sculpt is short: to the solve's tolerance.
      expect(got.hang, `${key.volume} mL hang`).toBeGreaterThan(
        (testis.length + 2 * SKIN) * (1 - 1e-6),
      );
      expect(got.hang / want.hang, `${key.volume} mL hang`).toBeLessThan(1.5);
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

  it("has only finite positions, at every key", () => {
    for (const key of TESTES_KEYS)
      for (const p of sac.shape(key)) expect(p.every(Number.isFinite)).toBe(true);
  });
});

describe("the pack's testes", () => {
  const detail = adultManifest.anatomy?.detail;

  it.skipIf(!real)(
    "names a target per key, each driven by the size alone and on the lattice they were authored on",
    () => {
      const made = scrotumTargets(root, parts.scrotum, skin);
      // A key's shape for each key, and the reservoir laid flat that the smallest grows from.
      expect(made.targets).toHaveLength(TESTES_KEYS.length + 1);
      for (const t of made.targets) {
        expect(detail?.targets).toContain(t.name);
        expect(detail?.drives?.[t.name]).toEqual(made.drives[t.name]);
        expect(made.drives[t.name]?.every((f) => f.startsWith(`ramp:${TESTES_SIZE}:`))).toBe(true);
      }
      expect(detail?.surfaceKey).toBe(lattice.key);
    },
  );

  it("has a size that is adult-only, one-sided and has no target of its own", () => {
    const m = adultManifest.modifiers.find((x) => x.id === TESTES_SIZE);
    expect(m?.adultOnly).toBe(true);
    expect(m?.lo).toBeNull();
    expect(m?.hi).toBe("");
  });
});

describe("the testes on the adult surface", { timeout: 300_000 }, () => {
  // No testes and no organ unless asked for: left unset, an adult takes the pack's default
  // anatomy for its gender (`AdultAnatomySpec.defaults`).
  const figure = (modifiers: Record<string, number> = {}) =>
    createRecipe({
      macros: AUTHORING_FIGURE.macros,
      modifiers: { [TESTES_SIZE]: 0, [PHALLUS_SIZE]: 0, ...modifiers },
    });
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

  it.skipIf(!real)(
    "is the generator's shape at each key's size: the pipeline keeps what was authored",
    () => {
      for (const key of TESTES_KEYS) {
        const surface = span(moved(model.evaluate(figure({ [TESTES_SIZE]: key.size })).positions));
        const generated = span(sac.shape(key));
        for (let k = 0; k < 3; k++)
          expect(surface[k], `axis ${k}`).toBeCloseTo(generated[k] as number, 3);
      }
    },
  );

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

  it.skipIf(!real)(
    "keeps the sculpt's notch between the lobes on every body, at the sculpt's share of the sac's width",
    () => {
      // The midline's lowest point above the lobes', over the width across the figure. On
      // the man the drawn sac read 16.6% against the sculpt's 10.9%: its delta was added to
      // the man's own skin under the sac, which his body shape moves off his loop's by up
      // to 3.6 mm, and the notch deepened by as much.
      const notch = (points: readonly (readonly number[])[]) => {
        const xs = points.map((p) => p[0] as number);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const width = Math.max(...xs) - Math.min(...xs);
        const lowest = Math.min(...points.map((p) => p[1] as number));
        const mid = Math.min(
          ...points
            .filter((p) => Math.abs((p[0] as number) - cx) <= 0.003)
            .map((p) => p[1] as number),
        );
        return (mid - lowest) / width;
      };
      const sculpt: number[][] = [];
      for (let i = 0; i < parts.scrotum.positions.length; i += 3)
        sculpt.push(Array.from(parts.scrotum.positions.subarray(i, i + 3)));
      const drawnNotch = (macros: typeof AUTHORING_FIGURE.macros) => {
        const bare = createRecipe({ macros, modifiers: { [TESTES_SIZE]: 0, [PHALLUS_SIZE]: 0 } });
        const drawn = createRecipe({
          macros,
          modifiers: { [TESTES_SIZE]: 0.6, [PHALLUS_SIZE]: 0 },
        });
        const at = model.evaluate(bare).positions;
        const to = model.evaluate(drawn).positions;
        const points: number[][] = [];
        for (let v = 0; v < to.length / 3; v++)
          if (
            [0, 1, 2].some(
              (k) => Math.abs((to[v * 3 + k] as number) - (at[v * 3 + k] as number)) > 1e-7,
            )
          )
            points.push([0, 1, 2].map((k) => to[v * 3 + k] as number));
        return notch(points);
      };
      // The transfer: on the figure it was authored on, within a tenth of the sculpt's share
      // (the reservoir samples the sculpt more coarsely than the sculpt's own vertices).
      const want = notch(sculpt);
      const authored = drawnNotch(AUTHORING_FIGURE.macros);
      expect(Math.abs(authored - want) / want, `${authored} against ${want}`).toBeLessThanOrEqual(
        0.1,
      );
      // Every other body: the sac is carried from that figure, not reshaped by the body's skin.
      for (const macros of [
        { ...AUTHORING_FIGURE.macros, gender: 1 },
        { ...AUTHORING_FIGURE.macros, gender: 0 },
        { ...AUTHORING_FIGURE.macros, gender: 1, weight: 1 },
      ]) {
        const got = drawnNotch(macros);
        expect(
          Math.abs(got - authored) / authored,
          `${JSON.stringify(macros)}: ${got} against ${authored}`,
        ).toBeLessThanOrEqual(0.05);
      }
    },
  );

  it("does not answer the arousal signal: its change is unmeasured, so the sac holds still", () => {
    // The genitals alone: the pack's lip and nipple morphs (#118) answer arousal by design.
    const organOnly = new HumanoidModel(loadOrganOnlyAssets(), { subdivision: 1 });
    const sac = figure({ [TESTES_SIZE]: 0.6 });
    expect(Array.from(organOnly.evaluate(sac, { arousal: 1 }).positions)).toEqual(
      Array.from(organOnly.evaluate(sac).positions),
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
