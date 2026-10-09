/**
 * Measures how finely every raster the packs ship (and the per-figure bakes in
 * body UV space) resolves on the default figure, against the closest framings
 * the QA contact sheets use: the numbers behind docs/evidence/upscale-inventory.md.
 *
 *   node scripts/research/texel-density.ts [<system-assets-dir>] [--json out.json]
 *
 * Given the extracted MakeHuman system assets, each packed texture is matched to
 * its source image, so the table also shows the density the source itself has.
 * The definitions (density, framings, coverage) are in scripts/lib/texelBudget.ts.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { addHairStyle, parseHumanoidAssets } from "../../src/format/assetFormat.ts";
import { bodyDir, bodyPackData, clothingDir, clothingPackData } from "../../tests/fixtures.ts";
import { hairDir, hairManifest, hairStyleBin } from "../../tests/hairFixtures.ts";
import {
  boundTriangles,
  COVERAGE,
  FRAMINGS,
  type FramingId,
  neededEdge,
  pxPerMm,
  shippedEdge,
  type Tri,
  texelDensity,
  triangles,
} from "../lib/texelBudget.ts";

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
const systemAssets = args[0];

const assets = parseHumanoidAssets(bodyPackData(), undefined, clothingPackData(), {
  manifest: hairManifest,
});
for (const s of hairManifest.styles) addHairStyle(assets, s.id, hairStyleBin(s.id));

const bones = assets.manifest.skeleton.bones.map((b) => b.name);
const vertexRegion = (v: number) => {
  let best = 0;
  for (let k = 1; k < 4; k++)
    if ((assets.skinWeight[v * 4 + k] as number) > (assets.skinWeight[v * 4 + best] as number))
      best = k;
  return regionOfBone(bones[assets.skinIndex[v * 4 + best] as number] ?? "");
};

const sources = systemAssets
  ? fs
      .readdirSync(systemAssets, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith("skins"))
  : [];
/** The system-assets image a packed texture came from, by its file stem or its asset's folder. */
const sourceOf = (packed: string): string | undefined => {
  const stem = path.basename(packed, ".webp");
  const hits = sources.filter((f) => {
    const s = path.basename(f).replace(/\.[^.]+$/, "");
    const dir = path.basename(path.dirname(f));
    return stem.endsWith(`_${s}`) || s === stem || (dir === stem && s.endsWith("_diffuse"));
  });
  return hits.length ? path.join(systemAssets as string, hits.sort()[0] as string) : undefined;
};
const edgeOf = async (file: string) => {
  const m = await sharp(file).metadata();
  return Math.max(m.width as number, m.height as number);
};

interface Reading {
  framing: FramingId;
  pxPerMm: number;
  /** Area-weighted median texels/mm at the shipped size. */
  median: number;
  /** Texels/mm that `COVERAGE` of the area meets, at the shipped size and at the source's. */
  covered: number;
  coveredAtSource: number | null;
  /** The power-of-two edge `COVERAGE` of the area needs, and what the policy ships. */
  needed: number;
  policy: number | null;
}
interface Row {
  surface: string;
  texture: string;
  edge: number;
  source: { file: string; edge: number } | null;
  readings: Reading[];
}

function reading(
  tris: readonly Tri[],
  edge: number,
  framing: FramingId,
  sourceEdge: number | null,
): Reading {
  const needed = neededEdge(tris, framing);
  return {
    framing,
    pxPerMm: pxPerMm(FRAMINGS[framing]),
    median: texelDensity(tris, edge, edge, 0.5),
    covered: texelDensity(tris, edge, edge, 1 - COVERAGE),
    coveredAtSource: sourceEdge ? texelDensity(tris, sourceEdge, sourceEdge, 1 - COVERAGE) : null,
    needed,
    policy: sourceEdge ? shippedEdge(needed, sourceEdge, edge) : null,
  };
}

const rows: Row[] = [];
async function measure(
  surface: string,
  texture: string,
  dir: string,
  tris: Tri[],
  framing: FramingId,
) {
  const edge = await edgeOf(path.join(dir, texture));
  const src = sourceOf(texture);
  const sourceEdge = src ? await edgeOf(src) : null;
  rows.push({
    surface,
    texture,
    edge,
    source:
      src && sourceEdge
        ? { file: path.relative(systemAssets as string, src), edge: sourceEdge }
        : null,
    readings: [reading(tris, edge, framing, sourceEdge)],
  });
}

// The per-figure bakes in body UV space: the field atlas and the body-art texture, 1024² each.
const BAKE = 1024;
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
rows.push({
  surface: "body",
  texture: "field atlas, body-art bake (per figure)",
  edge: BAKE,
  source: null,
  readings: (["face", "forearm", "hand", "foot", "torso"] as const).map((r) =>
    reading(
      bodyTris.filter((t) => t.region === r),
      BAKE,
      r,
      null,
    ),
  ),
});

for (const [id, a] of assets.attachments)
  if (a.entry.material.texture)
    await measure(
      id,
      a.entry.material.texture,
      bodyDir,
      boundTriangles(a, assets.positions),
      "face",
    );
for (const [id, a] of assets.hair?.bound ?? [])
  if (a.entry.material.texture)
    await measure(
      `hair ${id}`,
      a.entry.material.texture,
      hairDir,
      boundTriangles(a, assets.positions),
      "face",
    );
for (const [id, g] of assets.garments) {
  const tris = boundTriangles(g, assets.positions);
  // A hat is seen at the face's framing; the rest of a wardrobe at a clothed figure's.
  const framing: FramingId = g.entry.kind === "hat" ? "face" : "clothed";
  for (const t of [g.entry.material.texture, g.entry.material.normalTexture])
    if (t) await measure(id, t, clothingDir, tris, framing);
}

console.log(`Closest QA framings (DPR 2); coverage ${COVERAGE * 100}% of the area:`);
for (const [k, f] of Object.entries(FRAMINGS))
  console.log(`  ${k}: ${pxPerMm(f).toFixed(2)} px/mm at ${f.distance} m (${f.sheet})`);
console.log(
  "\nsurface | texture | edge | source | framing px/mm | median | covered [at source] | needed | policy",
);
const f2 = (x: number) => x.toFixed(2);
for (const r of rows)
  for (const d of r.readings)
    console.log(
      [
        r.surface,
        r.texture,
        r.edge,
        r.source ? `${r.source.file} ${r.source.edge}` : "-",
        `${d.framing} ${f2(d.pxPerMm)}`,
        f2(d.median),
        `${f2(d.covered)}${d.coveredAtSource ? ` [${f2(d.coveredAtSource)}]` : ""}${d.covered < d.pxPerMm ? " UNDER" : ""}`,
        d.needed,
        d.policy ?? "-",
      ].join(" | "),
    );
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ framings: FRAMINGS, rows }, null, 1));
