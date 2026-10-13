/**
 * The firmness-0 under-fold: is the hard line under the breast MakeHuman's own data?
 * On the average-tissue frame at size 1, firmness 0, compares MakeHuman's own figure
 * (the evaluator, no generator) with the generator's, and counts the body faces whose
 * normal turns more than 90 degrees from the same face at the average cup: a surface
 * that folds over itself. Renders MakeHuman's own fold close up.
 *
 *   node scripts/research/chest-foundation/fold-check.ts [age]
 */
import fs from "node:fs";
import path from "node:path";
import { anchors, surfaceOf } from "./figure.ts";
import { montage, render, writePng } from "./raster.ts";
import { candidateDir, cellRecipeAt, labSetup } from "./setup.ts";
import { chestTissue, legacyControl, libraryAt } from "./tissue.ts";

const age = Number(process.argv[2] ?? 25);
const { lab, ctx, ages } = labSetup();
const recipe = cellRecipeAt(age);
const own = legacyControl(lab, recipe, 1, 0);
const avg = legacyControl(lab, recipe, 0.5, 0.5);
const gen = chestTissue(ctx, libraryAt(ages, age), avg, { size: 1, firmness: 0 }).positions;
let max = 0;
for (let i = 0; i < own.length; i++)
  max = Math.max(max, Math.abs((own[i] as number) - (gen[i] as number)));
console.log(`generator vs MakeHuman at (1, 0): max |diff| ${max.toExponential(2)} m`);

function flipped(positions: Float32Array) {
  const s = surfaceOf(lab, positions, 1);
  const ref = surfaceOf(lab, avg, 1);
  const n = (p: Float32Array, t: number) => {
    const [a, b, c] = [0, 1, 2].map((k) => (s.index[t * 3 + k] as number) * 3);
    const u = [0, 1, 2].map(
      (k) => (p[(b as number) + k] as number) - (p[(a as number) + k] as number),
    );
    const v = [0, 1, 2].map(
      (k) => (p[(c as number) + k] as number) - (p[(a as number) + k] as number),
    );
    return [
      (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
      (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
      (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
    ];
  };
  let count = 0;
  for (let t = 0; t < s.index.length / 3; t++) {
    const x = n(s.positions, t);
    const y = n(ref.positions, t);
    if (
      (x[0] as number) * (y[0] as number) +
        (x[1] as number) * (y[1] as number) +
        (x[2] as number) * (y[2] as number) <
      0
    )
      count++;
  }
  return count;
}
console.log(`MakeHuman's own (1, 0): ${flipped(own)} folded faces; generator's: ${flipped(gen)}`);

const a = anchors(lab.manifest, own);
const apex = a.apex.L;
const cams = [
  { eye: [apex[0], apex[1] - 0.25, apex[2] + 0.35] as const, target: apex, ortho: 0.09 },
  { eye: [apex[0] + 0.4, apex[1] - 0.05, apex[2]] as const, target: apex, ortho: 0.09 },
];
const tiles = (["lit", "zebra"] as const).flatMap((mode) =>
  cams.map((c) => render(surfaceOf(lab, own, 2), c, mode, 360, 360)),
);
const m = montage(tiles, 360, 360, 4);
const dir = candidateDir();
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `fold-makehuman-a${age}.png`);
writePng(file, m.data, m.width, m.height);
console.log(file);
