import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { groupFaces, jointPosition } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import {
  COAT_REGION_LIMIT,
  COAT_SHELLS,
  type CoatRegion,
  coatMasks,
  coatPainted,
  coatShellCount,
  coatTriangles,
  combField,
  paintCoat,
} from "../src/surface/coat.ts";
import type { SkinPaintInput } from "../src/surface/layers.ts";
import { BODY_HAIR_COAT, beardMasks } from "../src/surface/regions/bodyHairCoat.ts";
import {
  COAT_REGIONS,
  LIPS_LAYER,
  MOUTH_INTERIOR_LAYER,
  SKIN_LAYER_TARGETS,
} from "../src/surface/regions/index.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const P = assets.positions;
const comb = combField(assets);
const skin = (() => {
  const out = new Set<number>();
  for (const f of groupFaces(assets, "body"))
    for (let k = 0; k < 4; k++) out.add(assets.faceVerts[f * 4 + k] as number);
  return [...out];
})();
const tone = { melanin: 0.35, haemoglobin: 0.5, undertone: 0, override: null };
const input = (
  age: number,
  gender: number,
  extra: Partial<SkinPaintInput> = {},
): SkinPaintInput => ({
  tone,
  flush: 0.45,
  lips: 0.55,
  areola: 0.5,
  signals: {},
  age,
  gender,
  adult: age >= 18,
  ...extra,
});
const at = (joint: string) => {
  const p = new Float32Array(3);
  jointPosition(assets, P, joint, p, 0);
  return p;
};
const row = (table: Float32Array, id: string) => {
  const k = BODY_HAIR_COAT.findIndex((r) => r.id === id);
  return table.subarray(k * 8, k * 8 + 8);
};

describe("the comb field", () => {
  const { normals } = skinZones(assets);
  const dir = (v: number): [number, number, number] => [
    comb[v * 3] as number,
    comb[v * 3 + 1] as number,
    comb[v * 3 + 2] as number,
  ];
  const dot = (a: readonly number[], b: readonly number[]) =>
    (a[0] as number) * (b[0] as number) +
    (a[1] as number) * (b[1] as number) +
    (a[2] as number) * (b[2] as number);

  it("is a unit tangent of the skin at every drawn vertex", () => {
    for (const v of skin) {
      const d = dir(v);
      expect(Math.hypot(...d)).toBeCloseTo(1, 4);
      const n = [0, 1, 2].map((k) => normals[v * 3 + k] as number);
      expect(Math.abs(dot(d, n))).toBeLessThan(0.02);
    }
  });

  it("runs down the forearm toward the wrist, and down the chest", () => {
    const elbow = at("lowerarm01.L____head");
    const wrist = at("wrist.L____head");
    const axis = [0, 1, 2].map((k) => (wrist[k] as number) - (elbow[k] as number));
    const len = Math.hypot(...axis);
    const zones = skinZones(assets);
    let along = 0;
    let count = 0;
    let down = 0;
    let chest = 0;
    for (const v of skin) {
      const d = dir(v);
      if ((zones.zone("forearm")[v] as number) > 0.95 && (P[v * 3] as number) > 0) {
        along += dot(d, axis) / len;
        count++;
      }
      const trunk = (zones.zone("upperTrunk")[v] as number) + (zones.zone("breast")[v] as number);
      if (trunk > 0.8 && (zones.front[v] as number) > 0.8) {
        chest++;
        if (d[1] < -0.5) down++;
      }
    }
    expect(count).toBeGreaterThan(20);
    expect(chest).toBeGreaterThan(20);
    expect(along / count).toBeGreaterThan(0.85);
    expect(down / chest).toBeGreaterThan(0.9);
  });
});

describe("the adult-only gate on the armpits' coat", () => {
  const axillary = BODY_HAIR_COAT.filter((r) => r.adultOnly);
  const cover = (table: Float32Array) => table[0] as number;

  it("is exactly the axillary region", () => {
    expect(axillary.map((r) => r.id)).toEqual(["hair-axillary"]);
  });

  it("paints it at zero for any figure under 18, whatever the recipe asks", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 17.999, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (age, gender, m) => {
          const t = paintCoat(
            axillary,
            input(age, gender, { bodyHair: { density: { axillary: m } } }),
          );
          expect(cover(t)).toBe(0);
        },
      ),
    );
  });

  it("fails closed: an input that does not say the figure is an adult paints none, even at 40", () => {
    const { adult: _, ...unsaid } = input(40, 1);
    expect(cover(paintCoat(axillary, unsaid))).toBe(0);
    // An input claiming a child is an adult still gets none: the model gives a child no coverage.
    expect(cover(paintCoat(axillary, { ...input(12, 1), adult: true }))).toBe(0);
  });

  it("paints it for an adult, man or woman", () => {
    for (const gender of [0, 1])
      expect(
        cover(paintCoat(axillary, input(30, gender, { bodyHair: { density: { axillary: 1 } } }))),
      ).toBeGreaterThan(0.5);
  });
});

