import { describe, expect, it } from "vitest";
import {
  type AdultAnatomyManifest,
  AssetFormatError,
  type HumanoidAssets,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, adultPackData, bodyPackData } from "./fixtures.ts";

/**
 * Detail targets (docs/research/ADULT-SCULPT-PLAN.md, section 6a): sparse
 * displacements on the adult surface's own vertices, driven by an adult
 * modifier like any other target, added after the surface is evaluated. These
 * tests use a synthetic detail target on real adult-pack data, so the engine is
 * proven before any anatomy is authored on it.
 */
const BUMP = "detail/test-bump";
const DENT = "detail/test-dent";
const MODIFIER = "detail/test-bump-decr|incr";
const STEP = 1e-4; // metres per int16 step
const BUMP_Z = 0.005;
const DENT_Z = -0.003;

const adult = createRecipe({ macros: { age: 30, gender: 0.5 } });
const bumped = createRecipe({ macros: { age: 30, gender: 0.5 }, modifiers: { [MODIFIER]: 1 } });

/** One target of the `TARGET_ENCODING` file: ascending index deltas, then x, y, z planes. */
function encodeTarget(indices: readonly number[], delta: [number, number, number]) {
  const n = indices.length;
  const bytes = new ArrayBuffer(n * 2 + n * 6);
  const view = new DataView(bytes);
  let prev = 0;
  indices.forEach((v, i) => {
    view.setUint16(i * 2, v - prev, true);
    prev = v;
  });
  for (let k = 0; k < 3; k++)
    for (let i = 0; i < n; i++)
      view.setInt16(n * 2 + (k * n + i) * 2, Math.round((delta[k] as number) / STEP), true);
  return new Uint8Array(bytes);
}

function concat(a: ArrayBuffer, parts: Uint8Array[]): ArrayBuffer {
  const out = new Uint8Array(a.byteLength + parts.reduce((s, p) => s + p.byteLength, 0));
  out.set(new Uint8Array(a), 0);
  let at = a.byteLength;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out.buffer;
}

const plain = parseHumanoidAssets(bodyPackData(), adultPackData());
const plainModel = new HumanoidModel(plain, { subdivision: 1 });
const lattice = plainModel.adultDetailLattice(adult);
if (!lattice) throw new Error("the adult pack has no refined surface");
/** The last vertices of the lattice: refined-region vertices that no base vertex index names. */
const INDICES = Array.from({ length: 12 }, (_, i) => lattice.vertexCount - 12 + i);

interface Options {
  indices?: readonly number[];
  surfaceKey?: string;
  scale?: { a: number; b: number; rest: number };
}

/** The adult pack with the synthetic bump and dent as detail targets of one new modifier. */
function assetsWithDetail(o: Options = {}): HumanoidAssets {
  const indices = o.indices ?? INDICES;
  const base = adultPackData();
  const bump = encodeTarget(indices, [0, 0, BUMP_Z]);
  const dent = encodeTarget(indices, [0, 0, DENT_Z]);
  const start = base.targets.byteLength;
  const manifest: AdultAnatomyManifest = structuredClone(adultManifest);
  manifest.targets.entries.push(
    { name: BUMP, offset: start, count: indices.length, scale: STEP },
    { name: DENT, offset: start + bump.byteLength, count: indices.length, scale: STEP },
  );
  manifest.modifiers.push({ id: MODIFIER, group: "detail", lo: DENT, hi: BUMP, adultOnly: true });
  const spec = manifest.anatomy;
  if (!spec) throw new Error("no anatomy spec");
  spec.detail = {
    targets: [BUMP, DENT],
    surfaceKey: o.surfaceKey ?? lattice?.key ?? "",
    ...(o.scale && { scale: o.scale }),
  };
  return parseHumanoidAssets(bodyPackData(), {
    manifest,
    targets: concat(base.targets, [bump, dent]),
  });
}

const detailModel = (o?: Options, subdivision: 0 | 1 | 2 = 1) =>
  new HumanoidModel(assetsWithDetail(o), { subdivision });

/** Per render vertex whether it moved, and by how much, between two evaluations. */
function moved(a: Float32Array, b: Float32Array) {
  const out: { v: number; d: [number, number, number] }[] = [];
  for (let v = 0; v < a.length / 3; v++) {
    const d = [0, 1, 2].map((k) => (b[v * 3 + k] as number) - (a[v * 3 + k] as number)) as [
      number,
      number,
      number,
    ];
    if (Math.hypot(...d) > 1e-9) out.push({ v, d });
  }
  return out;
}

