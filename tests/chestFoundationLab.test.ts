/**
 * Gates for the data-first chest foundation lab (scripts/research/chest-foundation/tissue.ts).
 * The generator reads only the evaluated control mesh plus per-side size and firmness:
 * no gender, no frame macro, no recipe. These tests hold that boundary and the
 * legacy-identity contract on the frame that carries MakeHuman's average tissue.
 */
import { describe, expect, it } from "vitest";
import { anchors, frameRecipe, type Lab } from "../scripts/research/chest-foundation/figure.ts";
import { bodyMesh } from "../scripts/research/chest-foundation/mesh.ts";
import { chooseSupport, trunkMask } from "../scripts/research/chest-foundation/support.ts";
import {
  chestTissue,
  legacyControl,
  type TissueCtx,
  tissueLibrary,
} from "../scripts/research/chest-foundation/tissue.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const lab: Lab = {
  assets,
  manifest: bodyManifest,
  model: new HumanoidModel(assets, { subdivision: 0, attachments: [] }),
};
const mesh = bodyMesh(assets, bodyManifest);
const cellRecipe = frameRecipe({ gender: 0 });
const canonical = lab.model.evaluate(cellRecipe).control;
const support = chooseSupport(
  mesh,
  canonical,
  anchors(bodyManifest, canonical),
  trunkMask(assets, bodyManifest),
);
const ctx: TissueCtx = { mesh, support, manifest: bodyManifest };
const lib = tissueLibrary(ctx, lab, cellRecipe);

const maxDiff = (a: Float32Array, b: Float32Array) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs((a[i] as number) - (b[i] as number)));
  return m;
};
const both = (size: number, firmness: number) => ({
  L: { size, firmness },
  R: { size, firmness },
});

describe("chest foundation lab: legacy identity", () => {
  it("reproduces MakeHuman's average breast on the average-tissue frame", () => {
    const got = chestTissue(ctx, lib, canonical, both(0.5, 0.5)).positions;
    expect(maxDiff(got, legacyControl(lab, cellRecipe, 0.5, 0.5))).toBeLessThan(1e-5);
  });

  it("reproduces MakeHuman's maximum size on the same frame", () => {
    const got = chestTissue(ctx, lib, canonical, both(1, 0.5)).positions;
    expect(maxDiff(got, legacyControl(lab, cellRecipe, 1, 0.5))).toBeLessThan(1e-5);
  });

  it("fails the identity gate when the size is off (the gate can see a miss)", () => {
    const got = chestTissue(ctx, lib, canonical, both(0.6, 0.5)).positions;
    expect(maxDiff(got, legacyControl(lab, cellRecipe, 0.5, 0.5))).toBeGreaterThan(1e-3);
  });
});

describe("chest foundation lab: no gender input", () => {
  it("takes only the context, the library, the control mesh and the side params", () => {
    expect(chestTissue.length).toBe(4);
  });

  it("is byte-identical when the frame macro changes but the control mesh handed in does not", () => {
    const a = chestTissue(ctx, lib, canonical, both(0.75, 0.25)).positions;
    // Evaluate other frames in between: any hidden reliance on the model's last recipe
    // or on a gender-derived value would show up here.
    lab.model.evaluate(frameRecipe({ gender: 1 }));
    lab.model.evaluate(frameRecipe({ gender: 0.5, muscle: 1 }));
    const b = chestTissue(ctx, lib, Float32Array.from(canonical), both(0.75, 0.25)).positions;
    expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer))).toBe(true);
  });

  it("measures the carried tissue from the mesh: a masculine frame carries less", () => {
    const male = lab.model.evaluate(frameRecipe({ gender: 1 })).control;
    const avg = chestTissue(ctx, lib, canonical, both(0.5, 0.5));
    const masc = chestTissue(ctx, lib, male, both(0.5, 0.5));
    expect(masc.sides.L.share).toBeLessThan(avg.sides.L.share);
    expect(avg.sides.L.share).toBeCloseTo(1, 2);
  });
});
