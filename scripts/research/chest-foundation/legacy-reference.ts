/**
 * Renders the legacy chest as the named visual reference: the female frame at the
 * average cup (0.5/0.5), minimum and maximum size, and the male and mixed frames
 * at 0.5/0.5. Output goes to the lab cache; nothing is committed.
 *
 *   node scripts/research/chest-foundation/legacy-reference.ts [outDir]
 */
import fs from "node:fs";
import path from "node:path";
import { HumanoidModel } from "../../../src/model/humanoidModel.ts";
import { bodyManifest, loadFixtureAssets } from "../../../tests/fixtures.ts";
import { anchors, chestCameras, frameRecipe, type Lab, surfaceOf } from "./figure.ts";
import { montage, render, writePng } from "./raster.ts";

const out = path.resolve(
  process.argv[2] ?? `${process.env.HOME}/.cache/humanoid-kit/chest-foundation/legacy`,
);
fs.mkdirSync(out, { recursive: true });
const assets = loadFixtureAssets();
const lab: Lab = {
  assets,
  manifest: bodyManifest,
  model: new HumanoidModel(assets, { subdivision: 0, attachments: [] }),
};

const cases = [
  { id: "female-avg", gender: 0, size: 0.5, firm: 0.5 },
  { id: "female-min", gender: 0, size: 0, firm: 0.5 },
  { id: "female-max", gender: 0, size: 1, firm: 0.5 },
  { id: "mixed-avg", gender: 0.5, size: 0.5, firm: 0.5 },
  { id: "male-avg", gender: 1, size: 0.5, firm: 0.5 },
];

const W = 420;
const H = 420;
for (const mode of ["lit", "zebra"] as const) {
  const tiles: Uint8Array[] = [];
  for (const k of cases) {
    const control = lab.model.evaluate(
      frameRecipe({ gender: k.gender, breastSize: k.size, breastFirmness: k.firm }),
    ).control;
    const a = anchors(bodyManifest, control);
    const s = surfaceOf(lab, control, 1);
    for (const cam of Object.values(chestCameras(a))) tiles.push(render(s, cam, mode, W, H));
  }
  const m = montage(tiles, W, H, 4);
  const file = path.join(out, `legacy-${mode}.png`);
  writePng(file, m.data, m.width, m.height);
  console.log(
    file,
    "rows:",
    cases.map((c) => c.id).join(", "),
    "cols: front, 3/4 L, 3/4 R, profile",
  );
}