// Each model builds a refined surface: seconds unloaded, minutes on a busy machine.
describe("the adult detail lattice", { timeout: 300_000 }, () => {
  it("is the refined surface's vertex space, with a key that names its refinement", () => {
    // The refined region's own vertices, few enough for a target's 16-bit index.
    expect(lattice.vertexCount).toBeGreaterThan(500);
    expect(lattice.vertexCount).toBeLessThanOrEqual(0x10000);
    expect(lattice.positions.length).toBe(lattice.vertexCount * 3);
    expect(lattice.positions.every(Number.isFinite)).toBe(true);
    expect(lattice.key).toMatch(/^[0-9a-f]{16}$/);
    // Level independent: the refinement's own space, before any further smoothing.
    const two = new HumanoidModel(plain, { subdivision: 2 }).adultDetailLattice(adult);
    expect(two?.key).toBe(lattice.key);
    expect(two?.vertexCount).toBe(lattice.vertexCount);
  });

  it("is null without an adult surface", () => {
    expect(new HumanoidModel(plain, { subdivision: 0 }).adultDetailLattice(adult)).toBeNull();
    expect(
      new HumanoidModel(parseHumanoidAssets(bodyPackData()), { subdivision: 1 }).adultDetailLattice(
        adult,
      ),
    ).toBeNull();
  });

  it("follows the figure: a taller one has a longer lattice", () => {
    const short = plainModel.adultDetailLattice(createRecipe({ macros: { age: 30, height: 0 } }));
    const tall = plainModel.adultDetailLattice(createRecipe({ macros: { age: 30, height: 1 } }));
    const ys = (p: Float32Array | undefined) => {
      let hi = Number.NEGATIVE_INFINITY;
      for (let i = 1; i < (p?.length ?? 0); i += 3) hi = Math.max(hi, p?.[i] as number);
      return hi;
    };
    expect(ys(tall?.positions)).toBeGreaterThan(ys(short?.positions));
  });
});

