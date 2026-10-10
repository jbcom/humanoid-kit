import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import {
  type AtlasSurface,
  densePlan,
  OWNER_GRID,
  planAtlas,
  vertexOwners,
} from "../src/surface/atlasPlan.ts";
import { layerUsesCoordinate, type SkinLayer } from "../src/surface/layers.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const none = new Float32Array(0);
type Kind = "colour" | "bumps" | "creases" | "surface";
/** A layer of `kind` that measures nothing, for the plan's sake. */
const stub = (id: string, kind: Kind, adult = false) =>
  ({
    id,
    targets: [],
    fields: () => ({ mask: none, coord: null }),
    ...(adult && { adult: { feature: "x" } }),
    ...(kind === "colour" && { blend: "mix", paint: () => ({ strength: 0, stops: [] }) }),
    ...(kind === "bumps" && { kind: "detail", pattern: "bumps" }),
    ...(kind === "creases" && { kind: "detail", pattern: "creases" }),
    ...(kind === "surface" && { kind: "surface" }),
  }) as unknown as SkinLayer;

/**
 * A strip of quads, each its own four vertices in its own square of the UV
 * plane, 0.1 apart; layer `l` is at full mask (and coordinate `0.5`) on the
 * quads `on[l]` lists, and zero elsewhere.
 */
function strip(quads: number, on: number[][]): AtlasSurface {
  const uvs = new Float32Array(quads * 8);
  const index = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const x = 0.05 + q * 0.1;
    uvs.set([x, 0.4, x + 0.04, 0.4, x + 0.04, 0.44, x, 0.44], q * 8);
    index.set(
      [0, 1, 2, 0, 2, 3].map((k) => q * 4 + k),
      q * 6,
    );
  }
  const n = quads * 4;
  const layerFields = new Float32Array(on.length * n * 2);
  on.forEach((list, l) => {
    for (const q of list)
      for (let k = 0; k < 4; k++) {
        layerFields[(l * n + q * 4 + k) * 2] = 1;
        layerFields[(l * n + q * 4 + k) * 2 + 1] = 0.5;
      }
  });
  return { uvs, index, vertexCount: n, layerFields };
}

