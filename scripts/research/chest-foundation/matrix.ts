/**
 * The first proof matrix: frame x size at average firmness, then firmness at fixed
 * size, from the figure-relative chest generator, drawn on the subdivided surface.
 *
 *   node scripts/research/chest-foundation/matrix.ts [outDir]
 */
import fs from "node:fs";
import path from "node:path";
import { HumanoidModel } from "../../../src/model/humanoidModel.ts";
import { bodyManifest, loadFixtureAssets } from "../../../tests/fixtures.ts";
import { chestFoundation } from "./chest.ts";
import { anchors, chestCameras, frameRecipe, type Lab, surfaceOf } from "./figure.ts";
import { bodyMesh } from "./mesh.ts";
import { type Camera, montage, render, writePng } from "./raster.ts";
import { chooseSupport, trunkMask } from "./support.ts";

const out = path.resolve(
  process.argv[2] ?? `${process.env.HOME}/.cache/humanoid-kit/chest-foundation/matrix`,
);
fs.mkdirSync(out, { recursive: true });
const assets = loadFixtureAssets();
const lab: Lab = {
  assets,
  manifest: bodyManifest,
  model: new HumanoidModel(assets, { subdivision: 0, attachments: [] }),
};
const mesh = bodyMesh(assets, bodyManifest);
const canonical = lab.model.evaluate(frameRecipe({ gender: 0 })).control;
const support = chooseSupport(
  mesh,
  canonical,
  anchors(bodyManifest, canonical),
  trunkMask(assets, bodyManifest),
);
const ctx = { mesh, support, manifest: bodyManifest };

const W = 360,
  H = 360;
const views = ["front", "three-quarter-l", "profile"];
function row(gender: number, size: number, firmness: number, mode: "lit" | "zebra" = "lit") {
  const control = lab.model.evaluate(frameRecipe({ gender })).control;
  const r = chestFoundation(ctx, control, { size, firmness, legacyShare: 1 - gender });
  const cams = chestCameras(r.anchors);
  const s = surfaceOf(lab, r.positions, 1);
  return views.map((v) => render(s, cams[v] as Camera, mode, W, H));
}
for (const [name, gender] of [
  ["female", 0],
  ["mixed", 0.5],
  ["male", 1],
] as const) {
  const sizes = [0, 0.5, 1];
  const tiles = sizes.flatMap((s) => row(gender, s, 0.5));
  const m = montage(tiles, W, H, 3);
  writePng(path.join(out, `${name}-size.png`), m.data, m.width, m.height);
  const f = [0, 1].flatMap((fm) => [0.5, 1].flatMap((s) => row(gender, s, fm)));
  const m2 = montage(f, W, H, 3);
  writePng(path.join(out, `${name}-firmness.png`), m2.data, m2.width, m2.height);
  console.log(
    name,
    "size rows: 0, .5, 1 at firm .5 | firmness rows: firm0 size .5, firm0 size 1, firm1 size .5, firm1 size 1",
  );
}
console.log(out);