describe("a detail target on the adult surface", { timeout: 300_000 }, () => {
  const model = detailModel();

  it("moves exactly its vertices, by its delta times the modifier's value", () => {
    const rest = model.evaluate(adult).positions;
    const full = model.evaluate(bumped).positions;
    const m = moved(rest, full);
    // Render vertices split at UV seams: at least one per lattice vertex, all of them moved alike.
    expect(m.length).toBeGreaterThanOrEqual(INDICES.length);
    for (const { d } of m) {
      expect(d[0]).toBeCloseTo(0, 6);
      expect(d[1]).toBeCloseTo(0, 6);
      expect(d[2]).toBeCloseTo(BUMP_Z, 6);
    }
    const distinct = new Set(m.map(({ v }) => [0, 1, 2].map((k) => full[v * 3 + k]).join()));
    expect(distinct.size).toBe(INDICES.length);
    const half = createRecipe({ macros: adult.macros, modifiers: { [MODIFIER]: 0.5 } });
    for (const { d } of moved(rest, model.evaluate(half).positions))
      expect(d[2]).toBeCloseTo(BUMP_Z / 2, 6);
  });

  it("takes the other target for a negative value, and nothing for zero", () => {
    const rest = model.evaluate(adult).positions;
    const dent = createRecipe({ macros: adult.macros, modifiers: { [MODIFIER]: -1 } });
    const m = moved(rest, model.evaluate(dent).positions);
    expect(m.length).toBeGreaterThanOrEqual(INDICES.length);
    for (const { d } of m) expect(d[2]).toBeCloseTo(DENT_Z, 6);
    const zero = createRecipe({ macros: adult.macros, modifiers: { [MODIFIER]: 0 } });
    expect(Array.from(model.evaluate(zero).positions)).toEqual(Array.from(rest));
  });

  it("is not a control target: the figure's control vertices are untouched", () => {
    expect(Array.from(model.evaluate(bumped).control)).toEqual(
      Array.from(model.evaluate(adult).control),
    );
  });

  it("is refused under 18 like any adult modifier, and a minor never has the surface it needs", () => {
    const teen = createRecipe({ macros: { age: 15 }, modifiers: { [MODIFIER]: 1 } });
    expect(() => model.evaluate(teen)).toThrow();
    expect(() => model.evaluate(teen)).toThrow(/adult|age policy/);
    expect(AgePolicyError).toBeDefined();
    const plainTeen = model.evaluate(createRecipe({ macros: { age: 15 } }));
    expect(plainTeen.surface).toBe("base");
  });

  it("smooths through further subdivision, finite and still moving only near its vertices", () => {
    const two = detailModel(undefined, 2);
    const rest = two.evaluate(adult);
    const full = two.evaluate(bumped);
    expect(full.positions.every(Number.isFinite)).toBe(true);
    expect(full.normals.every(Number.isFinite)).toBe(true);
    const m = moved(rest.positions, full.positions);
    expect(m.length).toBeGreaterThan(0);
    // Smoothing spreads a displacement over its neighbours but never past a few cells.
    expect(m.length).toBeLessThan(2000);
    for (const { d } of m) expect(Math.abs(d[2])).toBeLessThanOrEqual(BUMP_Z + 1e-6);
  });

  it("shades the new form: displaced vertices' normals turn, ones far away stay as they were", () => {
    const rest = model.evaluate(adult);
    const full = model.evaluate(bumped);
    const m = moved(rest.positions, full.positions);
    const near = new Set(m.map(({ v }) => v));
    let turned = 0;
    let changedElsewhere = 0;
    for (let v = 0; v < rest.normals.length / 3; v++) {
      const dot =
        (rest.normals[v * 3] as number) * (full.normals[v * 3] as number) +
        (rest.normals[v * 3 + 1] as number) * (full.normals[v * 3 + 1] as number) +
        (rest.normals[v * 3 + 2] as number) * (full.normals[v * 3 + 2] as number);
      if (near.has(v) && dot < 0.9999) turned++;
      if (!near.has(v) && dot < 1 - 1e-4) changedElsewhere++;
    }
    expect(turned).toBeGreaterThan(0);
    // The ring of faces around the displaced vertices re-shades; nothing beyond it does.
    expect(changedElsewhere).toBeLessThan(200);
    for (let v = 0; v < full.normals.length / 3; v++)
      expect(
        Math.hypot(
          full.normals[v * 3] as number,
          full.normals[v * 3 + 1] as number,
          full.normals[v * 3 + 2] as number,
        ),
      ).toBeCloseTo(1, 4);
  });

  it("scales with the figure when the pack names a scale, by the ratio of two control distances", () => {
    const a = 1000;
    const b = 9000;
    const reference = plainModel.evaluate(adult).control;
    const dist = (c: Float32Array) =>
      Math.hypot(
        (c[a * 3] as number) - (c[b * 3] as number),
        (c[a * 3 + 1] as number) - (c[b * 3 + 1] as number),
        (c[a * 3 + 2] as number) - (c[b * 3 + 2] as number),
      );
    const scaled = detailModel({ scale: { a, b, rest: dist(reference) } });
    for (const macros of [{ height: 0 }, { height: 1 }, { weight: 1 }]) {
      const figure = createRecipe({ macros: { age: 30, gender: 0.5, ...macros } });
      const withMod = createRecipe({
        macros: figure.macros,
        modifiers: { [MODIFIER]: 1 },
      });
      const ratio = dist(scaled.evaluate(figure).control) / dist(reference);
      const m = moved(scaled.evaluate(figure).positions, scaled.evaluate(withMod).positions);
      expect(m.length).toBeGreaterThan(0);
      for (const { d } of m) expect(d[2]).toBeCloseTo(BUMP_Z * ratio, 5);
    }
  });

  it("is ignored where there is no adult surface, rather than failing", () => {
    const flat = detailModel(undefined, 0);
    const rest = flat.evaluate(adult);
    const full = flat.evaluate(bumped);
    expect(full.surface).toBe("base");
    expect(Array.from(full.positions)).toEqual(Array.from(rest.positions));
  });
});

describe("a detail target is pinned to the surface it was built against", {
  timeout: 300_000,
}, () => {
  it("is refused for a different refinement, by key", () => {
    const wrong = detailModel({ surfaceKey: "0000000000000000" });
    expect(() => wrong.adultSurface()).toThrow(AssetFormatError);
    expect(() => wrong.evaluate(adult)).toThrow(/different refinement|surface/);
  });

  it("is refused when an index is past the lattice", () => {
    const past = detailModel({ indices: [lattice.vertexCount] });
    expect(() => past.adultSurface()).toThrow(/out of range|past/);
  });
});
