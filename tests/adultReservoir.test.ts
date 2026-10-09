import { describe, expect, it } from "vitest";
import { findDisc } from "../scripts/lib/detail/disc.ts";
import { type AdultReservoirSpec, parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultPackWith, surfaceTriangles } from "./detailPack.ts";
import { adultPackData, bodyPackData, clothingPackData, loadFixtureAssets } from "./fixtures.ts";

/**
 * Reservoirs in the model (docs/research/ADULT-SCULPT-PLAN.md, section 6b): the
 * adult surface only, exact at rest, closed under every displacement of the
 * vertices they copy, extruded by detail into a watertight tube, and masked with
 * the faces that own them. The strip builder's own tests are in reservoir.test.ts.
 */
const TUBE = "detail/test-tube";
const SHIFT = "detail/test-shift";
const adult = createRecipe({ macros: { age: 30, gender: 0.5 } });
const tube = createRecipe({ macros: adult.macros, modifiers: { [TUBE]: 1 } });
const shifted = createRecipe({ macros: adult.macros, modifiers: { [SHIFT]: 1 } });
const HEIGHT = 0.03;
const RINGS = 3;

const modelOf = (pack = adultPackWith(), subdivision: 0 | 1 | 2 = 1) =>
  new HumanoidModel(parseHumanoidAssets(bodyPackData(), pack), { subdivision });

// The surface without a reservoir, to choose a disc on and to compare against.
const plain = modelOf();
const lattice0 = plain.adultDetailLattice(adult);
if (!lattice0) throw new Error("no adult surface");

/** A disc of the lattice on the front of the pelvis, near the midline. */
function disc(radius: number) {
  const at = (v: number) =>
    [
      lattice0?.latticePositions[v * 3],
      lattice0?.latticePositions[v * 3 + 1],
      lattice0?.latticePositions[v * 3 + 2],
    ] as [number, number, number];
  const ids = Array.from(lattice0?.regionIds ?? []);
  const front = ids.filter((v) => Math.abs(at(v)[0]) < 0.002 && at(v)[2] > 0.05);
  const ys = front.map((v) => at(v)[1]);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const centre = at(
    front.reduce((b, v) => (Math.abs(at(v)[1] - y) < Math.abs(at(b)[1] - y) ? v : b)),
  );
  return findDisc(
    lattice0?.polygons as NonNullable<typeof lattice0>["polygons"],
    at,
    centre,
    radius,
  );
}
const found = disc(0.012);
const reservoirs: AdultReservoirSpec[] = [
  { id: "test", loop: found.loop, cap: found.cap, rings: RINGS },
];

const withReservoir = modelOf(adultPackWith({ reservoirs }));
const lattice1 = withReservoir.adultDetailLattice(adult);
if (!lattice1) throw new Error("no adult surface with a reservoir");
const res = lattice1.reservoirs[0] as NonNullable<typeof lattice1>["reservoirs"][number];

/** Region index of a refinement-mesh vertex. */
const regionOf = (v: number) => (lattice1.regionIds as Uint32Array).indexOf(v);
const loopRegion = found.loop.map(regionOf);
const capRegion = (() => {
  const poly = lattice1.polygons;
  const cap = new Set(found.cap);
  const loop = new Set(found.loop);
  const out = new Set<number>();
  for (let i = 0; i + 1 < poly.start.length; i++)
    if (cap.has(poly.id[i] as number))
      for (let c = poly.start[i] as number; c < (poly.start[i + 1] as number); c++)
        if (!loop.has(poly.vertices[c] as number)) out.add(regionOf(poly.vertices[c] as number));
  return [...out].sort((a, b) => a - b);
})();

/** The tube: cap vertices pulled the full height, ring j (1..RINGS) j/RINGS of it, along +z. */
const tubeTarget = (() => {
  const indices = [...capRegion];
  const xyz: number[] = capRegion.flatMap(() => [0, 0, HEIGHT]);
  for (let j = 1; j <= RINGS; j++)
    for (let i = 0; i < res.loop; i++) {
      indices.push(res.base + (j - 1) * res.loop + i);
      xyz.push(0, 0, (HEIGHT * j) / RINGS);
    }
  return { name: `${TUBE}-incr`, indices, xyz };
})();
const shiftTarget = {
  name: `${SHIFT}-incr`,
  indices: [...loopRegion].sort((a, b) => a - b),
  xyz: loopRegion.flatMap(() => [0.005, 0, 0]),
};
const withDetail = (subdivision: 0 | 1 | 2 = 1) =>
  modelOf(
    adultPackWith({
      reservoirs,
      targets: [tubeTarget, shiftTarget],
      modifiers: [
        { id: TUBE, group: "detail", lo: null, hi: tubeTarget.name, adultOnly: true },
        { id: SHIFT, group: "detail", lo: null, hi: shiftTarget.name, adultOnly: true },
      ],
      surfaceKey: lattice1.key,
    }),
    subdivision,
  );

