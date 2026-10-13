/**
 * The proof matrix: frame x size at average firmness, then firmness at fixed size,
 * drawn on the subdivided surface. The frames are recipes with different frame
 * macro values; the generator only ever sees each one's evaluated control mesh.
 *
 *   node scripts/research/chest-foundation/matrix.ts [outDir] [--procedural]
 *
 * Default: the data-first generator (tissue.ts). `--procedural` draws the rejected
 * procedural diagnostic (chest.ts) on the same measured flat baseline.
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
import { chestTissue, type TissueCtx, tissueLibrary } from "./tissue.ts";

const args = process.argv.slice(2);
const procedural = args.includes("--procedural");
const out = path.resolve(
  args.find((a) => !a.startsWith("--")) ??
    `${process.env.HOME}/.cache/humanoid-kit/chest-foundation/matrix`,
);
fs.mkdirSync(out, { recursive: true });
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
const library = tissueLibrary(ctx, lab, cellRecipe);

const W = 360,
  H = 360;
const views = ["front", "three-quarter-l", "profile"];
function row(frame: number, size: number, firmness: number, mode: "lit" | "zebra" = "lit") {
  const control = lab.model.evaluate(frameRecipe({ gender: frame })).control;
  const r = procedural
    ? chestFoundation({ ...ctx, library }, control, { size, firmness })
    : chestTissue(ctx, library, control, { size, firmness });
  const cams = chestCameras(r.anchors);
  const s = surfaceOf(lab, r.positions, 1);
  return views.map((v) => render(s, cams[v] as Camera, mode, W, H));
}
const tag = procedural ? "procedural-" : "";
for (const frame of [0, 0.5, 1]) {
  const name = `${tag}frame${frame}`;
  const tiles = [0, 0.5, 1].flatMap((s) => row(frame, s, 0.5));
  const m = montage(tiles, W, H, 3);
  writePng(path.join(out, `${name}-size.png`), m.data, m.width, m.height);
  const f = [0, 1].flatMap((fm) => [0.5, 1].flatMap((s) => row(frame, s, fm)));
  const m2 = montage(f, W, H, 3);
  writePng(path.join(out, `${name}-firmness.png`), m2.data, m2.width, m2.height);
  const z = [0, 0.5, 1].flatMap((s) => row(frame, s, 0.5, "zebra"));
  const m3 = montage(z, W, H, 3);
  writePng(path.join(out, `${name}-zebra.png`), m3.data, m3.width, m3.height);
  console.log(
    name,
    "size rows: 0, .5, 1 at firm .5 | firmness rows: firm0 size .5, firm0 size 1, firm1 size .5, firm1 size 1 | zebra: size 0, .5, 1",
  );
}
console.log(out);
