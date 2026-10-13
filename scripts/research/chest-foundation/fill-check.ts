/** Shows the chest support and the biharmonic flat fill on the canonical female figure. */
import fs from "node:fs";
import path from "node:path";
import { HumanoidModel } from "../../../src/model/humanoidModel.ts";
import { bodyManifest, loadFixtureAssets } from "../../../tests/fixtures.ts";
import { anchors, chestCameras, controlScene, frameRecipe, type Lab } from "./figure.ts";
import { biharmonicFill, bodyMesh } from "./mesh.ts";
import { type Camera, montage, render, writePng } from "./raster.ts";
import { chooseSupport, trunkMask } from "./support.ts";

const out = `${process.env.HOME}/.cache/humanoid-kit/chest-foundation/fill`;
fs.mkdirSync(out, { recursive: true });
const assets = loadFixtureAssets();
const lab: Lab = {
  assets,
  manifest: bodyManifest,
  model: new HumanoidModel(assets, { subdivision: 0, attachments: [] }),
};
const mesh = bodyMesh(assets, bodyManifest);
const control = lab.model.evaluate(frameRecipe({ gender: 0 })).control;
const a = anchors(bodyManifest, control);
const sup = chooseSupport(mesh, control, a, trunkMask(assets, bodyManifest));
console.log(
  "body verts",
  mesh.vertices.length,
  "inside",
  sup.inside.reduce((s, x) => s + x, 0),
  "free",
  sup.free.length,
);
const t0 = Date.now();
const flat = biharmonicFill(mesh, control, Array.from(sup.free));
console.log("fill ms", Date.now() - t0);
let maxD = 0;
for (const v of sup.free)
  maxD = Math.max(
    maxD,
    Math.hypot(
      (flat[v * 3] as number) - (control[v * 3] as number),
      (flat[v * 3 + 1] as number) - (control[v * 3 + 1] as number),
      (flat[v * 3 + 2] as number) - (control[v * 3 + 2] as number),
    ),
  );
console.log("max fill displacement m", maxD.toFixed(4));
const colours = new Float32Array(control.length);
for (const v of mesh.vertices) {
  const i = sup.free.includes(v) ? 2 : sup.inside[v] ? 1 : 0;
  colours[v * 3] = i === 2 ? 0.2 : i === 1 ? 0.9 : 0.55;
  colours[v * 3 + 1] = i === 2 ? 0.9 : i === 1 ? 0.8 : 0.55;
  colours[v * 3 + 2] = i === 2 ? 0.3 : i === 1 ? 0.2 : 0.55;
}
const W = 420,
  H = 420,
  tiles: Uint8Array[] = [];
const cams = chestCameras(a);
for (const [ctrl, col] of [
  [control, colours],
  [control, undefined],
  [flat, undefined],
] as const)
  for (const k of ["front", "three-quarter-l", "profile"])
    tiles.push(
      render(
        controlScene(mesh, ctrl as Float32Array, col as Float32Array | undefined),
        cams[k] as Camera,
        "lit",
        W,
        H,
      ),
    );
const m = montage(tiles, W, H, 3);
writePng(path.join(out, "fill.png"), m.data, m.width, m.height);
console.log(path.join(out, "fill.png"), "rows: support zones, female avg, biharmonic flat");
