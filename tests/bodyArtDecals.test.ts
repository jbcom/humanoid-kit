import { describe, expect, it } from "vitest";
import { decalFrame, placeBodyArt } from "../src/bodyArt/decals.ts";
import { bodySites } from "../src/bodyArt/sites.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import type { Vec3 } from "../src/presence/presence.ts";
import { createBodyArt } from "../src/recipe/bodyArt.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

describe("a decal's frame", () => {
  it("is orthonormal and right-handed, its up the body's up laid into the skin", () => {
    const f = decalFrame([0, 1, 0.1], [0.2, 0.3, 1], 0);
    for (const a of [f.normal, f.right, f.up]) expect(Math.hypot(...a)).toBeCloseTo(1, 6);
    expect(dot(f.right, f.up)).toBeCloseTo(0, 6);
    expect(dot(f.right, f.normal)).toBeCloseTo(0, 6);
    expect(dot(f.up, f.normal)).toBeCloseTo(0, 6);
    // right × up is the outward normal: the decal reads unmirrored from outside.
    const n = cross(f.right, f.up);
    for (let k = 0; k < 3; k++) expect(n[k]).toBeCloseTo(f.normal[k] as number, 6);
    expect(f.up[1]).toBeGreaterThan(0.9);
    // Looking at the front of the body, its right is the viewer's right (+x).
    expect(decalFrame([0, 1, 0.1], [0, 0, 1], 0).right).toEqual([1, 0, 0]);
  });

  it("turns counter-clockwise looking at the skin", () => {
    const f = decalFrame([0, 0, 0], [0, 0, 1], 90);
    expect(f.right[1]).toBeCloseTo(1, 6);
    expect(f.up[0]).toBeCloseTo(-1, 6);
  });

  it("takes the body's forward as up where the skin faces up", () => {
    const f = decalFrame([0, 0, 0], [0, 1, 0], 0);
    expect(f.up).toEqual([0, 0, 1]);
    expect(Number.isFinite(f.right[0])).toBe(true);
  });
});

describe("placing body art on a figure", () => {
  it("puts each anchor on the morphed mesh, facing out of the body", () => {
    const control = assets.positions.slice();
    // A taller figure: the placement follows the shape it is given.
    for (let i = 1; i < control.length; i += 3) control[i] = (control[i] as number) * 1.1;
    const placed = placeBodyArt(
      assets,
      createBodyArt({
        tattoos: [{ image: "rose", at: "navel", size: 0.05, rotation: 30 }],
        scars: [{ at: "brow.L", length: 0.02 }],
        birthmarks: [{ kind: "port-wine", at: "brow.R", size: 0.04, seed: 3 }],
        vitiligo: { extent: 0.5 },
      }),
      control,
    );
    const navel = bodySites(assets).navel.vertex;
    expect(placed.tattoos[0]?.centre[1]).toBeCloseTo(control[navel * 3 + 1] as number, 6);
    // The belly faces forward; the left brow's end forward and to the left (+x).
    expect(placed.tattoos[0]?.normal[2]).toBeGreaterThan(0.8);
    expect(placed.marks[0]?.normal[2]).toBeGreaterThan(0.3);
    expect(placed.marks[0]?.normal[0]).toBeGreaterThan(0);
    expect(placed.tattoos[0]).toMatchObject({ image: "rose", width: 0.05, density: 1 });
    expect(placed.marks.map((m) => m.kind)).toEqual(["scar", "port-wine"]);
    expect(placed.marks[1]).toMatchObject({ length: 0.04, width: 0.04, seed: 3, maturity: 1 });
    expect(placed.vitiligo).toEqual({ extent: 0.5, seed: 0 });
  });

  it("comes with every evaluation of a recipe that has it, and only then", () => {
    const model = new HumanoidModel(assets, { subdivision: 1 });
    expect(model.evaluate(createRecipe()).bodyArt).toBeNull();
    const ev = model.evaluate(
      createRecipe({ bodyArt: { tattoos: [{ image: "rose", at: "navel", size: 0.05 }] } }),
    );
    const navel = bodySites(assets).navel.vertex;
    expect(ev.bodyArt?.tattoos[0]?.centre).toEqual([
      ev.control[navel * 3],
      ev.control[navel * 3 + 1],
      ev.control[navel * 3 + 2],
    ]);
    expect(() =>
      model.evaluate(createRecipe({ bodyArt: { scars: [{ at: 1e7, length: 0.02 }] } })),
    ).toThrow(RangeError);
  });

  it("refuses an anchor it cannot place", () => {
    const art = createBodyArt({ tattoos: [{ image: "x", at: "elbow", size: 0.05 }] });
    expect(() => placeBodyArt(assets, art, assets.positions)).toThrow(RangeError);
  });
});
