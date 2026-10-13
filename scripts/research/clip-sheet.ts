/**
 * A quick contact sheet of an authored clip, drawn in Node without a browser:
 * the figure's skinned body, flat-shaded and orthographic, from the front and
 * from its left side, at evenly spaced frames, each lifted onto the ground as
 * the renderer lifts it (`posedGroundOffset`). For iterating on the key poses
 * in `scripts/clips/`; the browser sheets remain the visual proof.
 *
 *   node scripts/research/clip-sheet.ts <clip.json> [out.png] [--frames 8]
 *     [--figure average@25] [--views front,side,back,top]
 */
import path from "node:path";
import { groupFaces } from "../../src/format/assetFormat.ts";
import type { MacroValues } from "../../src/makehuman/macro.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { posedGroundOffset, restBones, rigData, skinPositions } from "../../src/rig/pose.ts";
import { loadFixtureAssets } from "../../tests/fixtures.ts";
import { authoredClips } from "../lib/authoredClips.ts";
import { type Raster, raster, writeRaster } from "../lib/upscale/raster.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1] ?? fallback;
  args.splice(i, 2);
  return v;
};
const count = Number(option("frames", "8"));
const [type = "average", age = "25"] = option("figure", "average@25").split("@");
const views = option("views", "front,side").split(",");
const [clipFile, outArg] = args;
if (!clipFile) throw new Error("usage: clip-sheet.ts <clip.json> [out.png]");
const out = outArg ?? clipFile.replace(/\.json$/, ".png");

const TYPES: Record<string, Partial<MacroValues>> = {
  slim: { gender: 1, weight: 0.1 },
  average: { gender: 0.5 },
  heavy: { gender: 0, weight: 0.95, muscle: 0.8 },
};
const assets = loadFixtureAssets();
const rig = rigData(assets);
const clip = authoredClips(rig.poses, rig.bones, path.dirname(path.resolve(clipFile))).find((c) =>
  c.file.endsWith(`/${path.basename(clipFile)}`),
);
if (!clip) throw new Error(`no clip in ${clipFile}`);
const ev = new HumanoidModel(assets, { subdivision: 0 }).evaluate(
  createRecipe({ macros: { age: Number(age), ...TYPES[type] } }),
);
const rest = restBones(assets, ev.control);
const faces = groupFaces(assets, "body");
const bodyVertices = new Uint32Array(
  new Set(
    Array.from(faces).flatMap((q) =>
      [0, 1, 2, 3].map((k) => assets.faceVerts[q * 4 + k] as number),
    ),
  ),
);
const skin = { skinIndex: assets.skinIndex, skinWeight: assets.skinWeight, bodyVertices };

const CELL = 300;
const SCALE = CELL / 2.1; // pixels per metre: a 2.1 m tall cell
const sheet = raster(CELL * count, CELL * views.length, 3);
sheet.data.fill(0.93);

/** Projects a point for a view: screen x, screen y (up), depth (larger is nearer). */
const project: Record<string, (x: number, y: number, z: number) => [number, number, number]> = {
  front: (x, y, z) => [-x, y, z],
  side: (x, y, z) => [z, y, x],
  back: (x, y, z) => [x, y, -z],
  top: (x, _y, z) => [-x, -z + 1, _y],
};

function draw(target: Raster, ox: number, oy: number, posed: Float32Array, view: string) {
  const p = project[view];
  if (!p) throw new Error(`no view ${view}`);
  const depth = new Float32Array(CELL * CELL).fill(Number.NEGATIVE_INFINITY);
  for (let x = 0; x < CELL; x++) {
    const fy = CELL - 12;
    const i = ((oy + fy) * target.width + ox + x) * 3;
    target.data.fill(0.6, i, i + 3);
  }
  const screen = (v: number): [number, number, number] => {
    const [sx, sy, d] = p(
      posed[v * 3] as number,
      posed[v * 3 + 1] as number,
      posed[v * 3 + 2] as number,
    );
    return [CELL / 2 + sx * SCALE, CELL - 12 - sy * SCALE, d];
  };
  for (const q of faces) {
    const vs = [0, 1, 2, 3].map((k) => assets.faceVerts[q * 4 + k] as number);
    const pts = vs.map(screen);
    for (const [a, b, c] of [
      [0, 1, 2],
      [0, 2, 3],
    ] as const) {
      const A = pts[a] as [number, number, number];
      const B = pts[b] as [number, number, number];
      const C = pts[c] as [number, number, number];
      const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (Math.abs(area) < 1e-9) continue;
      // Shade by the triangle's normal in view space against a light from the upper left front.
      const [ux, uy, uz] = [B[0] - A[0], B[1] - A[1], (B[2] - A[2]) * SCALE];
      const [wx, wy, wz] = [C[0] - A[0], C[1] - A[1], (C[2] - A[2]) * SCALE];
      const nx = uy * wz - uz * wy;
      const ny = uz * wx - ux * wz;
      const nzRaw = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nzRaw) || 1;
      const nz = Math.abs(nzRaw / len);
      const light =
        0.25 + 0.75 * Math.max(0, Math.abs((-0.4 * nx - 0.5 * ny + 0.77 * nzRaw) / len));
      const shade = 0.15 + 0.85 * (0.5 * light + 0.5 * nz);
      const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
      const maxX = Math.min(CELL - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
      const maxY = Math.min(CELL - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
          const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const d = w0 * A[2] + w1 * B[2] + w2 * C[2];
          if (d <= (depth[y * CELL + x] as number)) continue;
          depth[y * CELL + x] = d;
          const i = ((oy + y) * target.width + ox + x) * 3;
          target.data[i] = shade * 0.86;
          target.data[i + 1] = shade * 0.7;
          target.data[i + 2] = shade * 0.6;
        }
    }
  }
}

const rotations = new Float32Array(rig.bones.length * 4);
const posed = new Float32Array(ev.control.length);
for (let r = 0; r < count; r++) {
  const f = clip.loop
    ? Math.round((r * clip.frames) / count)
    : Math.round((r * (clip.frames - 1)) / Math.max(1, count - 1));
  rotations.fill(0);
  for (let b = 0; b < rig.bones.length; b++) rotations[b * 4 + 3] = 1;
  for (const [b, q] of clip.frame(f)) rotations.set(q, b * 4);
  skinPositions(rest, rotations, ev.control, assets.skinIndex, assets.skinWeight, posed);
  const lift = posedGroundOffset(rest, rotations, ev.control, skin);
  for (let i = 1; i < posed.length; i += 3) posed[i] = (posed[i] as number) + lift;
  for (const [c, view] of views.entries()) draw(sheet, r * CELL, c * CELL, posed, view);
}
await writeRaster(sheet, out, 8);
console.log(`${out}: ${clip.id}, ${count} of ${clip.frames} frames, ${views.join("/")}`);
