/**
 * The miniature lab (docs/MINIATURES.md): bakes a few dressed archetypes and
 * draws each level of detail beside the undecimated figure, large and at the
 * sizes a strategy table shows them (120 and 48 pixels tall), with the CPU
 * rasteriser, so a decimation change can be judged in seconds. The stress lab
 * in the playground (`?miniatures=500`) is the real renderer's view.
 *
 *   node scripts/research/miniature-lab.ts [out-dir] [pose]
 *
 * Writes `miniature-lab.png` (default `~/.cache/humanoid-kit/miniature-lab/`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  bakeMiniature,
  type DecodedTexture,
  type MiniatureBake,
} from "../../src/bake/miniature.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { bodyPoseRotations, rigData } from "../../src/rig/pose.ts";
import { srgbToLinear } from "../../src/surface/skinTone.ts";
import { bodyDir, clothingDir, loadMiniatureAssets } from "../../tests/fixtures.ts";
import { type Camera, montage, render, type Vec3, writePng } from "./chest-foundation/raster.ts";

const out = path.resolve(
  process.argv[2] ?? path.join(os.homedir(), ".cache/humanoid-kit/miniature-lab"),
);
const poseName = process.argv[3] ?? "relaxed";
fs.mkdirSync(out, { recursive: true });

const assets = loadMiniatureAssets();
const model = new HumanoidModel(assets, { subdivision: 0 });
const rig = rigData(assets);
const pose = bodyPoseRotations(rig, poseName);

// Every garment texture, decoded before the (synchronous) bakes.
const textures = new Map<string, DecodedTexture>();
for (const [dir, entries] of [
  // loadMiniatureAssets loads the one CC0 clothing pack, from clothingDir.
  [clothingDir, assets.clothingManifests.flatMap((m) => m.garments.entries)],
  [bodyDir, assets.manifest.attachments.entries],
] as const)
  for (const g of entries) {
    const file = g.material.texture;
    if (!file || textures.has(file)) continue;
    const { data, info } = await sharp(path.join(dir, file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    textures.set(file, { width: info.width, height: info.height, data: new Uint8Array(data) });
  }
const texture = (p: { material: { texture: string | null } | null }) =>
  (p.material?.texture && textures.get(p.material.texture)) || null;

const archetypes = [
  createRecipe({
    macros: { gender: 1, age: 30 },
    outfit: ["suits/male_worksuit01", "shoes/shoes01", "hats/fedora01"],
  }),
  createRecipe({
    macros: { gender: 0, age: 30 },
    outfit: ["suits/female_elegantsuit01", "shoes/shoes04"],
    hair: { style: null, colour: { eumelanin: 0.8, pheomelanin: 0.2, grey: 0, override: null } },
  }),
  createRecipe({
    macros: { gender: 0.6, age: 45, muscle: 0.7 },
    skin: { melanin: 0.8 },
    outfit: ["suits/male_casualsuit02", "shoes/shoes02"],
  }),
];

/** One frame of a bake (frame 0) as a raster scene, at a level of detail. */
const sceneOf = (bake: MiniatureBake, lod: number) => {
  const n = bake.vertexCount;
  const colours = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) colours[i] = srgbToLinear(bake.colour[i] as number);
  const level = bake.lods[lod] as MiniatureBake["lods"][number];
  return {
    positions: bake.positions.subarray(0, n * 3),
    normals: level.normals.subarray(0, n * 3),
    index: level.index,
    colours,
    colourWeight: 1,
  };
};

const camera = (yaw: number, h: number): Camera => {
  const d = 6;
  const eye: Vec3 = [Math.sin(yaw) * d, h * 0.55, Math.cos(yaw) * d];
  return { eye, target: [0, h * 0.5, 0], ortho: h * 0.55 };
};

const W = 200;
const H = 280;
/** A small render scaled back up with nearest neighbour, so the tile shows what that size can hold. */
const small = (scene: ReturnType<typeof sceneOf>, cam: Camera, px: number) => {
  const w = Math.round((px * W) / H);
  const img = render(scene, cam, "lit", w, px, 2);
  const up = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / W));
      const sy = Math.min(px - 1, Math.floor((y * px) / H));
      up.set(img.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * W + x) * 4);
    }
  return up;
};

const tiles: Uint8Array[] = [];
const report: string[] = [];
for (const recipe of archetypes) {
  const t0 = performance.now();
  const bake = bakeMiniature(model, recipe, { pose, texture });
  const ms = performance.now() - t0;
  const full = bakeMiniature(model, recipe, { pose, texture, body: "surface", lods: [1e9] });
  const h = bake.max[1];
  report.push(
    `${recipe.outfit?.join("+")}: ${bake.vertexCount} vertices, LODs ${bake.lods
      .map((l) => l.index.length / 3)
      .join("/")} triangles, full ${(full.lods[0]?.index.length ?? 0) / 3}, ${ms.toFixed(0)} ms`,
  );
  const front = camera(0, h);
  const three = camera(0.7, h);
  tiles.push(
    render(sceneOf(full, 0), front, "lit", W, H),
    render(sceneOf(bake, 0), front, "lit", W, H),
    render(sceneOf(bake, 1), front, "lit", W, H),
    render(sceneOf(bake, 0), three, "lit", W, H),
    render(sceneOf(bake, 0), front, "wire", W, H),
    small(sceneOf(bake, 0), three, 120),
    small(sceneOf(bake, 1), three, 48),
  );
}
const sheet = montage(tiles, W, H, 7);
const file = path.join(out, `miniature-lab-${poseName}.png`);
writePng(file, sheet.data, sheet.width, sheet.height);
console.log(
  `${file}\ncolumns: full figure | near LOD | far LOD | near 3/4 | near wire | near at 120 px | far at 48 px`,
);
console.log(report.join("\n"));
