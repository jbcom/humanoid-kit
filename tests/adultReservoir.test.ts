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

  it("is in the shipped pack too: the model exposes its reservoirs for authoring", () => {
    const shipped = new HumanoidModel(parseHumanoidAssets(bodyPackData(), adultPackData()), {
      subdivision: 1,
    });
    expect(shipped.adultDetailLattice(adult)?.reservoirs.map((r) => r.id)).toEqual([
      "phallic",
      "labioscrotal-left",
      "labioscrotal-right",
    ]);
  });
});

describe("a reservoir with an island of its own in UV space", { timeout: 600_000 }, () => {
  const island = {
    // In free space of the body's UV layout (its top right corner is empty).
    origin: [0.65, 0.92] as [number, number],
    along: [0.08, 0] as [number, number],
    across: [0, 0.05] as [number, number],
    cap: { centre: [0.85, 0.94] as [number, number], radius: 0.02 },
  };
  const islanded = (layer?: string): AdultReservoirSpec[] => [
    { id: "test", loop: found.loop, cap: found.cap, rings: RINGS, island, ...(layer && { layer }) },
  ];
  const model = modelOf(adultPackWith({ reservoirs: islanded("penis-skin") }));
  const surface = model.adultSurface();
  if (!surface) throw new Error("no adult surface");
  const plainSurface = withReservoir.adultSurface();
  if (!plainSurface) throw new Error("no adult surface");
  const inside = (x: number, y: number, box: { x0: number; y0: number; x1: number; y1: number }) =>
    x >= box.x0 - 1e-6 && x <= box.x1 + 1e-6 && y >= box.y0 - 1e-6 && y <= box.y1 + 1e-6;
  const wall = {
    x0: island.origin[0],
    y0: island.origin[1],
    x1: island.origin[0] + island.along[0],
    y1: island.origin[1] + island.across[1],
  };
  const disc = {
    x0: island.cap.centre[0] - island.cap.radius,
    y0: island.cap.centre[1] - island.cap.radius,
    x1: island.cap.centre[0] + island.cap.radius,
    y1: island.cap.centre[1] + island.cap.radius,
  };
  /** Render vertices whose UV is in the wall's rectangle or the cap's square. */
  const islandVertices = (uvs: Float32Array) => {
    const out: number[] = [];
    for (let v = 0; v < uvs.length / 2; v++) {
      const x = uvs[v * 2] as number;
      const y = uvs[v * 2 + 1] as number;
      if (inside(x, y, wall) || inside(x, y, disc)) out.push(v);
    }
    return out;
  };

  it("is the same surface in space, at rest, with or without it", () => {
    const a = surfaceTriangles(plainSurface.index, withReservoir.evaluate(adult).positions);
    const b = surfaceTriangles(surface.index, model.evaluate(adult).positions);
    expect(b.real.length).toBe(a.real.length);
    for (let i = 0; i < a.real.length; i++)
      if (a.real[i] !== b.real[i]) throw new Error(`triangle ${i} differs`);
  });

  it("puts the wall on a grid in UV space and the cap on the disc, with the strips given real area", () => {
    const uvs = surface.uvs;
    const area = (a: number, b: number, c: number) =>
      Math.abs(
        ((uvs[b * 2] as number) - (uvs[a * 2] as number)) *
          ((uvs[c * 2 + 1] as number) - (uvs[a * 2 + 1] as number)) -
          ((uvs[c * 2] as number) - (uvs[a * 2] as number)) *
            ((uvs[b * 2 + 1] as number) - (uvs[a * 2 + 1] as number)),
      ) / 2;
    const on = new Set(islandVertices(uvs));
    expect(on.size).toBeGreaterThan(found.loop.length * RINGS);
    let wallArea = 0;
    let capArea = 0;
    for (let t = 0; t < surface.index.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => surface.index[t + k] as number) as [
        number,
        number,
        number,
      ];
      if (!(on.has(a) && on.has(b) && on.has(c))) continue;
      const x = ((uvs[a * 2] as number) + (uvs[b * 2] as number) + (uvs[c * 2] as number)) / 3;
      const y =
        ((uvs[a * 2 + 1] as number) + (uvs[b * 2 + 1] as number) + (uvs[c * 2 + 1] as number)) / 3;
      if (inside(x, y, wall)) wallArea += area(a, b, c);
      else capArea += area(a, b, c);
    }
    // The wall fills its rectangle; the cap fills most of its disc (a polygon within it).
    expect(wallArea).toBeCloseTo(island.along[0] * island.across[1], 6);
    expect(capArea).toBeGreaterThan(Math.PI * island.cap.radius ** 2 * 0.6);
    expect(capArea).toBeLessThanOrEqual(Math.PI * island.cap.radius ** 2 * 1.01);
  });

  it("leaves the surface outside the reservoir on the UVs it had", () => {
    // Every render vertex not on the island has a UV the surface without it has too.
    const had = new Set<string>();
    const key = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;
    for (let v = 0; v < plainSurface.uvs.length / 2; v++)
      had.add(key(plainSurface.uvs[v * 2] as number, plainSurface.uvs[v * 2 + 1] as number));
    const on = new Set(islandVertices(surface.uvs));
    for (let v = 0; v < surface.uvs.length / 2; v++) {
      if (on.has(v)) continue;
      expect(had.has(key(surface.uvs[v * 2] as number, surface.uvs[v * 2 + 1] as number))).toBe(
        true,
      );
    }
  });

  it("posts the layer's fields on the island's triangles: mask 1, the coordinate along the rings", () => {
    const update = model.adultLayerFields();
    const extra = update?.extra;
    expect(extra).toBeDefined();
    const l = update?.layers.indexOf("penis-skin") as number;
    const count = (extra?.uvs.length ?? 0) / 2;
    if (!extra) throw new Error("no extra");
    const block = extra.layerFields.subarray(l * count * 2, (l + 1) * count * 2);
    for (let v = 0; v < count; v++) expect(block[v * 2]).toBe(1);
    const along = Array.from({ length: count }, (_, v) => block[v * 2 + 1] as number);
    expect(Math.min(...along)).toBe(0);
    expect(Math.max(...along)).toBe(1);
    expect(new Set(along.map((x) => Math.round(x * RINGS))).size).toBe(RINGS + 1);
  });

  it("is refused when its reservoir names no adult skin layer the core has", () => {
    expect(() => modelOf(adultPackWith({ reservoirs: islanded() })).adultLayerFields()).toThrow(
      /needs an adult skin layer/,
    );
    expect(() =>
      modelOf(adultPackWith({ reservoirs: islanded("no-such-layer") })).adultLayerFields(),
    ).toThrow(/needs an adult skin layer/);
  });

  it("posts nothing extra for a reservoir without an island", () => {
    expect(withReservoir.adultLayerFields()?.extra).toBeUndefined();
  });
});