describe("coat masks and paint", () => {
  it("lay out one byte per region per vertex and refuse more regions than the limit", () => {
    const masks = coatMasks(assets, COAT_REGIONS);
    expect(masks.length).toBe(assets.manifest.vertexCount * COAT_REGION_LIMIT);
    const nine = Array.from({ length: 9 }, () => COAT_REGIONS[0] as CoatRegion);
    expect(() => coatMasks(assets, nine)).toThrow(RangeError);
  });

  it("measure their masks only from targets the body pack packs", () => {
    for (const r of COAT_REGIONS)
      for (const t of r.targets) expect(SKIN_LAYER_TARGETS).toContain(t);
  });

  it("paint nothing for a recipe that says nothing of body hair, at any age or sex", () => {
    for (const age of [8, 15, 35, 80])
      for (const gender of [0, 0.5, 1])
        expect(coatPainted(paintCoat(BODY_HAIR_COAT, input(age, gender)))).toBe(false);
  });

  it("paint a region the recipe enables, and nothing on a child", () => {
    const chest = { bodyHair: { density: { chest: 1 } } };
    expect(coatPainted(paintCoat(BODY_HAIR_COAT, input(8, 1, chest)))).toBe(false);
    const man = paintCoat(BODY_HAIR_COAT, input(35, 1, chest));
    for (const part of ["moustache", "chin", "cheeks"])
      expect(row(man, `beard-${part}`)[0]).toBe(0);
    expect(row(man, "hair-chest")[0]).toBeGreaterThan(0.4);
    expect(row(man, "hair-back")[0]).toBe(0);
  });

  it("grow the parts each beard style names, stubble short and standing", () => {
    const stubble = paintCoat(BODY_HAIR_COAT, input(35, 1, { bodyHair: { beard: "stubble" } }));
    for (const part of ["moustache", "chin", "cheeks"]) {
      const r = row(stubble, `beard-${part}`);
      expect(r[0]).toBeGreaterThan(0.9);
      expect(r[1]).toBeLessThan(0.003);
      expect(r[3]).toBeLessThan(0.3);
    }
    const goatee = paintCoat(BODY_HAIR_COAT, input(35, 1, { bodyHair: { beard: "goatee" } }));
    expect(row(goatee, "beard-moustache")[0]).toBeGreaterThan(0);
    expect(row(goatee, "beard-chin")[0]).toBeGreaterThan(0);
    expect(row(goatee, "beard-cheeks")[0]).toBe(0);
  });

  it("refuse a hair longer than shells can draw", () => {
    const long: CoatRegion = {
      ...(COAT_REGIONS[0] as CoatRegion),
      paint: () => ({
        cover: 1,
        length: 0.05,
        density: 20,
        lie: 0.5,
        width: 1e-4,
        colour: [0, 0, 0],
      }),
    };
    expect(() => paintCoat([long], input(30, 1))).toThrow(RangeError);
  });
});

describe("the coat's triangles", () => {
  const model = new HumanoidModel(assets, { subdivision: 1 });
  const body = model.topology().body;

  it("are carried to the render vertices with a unit comb", () => {
    const n = body.vertexCount;
    expect(body.coat.regions).toEqual(COAT_REGIONS.map((r) => r.id));
    expect(body.coat.masks.length).toBe(n * COAT_REGION_LIMIT);
    let unitComb = 0;
    for (let v = 0; v < n; v++)
      if (Math.abs(Math.hypot(...body.coat.comb.subarray(v * 3, v * 3 + 3)) - 1) < 1e-3) unitComb++;
    expect(unitComb / n).toBeGreaterThan(0.95);
  });

  it("cover only where a painted region grows, and nothing when none is painted", () => {
    const none = paintCoat(BODY_HAIR_COAT, input(8, 1));
    expect(coatTriangles(body.index, body.coat.masks, none).length).toBe(0);
    // A default adult recipe draws no coat at all.
    for (const gender of [0, 1])
      expect(
        coatTriangles(body.index, body.coat.masks, paintCoat(BODY_HAIR_COAT, input(35, gender)))
          .length,
      ).toBe(0);
    const stubble = paintCoat(
      BODY_HAIR_COAT,
      input(35, 0.2, {
        bodyHair: { beard: "stubble", density: { chest: 0, abdomen: 0, back: 0, axillary: 0 } },
      }),
    );
    const tris = coatTriangles(body.index, body.coat.masks, stubble);
    expect(tris.length).toBeGreaterThan(0);
    // Every triangle drawn touches the beard (regions 0 to 2), the only one painted.
    const beard = (v: number) =>
      [0, 1, 2].some((k) => (body.coat.masks[v * COAT_REGION_LIMIT + k] as number) > 0);
    for (let t = 0; t < tris.length; t += 3)
      expect(
        beard(tris[t] as number) || beard(tris[t + 1] as number) || beard(tris[t + 2] as number),
      ).toBe(true);
    // The face's mesh is the body's densest, so its share of triangles exceeds its share of skin.
    expect(tris.length).toBeLessThan(body.index.length * 0.15);
  });
});

