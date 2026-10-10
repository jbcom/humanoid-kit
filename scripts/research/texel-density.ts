/**
 * Measures how finely every raster the packs ship (and the per-figure bakes in
 * body UV space) resolves on the default figure, against the closest framings
 * the QA contact sheets use: the numbers behind docs/evidence/upscale-inventory.md.
 *
 *   node scripts/research/texel-density.ts <system-assets-dir> [--json out.json]
 *
 * Each packed texture is matched to the system-assets image it was packed
 * from, so the table also shows the density the source itself has. The
 * definitions (density, framings, coverage) are in scripts/lib/texelBudget.ts.
 */
import fs from "node:fs";
import path from "node:path";
import {
  COVERAGE,
  FRAMINGS,
  type FramingId,
  neededEdge,
  pxPerMm,
  texelDensity,
  triangles,
} from "../lib/texelBudget.ts";
import { readPacks, textureNeeds } from "../lib/textureNeeds.ts";

const FACE_BONES =
  /^(head|jaw|eye\.|oris|oculi|levator|orbicularis|risorius|temporalis|special|tongue)/;
/** The QA area a body vertex belongs to, by the bone it is most weighted to. */
const regionOfBone = (name: string): FramingId | "other" =>
  FACE_BONES.test(name)
    ? "face"
    : /^lowerarm/.test(name)
      ? "forearm"
      : /^(wrist|metacarpal|finger)/.test(name)
        ? "hand"
        : /^(foot|toe)/.test(name)
          ? "foot"
          : /^(spine|breast|pelvis|clavicle|neck)/.test(name)
            ? "torso"
            : "other";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : undefined;
const systemDir = args[0];
if (!systemDir) throw new Error("usage: texel-density.ts <system-assets-dir> [--json out.json]");
const packsDir = path.resolve(import.meta.dirname, "../../packs");

// The per-figure bakes in body UV space: the field atlas and the body-art texture, 1024² each.
const BAKE = 1024;
const assets = readPacks(packsDir);
const bones = assets.manifest.skeleton.bones.map((b) => b.name);
const vertexRegion = (v: number) => {
  let best = 0;
  for (let k = 1; k < 4; k++)
    if ((assets.skinWeight[v * 4 + k] as number) > (assets.skinWeight[v * 4 + best] as number))
      best = k;
  return regionOfBone(bones[assets.skinIndex[v * 4 + best] as number] ?? "");
};
const bodyGroup = assets.manifest.groups.find((g) => g.name === "body");
if (!bodyGroup) throw new Error("no body group");
const bodyTris = triangles(
  assets.positions,
  assets.uvs,
  assets.faceVerts,
  assets.faceUvs,
  bodyGroup.faceStart,
  bodyGroup.faceCount,
  vertexRegion,
);
const bakes = (["face", "forearm", "hand", "foot", "torso"] as const).map((framing) => {
  const tris = bodyTris.filter((t) => t.region === framing);
  return {
    framing,
    median: texelDensity(tris, BAKE, BAKE, 0.5),
    covered: texelDensity(tris, BAKE, BAKE, 1 - COVERAGE),
    needed: neededEdge(tris, framing),
  };
});

const needs = await textureNeeds(packsDir, systemDir);

const f2 = (x: number) => x.toFixed(2);
console.log(`Closest QA framings (DPR 2); coverage ${COVERAGE * 100}% of the area:`);
for (const [k, f] of Object.entries(FRAMINGS))
  console.log(`  ${k}: ${f2(pxPerMm(f))} px/mm at ${f.distance} m (${f.sheet})`);
console.log(
  "\nbody-UV bakes (field atlas, body art), 1024²: framing px/mm | median | covered | needed",
);
for (const b of bakes)
  console.log(
    `  ${b.framing} ${f2(pxPerMm(FRAMINGS[b.framing]))} | ${f2(b.median)} | ${f2(b.covered)} | ${b.needed}`,
  );
console.log(
  "\nsurface | texture | role | edge | source | framing px/mm | median | covered [at source] | needed | policy",
);
for (const n of needs) {
  const px = pxPerMm(FRAMINGS[n.framing]);
  console.log(
    [
      n.surface,
      n.texture,
      n.role + (n.cutout ? "+cutout" : ""),
      n.edge,
      `${path.relative(systemDir, n.source)} ${n.sourceEdge}`,
      `${n.framing} ${f2(px)}`,
      f2(n.median),
      `${f2(n.covered)} [${f2(n.coveredAtSource)}]${n.covered < px ? " UNDER" : ""}`,
      n.needed,
      n.policy,
    ].join(" | "),
  );
}
if (jsonOut)
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        framings: FRAMINGS,
        bakes,
        textures: needs.map(({ tris: _, source, ...n }) => ({
          ...n,
          source: path.relative(systemDir, source),
        })),
      },
      null,
      1,
    ),
  );
