/**
 * Close-up of the nipple cluster on the masculine frame at size 0, the known pinch:
 * MakeHuman's own frame, the flat baseline the generator builds, and zebra of both.
 * Prints the nipple cluster's depth along the surface normal relative to its ring.
 *
 *   node scripts/research/chest-foundation/pinch-check.ts [gender] [age]
 */
import fs from "node:fs";
import path from "node:path";
import { anchors, frameRecipe, surfaceOf } from "./figure.ts";
import { biharmonicFill, vertexNormals } from "./mesh.ts";
import { type Camera, montage, render, type Vec3, writePng } from "./raster.ts";
import { candidateDir, labSetup } from "./setup.ts";
import { chestTissue, libraryAt } from "./tissue.ts";

const gender = Number(process.argv[2] ?? 1);
const age = Number(process.argv[3] ?? 25);
const { lab, ctx, ages } = labSetup();
const lib = libraryAt(ages, age);
const control = lab.model.evaluate(frameRecipe({ gender, age })).control;
const a = anchors(lab.manifest, control);
const apex = a.apex.L;
const close = (eye: Vec3): Camera => ({ eye, target: apex, ortho: 0.045 });
const cams = [
  close([apex[0], apex[1], apex[2] + 0.4]),
  close([apex[0] + 0.3, apex[1] + 0.05, apex[2] + 0.25]),
];
const W = 360;
const tiles: Uint8Array[] = [];
const variants = [
  ["makehuman", control],
  ["s0", chestTissue(ctx, lib, control, { size: 0, firmness: 0.5 }).positions],
  ["s0.25", chestTissue(ctx, lib, control, { size: 0.25, firmness: 0.5 }).positions],
] as const;
for (const mode of ["lit", "zebra"] as const)
  for (const [, pos] of variants) {
    const s = surfaceOf(lab, pos, 2);
    for (const c of cams) tiles.push(render(s, c, mode, W, W));
  }
const r0 = chestTissue(ctx, lib, control, { size: 0, firmness: 0.5 });
console.log("sides", JSON.stringify(r0.sides));
// The deepest point of the flat baseline below the frame's own fill, near the apex.
const fill = biharmonicFill(ctx.mesh, control, Array.from(ctx.support.free));
const nrm = vertexNormals(ctx.mesh, fill);
let worst = 0,
  worstV = -1;
for (const v of ctx.support.free) {
  if (
    Math.hypot(...[0, 1, 2].map((k) => (control[v * 3 + k] as number) - (apex[k] as number))) > 0.03
  )
    continue;
  const below = [0, 1, 2].reduce(
    (s, k) =>
      s +
      ((r0.flat[v * 3 + k] as number) - (fill[v * 3 + k] as number)) * (nrm[v * 3 + k] as number),
    0,
  );
  if (below < worst) {
    worst = below;
    worstV = v;
  }
}
console.log(
  `deepest flat point within 30 mm of the apex: ${(worst * 1000).toFixed(2)} mm at v${worstV}`,
);
const m = montage(tiles, W, W, 6);
const dir = candidateDir();
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `pinch-g${gender}-a${age}.png`);
writePng(file, m.data, m.width, m.height);
console.log(
  file,
  "rows: lit, zebra; columns: (front, 3/4) x",
  variants.map((v) => v[0]).join(", "),
);