describe("the shell count", () => {
  it("scales with the figure's size on screen, within bounds", () => {
    expect(coatShellCount(0)).toBe(COAT_SHELLS.min);
    expect(coatShellCount(100)).toBe(COAT_SHELLS.min);
    expect(coatShellCount(1080)).toBe(COAT_SHELLS.max);
    expect(coatShellCount(600)).toBe(10);
    expect(coatShellCount(Number.NaN)).toBe(COAT_SHELLS.min);
  });
});

describe("the beard's masks", () => {
  const masks = beardMasks(assets);
  const lips = LIPS_LAYER.fields(assets).mask;
  const eyeY = at("eye.L____head")[1] as number;
  const edges: [number, number][] = [];
  for (const f of groupFaces(assets, "body")) {
    const q = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
    for (let k = 0; k < 4; k++) edges.push([q[k] as number, q[(k + 1) % 4] as number]);
  }
  const area = (v: number) =>
    (masks.moustache[v] as number) + (masks.chin[v] as number) + (masks.cheeks[v] as number);

  it("share the beard's area without overlap: parts sum to at most 1", () => {
    for (const v of skin) expect(area(v)).toBeLessThan(1.001);
  });

  it("keep off the lips, above the cheek line, and off the back of the neck", () => {
    for (const v of skin) {
      if ((lips[v] as number) > 0.9) expect(area(v)).toBeLessThan(0.05);
      if ((P[v * 3 + 1] as number) > eyeY) expect(area(v)).toBe(0);
      if ((P[v * 3 + 2] as number) < 0) expect(area(v)).toBe(0);
    }
  });

  it("have no cut edges on the face's lines: no part changes fully in under a centimetre", () => {
    // Beard hair stops sharply at the lips' border, as real hair does, and an
    // edge into the mouth's lining folds out of sight; the lines the defect was
    // in (the cheek line, the sideburns, the neckline) lie well away from both.
    const mouth = MOUTH_INTERIOR_LAYER.fields(assets).mask;
    const lipVerts = skin.filter((v) => (lips[v] as number) > 0.05);
    const nearLips = (v: number) =>
      lipVerts.some(
        (u) =>
          Math.hypot(
            (P[v * 3] as number) - (P[u * 3] as number),
            (P[v * 3 + 1] as number) - (P[u * 3 + 1] as number),
            (P[v * 3 + 2] as number) - (P[u * 3 + 2] as number),
          ) < 0.01,
      );
    let worst = 0;
    let checked = 0;
    for (const [a, b] of edges) {
      if ((mouth[a] as number) > 0.05 || (mouth[b] as number) > 0.05) continue;
      if (area(a) === 0 && area(b) === 0) continue;
      if (nearLips(a) || nearLips(b)) continue;
      checked++;
      const length = Math.hypot(
        (P[a * 3] as number) - (P[b * 3] as number),
        (P[a * 3 + 1] as number) - (P[b * 3 + 1] as number),
        (P[a * 3 + 2] as number) - (P[b * 3 + 2] as number),
      );
      // The change per metre along the edge; a full change over a centimetre is 100.
      for (const part of ["moustache", "chin", "cheeks"] as const)
        worst = Math.max(
          worst,
          Math.abs((masks[part][a] as number) - (masks[part][b] as number)) / length,
        );
    }
    expect(checked).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(100);
  });

  it("cover a beard's worth of skin on each side", () => {
    let left = 0;
    let right = 0;
    for (const v of skin)
      if (area(v) > 0.5) {
        if ((P[v * 3] as number) > 0.005) left++;
        else if ((P[v * 3] as number) < -0.005) right++;
      }
    expect(left).toBeGreaterThan(40);
    expect(Math.abs(left - right)).toBeLessThan(0.1 * left);
  });
});
