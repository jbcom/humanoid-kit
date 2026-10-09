import { describe, expect, it } from "vitest";
import { ISLAND_LAYERS, RESERVOIR_RINGS, reservoirSpecs } from "../scripts/lib/adultReservoirs.ts";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import { ATLAS_SIZE, bodyCoverage } from "../scripts/lib/uvIslands.ts";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { surfaceTriangles } from "./detailPack.ts";
import { adultManifest, adultPackData, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

/**
 * The adult pack's real reservoirs: a phallic disc on the midline where the front
 * of the pelvis turns under, and a labioscrotal pair on the underside either side
 * of it, as the packer places them (scripts/lib/adultReservoirs.ts). The engine's
 * behaviour is tested on synthetic packs in adultReservoir.test.ts.
 */
const assets = loadFixtureAssets(true);
const model = new HumanoidModel(assets, { subdivision: 1 });
const lattice = model.adultDetailLattice(AUTHORING_FIGURE);
if (!lattice) throw new Error("no adult surface");
const shipped = adultManifest.anatomy?.reservoirs ?? [];

describe("the adult pack's reservoirs", { timeout: 300_000 }, () => {
  it("ships exactly what the generator places on the lattice", () => {
    expect(shipped.map((r) => r.id)).toEqual([
      "phallic",
      "labioscrotal-left",
      "labioscrotal-right",
    ]);
    // Placement is the generator's; the islands and layers are the packer's (below).
    expect(reservoirSpecs(lattice)).toEqual(
      shipped.map(({ island: _island, layer: _layer, ...placed }) => placed),
    );
    expect(shipped.map((r) => r.rings)).toEqual([
      RESERVOIR_RINGS.phallic,
      RESERVOIR_RINGS.labioscrotal,
      RESERVOIR_RINGS.labioscrotal,
    ]);
  });

  it("places the phallic disc on the midline and the pair either side of it, alike", () => {
    const centre = (loop: readonly number[]) => {
      const c = [0, 0, 0];
      for (const v of loop)
        for (let k = 0; k < 3; k++)
          c[k] = (c[k] as number) + (lattice.latticePositions[v * 3 + k] as number) / loop.length;
      return c as [number, number, number];
    };
    const [phallic, left, right] = shipped as [
      (typeof shipped)[number],
      (typeof shipped)[number],
      (typeof shipped)[number],
    ];
    expect(Math.abs(centre(phallic.loop)[0])).toBeLessThan(0.001);
    expect(centre(left.loop)[0]).toBeLessThan(-0.005);
    expect(centre(right.loop)[0]).toBeGreaterThan(0.005);
    // The pair are mirror images: the same size, at mirrored places.
    expect(left.loop.length).toBe(right.loop.length);
    expect(left.cap.length).toBe(right.cap.length);
    const l = centre(left.loop);
    const r = centre(right.loop);
    expect(l[0]).toBeCloseTo(-r[0], 3);
    expect(l[1]).toBeCloseTo(r[1], 3);
    expect(l[2]).toBeCloseTo(r[2], 3);
    // The phallic root is above and in front of the pair, which hang below it between the legs.
    expect(centre(phallic.loop)[1]).toBeGreaterThan(l[1]);
    expect(centre(phallic.loop)[2]).toBeGreaterThan(l[2]);
  });

  it("shares no vertex or polygon between reservoirs, and keeps the detail within its 16 bits", () => {
    const loops = new Set<number>();
    const caps = new Set<number>();
    for (const r of shipped) {
      for (const v of r.loop) {
        expect(loops.has(v), `vertex ${v}`).toBe(false);
        loops.add(v);
      }
      for (const p of r.cap) {
        expect(caps.has(p), `polygon ${p}`).toBe(false);
        caps.add(p);
      }
    }
    expect(lattice.reservoirs.length).toBe(3);
    expect(lattice.vertexCount).toBe(
      lattice.regionCount + shipped.reduce((s, r) => s + r.loop.length * r.rings, 0),
    );
    expect(lattice.vertexCount).toBeLessThanOrEqual(0x10000);
  });

  it("gives each an island in free UV space, apart from the body's and from each other, and a layer to colour it", () => {
    const size = ATLAS_SIZE;
    const body = model.topology().body;
    const covered = bodyCoverage(body.uvs, body.index, size);
    const taken = new Uint8Array(size * size);
    for (const r of shipped) {
      expect(r.layer, r.id).toBe(ISLAND_LAYERS[r.id]);
      const isle = r.island;
      if (!isle) throw new Error(`${r.id} has no island`);
      const rects = [
        // The wall: origin to origin + along + across.
        {
          x0: isle.origin[0],
          y0: isle.origin[1],
          x1: isle.origin[0] + isle.along[0] + isle.across[0],
          y1: isle.origin[1] + isle.along[1] + isle.across[1],
        },
        // The cap's disc, by its bounding square.
        {
          x0: isle.cap.centre[0] - isle.cap.radius,
          y0: isle.cap.centre[1] - isle.cap.radius,
          x1: isle.cap.centre[0] + isle.cap.radius,
          y1: isle.cap.centre[1] + isle.cap.radius,
        },
      ];
      for (const q of rects) {
        expect(Math.min(q.x0, q.y0), r.id).toBeGreaterThan(0);
        expect(Math.max(q.x1, q.y1), r.id).toBeLessThan(1);
        for (let y = Math.floor(q.y0 * size); y < Math.ceil(q.y1 * size); y++)
          for (let x = Math.floor(q.x0 * size); x < Math.ceil(q.x1 * size); x++) {
            expect(covered[y * size + x], `${r.id} on the body at ${x},${y}`).toBe(0);
            expect(taken[y * size + x], `${r.id} on another island at ${x},${y}`).toBe(0);
            taken[y * size + x] = 1;
          }
      }
    }
  });

  it("lets a tube be told from the skin round its root: the wall is a grid in UV, not collapsed", () => {
    const isle = shipped[0]?.island;
    expect(
      isle && Math.abs(isle.along[0] * isle.across[1] - isle.along[1] * isle.across[0]),
    ).toBeGreaterThan(1e-4);
  });

  it("changes nothing at rest: the adult surface is what it is without them", () => {
    const withoutAnatomy = structuredClone(adultManifest);
    const spec = withoutAnatomy.anatomy;
    if (!spec) throw new Error("no anatomy");
    delete spec.reservoirs;
    delete spec.detail;
    const without = new HumanoidModel(
      parseHumanoidAssets(bodyPackData(), { ...adultPackData(), manifest: withoutAnatomy }),
      { subdivision: 1 },
    );
    const adult = createRecipe({ macros: { age: 30, gender: 0.5 } });
    const a = without.evaluate(adult);
    const b = model.evaluate(adult);
    const ta = surfaceTriangles(without.adultSurface()?.index as Uint32Array, a.positions);
    const tb = surfaceTriangles(model.adultSurface()?.index as Uint32Array, b.positions);
    expect(tb.real.length).toBe(ta.real.length);
    for (let i = 0; i < ta.real.length; i++)
      if (ta.real[i] !== tb.real[i]) throw new Error(`triangle ${i} differs`);
    expect(tb.largestDegenerate).toBeLessThan(1e-12);
    const strips = shipped.reduce((s, r) => s + r.loop.length * r.rings, 0);
    expect(tb.degenerate - ta.degenerate).toBeGreaterThanOrEqual(strips * 2);
  });

  it("is in no figure under 18: their surface is the base body's, vertex for vertex", () => {
    const core = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
    for (const age of [1, 11, 15, 17.99]) {
      const minor = createRecipe({ macros: { age } });
      expect(Array.from(model.evaluate(minor).positions)).toEqual(
        Array.from(core.evaluate(minor).positions),
      );
    }
  });
});