describe("a reservoir in the adult surface", { timeout: 600_000 }, () => {
  it("has detail vertices for its rings after the region's, and pins the surface by them too", () => {
    expect(res.loop).toBe(found.loop.length);
    expect(res.rings).toBe(RINGS);
    expect(res.base).toBe(lattice1.regionCount);
    expect(lattice1.vertexCount).toBe(lattice1.regionCount + res.loop * RINGS);
    expect(lattice1.key).not.toBe(lattice0?.key);
    // At rest a ring vertex lies where its loop vertex does.
    for (let j = 0; j < RINGS; j++)
      found.loop.forEach((v, i) => {
        const at = (res.base + j * res.loop + i) * 3;
        for (let k = 0; k < 3; k++)
          expect(lattice1.positions[at + k]).toBe(lattice1.latticePositions[v * 3 + k]);
      });
  });

  it("is in the adult surface only: a minor's evaluation is the base body's, vertex for vertex", () => {
    const core = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
    for (const age of [1, 11, 15, 17.99]) {
      const minor = createRecipe({ macros: { age } });
      const a = withReservoir.evaluate(minor);
      const b = core.evaluate(minor);
      expect(a.surface).toBe("base");
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    }
    const grown = withReservoir.adultSurface();
    expect(grown?.vertexCount).toBeGreaterThan(plain.adultSurface()?.vertexCount ?? Infinity);
  });

  it("is the surface without it at rest: the same triangles, the strips with no area", () => {
    const without = plain.evaluate(adult);
    const with_ = withReservoir.evaluate(adult);
    expect(with_.surface).toBe("adult");
    const a = surfaceTriangles(plain.adultSurface()?.index as Uint32Array, without.positions);
    const b = surfaceTriangles(withReservoir.adultSurface()?.index as Uint32Array, with_.positions);
    expect(b.real.length).toBe(a.real.length);
    for (let i = 0; i < a.real.length; i++)
      if (a.real[i] !== b.real[i]) throw new Error(`triangle ${i} differs`);
    expect(b.degenerate - a.degenerate).toBe(res.loop * RINGS * 2);
    expect(b.largestDegenerate).toBeLessThan(1e-12);
    expect(with_.normals.every(Number.isFinite)).toBe(true);
    expect(with_.curvature.every(Number.isFinite)).toBe(true);
  });

  it("keeps its strips closed under a displacement of the vertices it copies", () => {
    const model = withDetail();
    const rest = model.evaluate(adult);
    const moved = model.evaluate(shifted);
    const index = model.adultSurface()?.index as Uint32Array;
    const a = surfaceTriangles(index, rest.positions);
    const b = surfaceTriangles(index, moved.positions);
    // The loop moved 5 mm sideways, and the copies with it: the strips still have no area.
    expect(b.degenerate).toBe(a.degenerate);
    expect(b.largestDegenerate).toBeLessThan(1e-10);
    let shifts = 0;
    for (let v = 0; v < rest.positions.length; v += 3)
      if (Math.abs((moved.positions[v] as number) - (rest.positions[v] as number) - 0.005) < 1e-6)
        shifts++;
    expect(shifts).toBeGreaterThan(found.loop.length);
  });

  for (const level of [1, 2] as const) {
    it(`extrudes into a watertight tube at level ${level}, shaded and finite`, () => {
      const model = withDetail(level);
      const rest = model.evaluate(adult);
      const out = model.evaluate(tube);
      expect(out.surface).toBe("adult");
      expect(out.positions.every(Number.isFinite)).toBe(true);
      expect(out.normals.every(Number.isFinite)).toBe(true);
      const surface = model.adultSurface() as NonNullable<ReturnType<typeof model.adultSurface>>;
      // The tube stands HEIGHT proud of the skin: nothing moved by more, and the tip by that much.
      let top = 0;
      for (let v = 0; v < rest.positions.length; v += 3) {
        const dz = (out.positions[v + 2] as number) - (rest.positions[v + 2] as number);
        top = Math.max(top, dz);
        // Detail subdivides linearly, so no level rings past what was authored.
        expect(dz).toBeLessThanOrEqual(HEIGHT + 1e-6);
      }
      expect(top).toBeGreaterThan(HEIGHT * 0.99);
      // Every edge of the surface is used at most twice, extruded or not, and the open border is the same.
      const use = (positions: Float32Array) => {
        const count = new Map<string, number>();
        const key = (r: number) =>
          [0, 1, 2].map((k) => (positions[r * 3 + k] as number).toFixed(6)).join(",");
        for (let t = 0; t < surface.index.length; t += 3) {
          const tri = [0, 1, 2].map((k) => surface.index[t + k] as number);
          if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
          for (let k = 0; k < 3; k++) {
            const a = key(tri[k] as number);
            const b = key(tri[(k + 1) % 3] as number);
            if (a === b) continue;
            const e = a < b ? `${a}|${b}` : `${b}|${a}`;
            count.set(e, (count.get(e) ?? 0) + 1);
          }
        }
        return count;
      };
      const extruded = use(out.positions);
      for (const c of extruded.values()) expect([1, 2]).toContain(c);
      const border = (m: Map<string, number>) => [...m.values()].filter((c) => c === 1).length;
      expect(border(extruded)).toBe(border(use(rest.positions)));
      // And the strips now have area: the wall is drawn.
      const tris = surfaceTriangles(surface.index, out.positions);
      expect(tris.degenerate).toBeLessThan(
        surfaceTriangles(surface.index, rest.positions).degenerate,
      );
    });
  }

  it("goes with the face that owns it under clothing: what a suit hides takes its strips with it", () => {
    const suit = "suits/male_casualsuit01";
    const clothed = (pack: ReturnType<typeof adultPackWith>) =>
      new HumanoidModel(parseHumanoidAssets(bodyPackData(), pack, clothingPackData()), {
        subdivision: 1,
      });
    const a = clothed(adultPackWith());
    const b = clothed(adultPackWith({ reservoirs }));
    const dressed = createRecipe({ macros: adult.macros, outfit: [suit] });
    const strips = (m: HumanoidModel, r: ReturnType<typeof createRecipe>) => {
      const ev = m.evaluate(r);
      const mask = ev.outfit.masks?.bodyIndex as Uint32Array;
      return surfaceTriangles(mask, ev.positions).degenerate;
    };
    const bare = strips(b, adult) - strips(a, adult);
    expect(bare).toBe(res.loop * RINGS * 2);
    // The suit covers the pelvis: no strip is drawn under it.
    expect(strips(b, dressed) - strips(a, dressed)).toBe(0);
  });

  it("covers the copies' occlusion and uv scale: a copy has its loop vertex's, so nothing darkens or stretches", () => {
    const surface = withReservoir.adultSurface() as NonNullable<
      ReturnType<typeof withReservoir.adultSurface>
    >;
    const rest = withReservoir.evaluate(adult);
    const byPosition = new Map<string, { scale: number; occlusion: string }>();
    const corners = surface.occlusion.length / surface.vertexCount;
    for (let r = 0; r < surface.vertexCount; r++) {
      const p = [0, 1, 2].map((k) => (rest.positions[r * 3 + k] as number).toFixed(7)).join(",");
      const entry = {
        scale: surface.uvScale[r] as number,
        occlusion: Array.from(surface.occlusion.subarray(r * corners, (r + 1) * corners)).join(","),
      };
      const seen = byPosition.get(p);
      if (seen) {
        expect(entry.occlusion, `occlusion at ${p}`).toBe(seen.occlusion);
        expect(entry.scale, `uv scale at ${p}`).toBeCloseTo(seen.scale, 5);
      }
      byPosition.set(p, entry);
    }
  });

  it("is the same figure again from the same pack: nothing random in the surface or the key", () => {
    const again = modelOf(adultPackWith({ reservoirs })).adultDetailLattice(adult);
    expect(again?.key).toBe(lattice1.key);
    expect(again?.vertexCount).toBe(lattice1.vertexCount);
  });

  it("pins detail to the reservoirs it was authored on: another loop is another surface", () => {
    const other = disc(0.016);
    const different = modelOf(
      adultPackWith({
        reservoirs: [{ id: "test", loop: other.loop, cap: other.cap, rings: RINGS }],
      }),
    ).adultDetailLattice(adult);
    expect(different?.key).not.toBe(lattice1.key);
    const bad = modelOf(
      adultPackWith({
        reservoirs: [{ id: "test", loop: other.loop, cap: other.cap, rings: RINGS }],
        targets: [tubeTarget],
        modifiers: [{ id: TUBE, group: "detail", lo: null, hi: tubeTarget.name, adultOnly: true }],
        surfaceKey: lattice1.key,
      }),
    );
    expect(() => bad.adultSurface()).toThrow(/different refinement/);
  });

  it("uses the pack's own default pack too: the shipped pack has no reservoirs yet", () => {
    const shipped = new HumanoidModel(parseHumanoidAssets(bodyPackData(), adultPackData()), {
      subdivision: 1,
    });
    expect(shipped.adultDetailLattice(adult)?.reservoirs).toEqual([]);
  });
});