describe("the atlas plan", () => {
  it("gives each layer a value channel of its own, and a coordinate only where the shader reads one, when nothing is known of where the layers lie", () => {
    const layers = [
      stub("a", "colour"),
      stub("b", "bumps"),
      stub("c", "creases"),
      stub("d", "surface"),
    ];
    const plan = planAtlas(layers);
    expect(new Set(plan.value).size).toBe(4);
    expect(Array.from(plan.coord).map((c) => c >= 0)).toEqual([true, false, true, false]);
    expect(layers.map(layerUsesCoordinate)).toEqual([true, false, true, false]);
    // Four masks and two coordinates: six channels in two pages.
    expect(plan.channels).toBe(6);
    expect(plan.pages).toBe(2);
    expect(Array.from(plan.owner)).toEqual([-1, -1, -1, -1]);
  });

  it("puts layers whose supports are apart in the same channels, told apart by an owner map", () => {
    const layers = [stub("a", "colour"), stub("b", "colour"), stub("c", "creases")];
    const plan = planAtlas(layers, strip(3, [[0], [1], [2]]));
    expect(plan.value[1]).toBe(plan.value[0]);
    expect(plan.value[2]).toBe(plan.value[0]);
    expect(plan.coord[1]).toBe(plan.coord[0]);
    expect(plan.coord[2]).toBe(plan.coord[0]);
    // One value channel and one coordinate channel, the owner map in a texture of its own.
    expect(plan.channels).toBe(2);
    expect(plan.pages).toBe(1);
    expect(new Set(plan.ownerId).size).toBe(3);
    expect(new Set(plan.owner).size).toBe(1);
    expect(plan.owner[0]).toBeGreaterThanOrEqual(0);
  });

  it("puts a layer that reads a coordinate where a coordinate channel already is, before opening one for it", () => {
    // a (a surface layer, no coordinate) and b (a colour layer) overlap on quad 3, so they cannot
    // share; c (a colour layer) lies apart from both. First fit would put c with a, whose group
    // has no coordinate channel, and cost one; b's group has one.
    const layers = [stub("a", "surface"), stub("b", "colour"), stub("c", "colour")];
    const plan = planAtlas(layers, strip(4, [[0, 3], [1, 3], [2]]));
    expect(plan.value[0]).not.toBe(plan.value[1]);
    expect(plan.value[2]).toBe(plan.value[1]);
    expect(plan.coord[2]).toBe(plan.coord[1]);
    // a's value; b and c's value and coordinate.
    expect(plan.channels).toBe(3);
  });

  it("puts a layer with no coordinate with a group that has none before one that has", () => {
    // The mirror: a layer that needs no coordinate costs nothing anywhere, so it keeps the first fit.
    const layers = [stub("a", "colour"), stub("b", "surface"), stub("c", "surface")];
    const plan = planAtlas(layers, strip(4, [[0, 3], [1, 3], [2]]));
    expect(plan.value[2]).toBe(plan.value[0]);
    expect(plan.channels).toBe(3);
  });

  it("never puts two layers that overlap in one channel", () => {
    const layers = [stub("a", "colour"), stub("b", "colour"), stub("c", "colour")];
    // Layers a and b both lie on quad 0; c is elsewhere and may share with either.
    const plan = planAtlas(layers, strip(3, [[0], [0, 1], [2]]));
    expect(plan.value[1]).not.toBe(plan.value[0]);
    expect(plan.value[2]).toBe(plan.value[0]);
    expect(plan.coord[1]).not.toBe(plan.coord[0]);
  });

  it("keeps layers whose supports touch, or sit in neighbouring cells, apart", () => {
    // Two quads 0.1 apart are six cells apart: they share. A third a cell's width from the
    // first (a filter radius away) does not.
    const near = strip(2, [[0], [1]]);
    const x = near.uvs.slice();
    for (let k = 0; k < 4; k++) x[8 + k * 2] = (x[k * 2] as number) + 1.2 / OWNER_GRID;
    const layers = [stub("a", "colour"), stub("b", "colour")];
    expect(planAtlas(layers, { ...near, uvs: x }).value[1]).not.toBe(
      planAtlas(layers, { ...near, uvs: x }).value[0],
    );
    expect(planAtlas(layers, near).value[1]).toBe(planAtlas(layers, near).value[0]);
  });

  it("leaves adult layers alone, whose fields arrive after the plan", () => {
    const layers = [stub("a", "colour"), stub("b", "colour", true), stub("c", "colour", true)];
    const plan = planAtlas(layers, strip(3, [[0], [1], [2]]));
    expect(new Set(plan.value).size).toBe(3);
    expect(plan.owner[1]).toBe(-1);
  });

  it("leaves a layer with no support (not loaded, or zero) in channels of its own", () => {
    const layers = [stub("a", "colour"), stub("b", "colour")];
    const plan = planAtlas(layers, strip(2, [[0], []]));
    expect(plan.value[1]).not.toBe(plan.value[0]);
  });

  it("marks, in the owner map, the cells each member lies in and no others", () => {
    const layers = [stub("a", "colour"), stub("b", "colour")];
    const plan = planAtlas(layers, strip(2, [[0], [1]]));
    const map = plan.ownerMaps.subarray(0, OWNER_GRID * OWNER_GRID);
    const cellOf = (u: number, v: number) =>
      Math.floor(v * OWNER_GRID) * OWNER_GRID + Math.floor(u * OWNER_GRID);
    expect(map[cellOf(0.07, 0.42)]).toBe(plan.ownerId[0]);
    expect(map[cellOf(0.17, 0.42)]).toBe(plan.ownerId[1]);
    expect(map[cellOf(0.5, 0.42)]).toBe(255);
    expect(map[cellOf(0.07, 0.9)]).toBe(255);
  });

  it("tells each shared vertex which member it belongs to", () => {
    const surface = strip(3, [[0], [1], [2]]);
    const owners = vertexOwners(surface, [0, 1, 2]);
    expect(Array.from(owners)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
    // A member with no support owns nothing.
    expect(Array.from(vertexOwners(surface, [0, 1]).slice(8))).toEqual([-1, -1, -1, -1]);
  });

  it("is two channels a layer, mask then coordinate, when dense", () => {
    const plan = densePlan(3);
    expect(Array.from(plan.value)).toEqual([0, 2, 4]);
    expect(Array.from(plan.coord)).toEqual([1, 3, 5]);
    expect(plan.pages).toBe(2);
  });
});

describe("the atlas plan of the shipped stack", () => {
  const assets = loadFixtureAssets();
  const model = new HumanoidModel(assets, { subdivision: 1 });
  const body = model.topology().body;
  const surface: AtlasSurface = {
    uvs: body.uvs,
    index: body.index,
    vertexCount: body.uvs.length / 2,
    layerFields: body.layerFields,
  };
  const plan = body.plan;
  const n = surface.vertexCount;

  it("is the plan the model hands the renderer", () => {
    expect(plan.value.length).toBe(SKIN_LAYERS.length);
    expect(plan.pages).toBe(Math.ceil(plan.channels / 4));
  });

  it("puts no two layers that lie on one vertex in the same value channel", () => {
    const lies = (l: number) => {
      const out = new Uint8Array(n);
      for (let v = 0; v < n; v++)
        out[v] = (body.layerFields[(l * n + v) * 2] as number) > 0 ? 1 : 0;
      return out;
    };
    const on = SKIN_LAYERS.map((_, l) => lies(l));
    let shared = 0;
    for (let a = 0; a < SKIN_LAYERS.length; a++)
      for (let b = a + 1; b < SKIN_LAYERS.length; b++) {
        if (plan.value[a] !== plan.value[b]) continue;
        shared++;
        let both = 0;
        for (let v = 0; v < n; v++)
          both += ((on[a] as Uint8Array)[v] ?? 0) & ((on[b] as Uint8Array)[v] ?? 0);
        expect(both, `${SKIN_LAYERS[a]?.id} and ${SKIN_LAYERS[b]?.id}`).toBe(0);
      }
    expect(shared).toBeGreaterThan(0);
  });

  it("gives the layers of one channel owner ids that differ, and none to a layer alone", () => {
    for (let a = 0; a < SKIN_LAYERS.length; a++) {
      const mates = SKIN_LAYERS.map((_, b) => b).filter((b) => plan.value[b] === plan.value[a]);
      expect(new Set(mates.map((b) => plan.ownerId[b])).size).toBe(mates.length);
      expect((plan.owner[a] as number) >= 0).toBe(mates.length > 1);
    }
  });

  it("keeps the whole stack, creases, hands, expression lines, feet and body hair included, to eight pages", () => {
    // Two layers a page was 11 pages (44 MB) for these layers; the crease layers alone,
    // twelve of them, took 6 more. The hands' layers are budgeted one page
    // (docs/ARCHITECTURE.md, "Hands"): 7 pages before them, 8 with them. The face's
    // five expression lines, whose masks lie apart from most layers', share channels
    // and add none. The feet's skin is painted by the hands' layers (`areas.ts`) and adds
    // the ridges' two channels (docs/ARCHITECTURE.md, "Feet"). Body hair's layers fit
    // the same 8: vellus takes no channel, and the rest share (docs/ARCHITECTURE.md,
    // "Body hair").
    expect(plan.pages).toBeLessThanOrEqual(8);
    expect(plan.pages).toBeLessThan(densePlan(SKIN_LAYERS.length).pages);
  });

  it("shares a coordinate channel only between layers that share their values", () => {
    for (let a = 0; a < SKIN_LAYERS.length; a++)
      for (let b = a + 1; b < SKIN_LAYERS.length; b++)
        if ((plan.coord[a] as number) >= 0 && plan.coord[a] === plan.coord[b])
          expect(plan.value[a]).toBe(plan.value[b]);
  });
});
