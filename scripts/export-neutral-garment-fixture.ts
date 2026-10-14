/** Private, portable indexed arrays from the public whole-figure CPU contract. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { figureAtRest, poseFigure } from "../src/bake/figure.ts";
import { parseHumanoidAssets, SKIN_INFLUENCES } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyPoseRotations, rigData, skinPositions } from "../src/rig/pose.ts";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(root, process.argv[2] ?? ".agent-state/neutral-garment-fixture");
fs.mkdirSync(output, { recursive: true });
const manifest = (pack: string) =>
  JSON.parse(fs.readFileSync(path.join(root, `packs/${pack}/data/manifest.json`), "utf8"));
const bytes = (pack: string, file: string) => {
  const b = gunzipSync(fs.readFileSync(path.join(root, `packs/${pack}/data`, file)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const body = manifest("body");
const clothing = manifest("clothing");
assert.equal(body.body.sha256, "6b78609d31cd8db52cd43be177cd1681c7981b515bc17fbf0b671c98c083d238");
assert.equal(body.topology, "makehuman-hm08");
assert.equal(clothing.source.license, "CC0-1.0");
const assets = parseHumanoidAssets(
  {
    manifest: body,
    body: bytes("body", body.body.file),
    targets: Object.fromEntries(
      body.targets.map((t: { id: string; file: string }) => [t.id, bytes("body", t.file)]),
    ),
    attachments: bytes("body", body.attachments.file),
    bodyOcclusion: bytes("body", body.bodyOcclusion.file),
  },
  undefined,
  { manifest: clothing, garments: bytes("clothing", clothing.garments.file) },
);
const model = new HumanoidModel(assets, { subdivision: 1 });
const recipe = createRecipe({ outfit: ["suits/male_casualsuit01"] });
const rest = figureAtRest(model, recipe, { body: "surface" });
assert.deepEqual(
  rest.parts.map((p) => p.id),
  ["body", "suits/male_casualsuit01"],
);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
type ArrayData = Float32Array | Uint32Array | Uint8Array | Uint16Array;
const raw = (a: ArrayData) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const save = (name: string, source: ArrayData) => {
  const copy = source.slice(); // Consumers own these arrays; no renderer adapter or shared scratch.
  assert.notEqual(copy.buffer, source.buffer);
  const file = `${name}.bin`;
  fs.writeFileSync(path.join(output, file), raw(copy));
  return {
    file,
    type: copy.constructor.name,
    length: copy.length,
    byteLength: copy.byteLength,
    sha256: sha(raw(copy)),
  };
};
const parts = rest.parts.map((p, i) => {
  const vertices = p.rest.length / 3;
  assert.equal(p.restNormals.length, vertices * 3);
  assert.equal(p.uvs?.length, vertices * 2);
  assert.equal(p.skinIndex.length, vertices * SKIN_INFLUENCES);
  assert.equal(p.skinWeight.length, vertices * SKIN_INFLUENCES);
  assert.equal(p.bodyRegion.length, vertices);
  assert.equal(p.index.length % 3, 0);
  for (const index of p.index) assert.ok(index < vertices);
  for (const values of [p.rest, p.restNormals, p.uvs!, p.skinWeight])
    for (const n of values) assert.ok(Number.isFinite(n));
  if (p.role === "garment") {
    const topology = model.garmentTopology(p.id);
    assert.deepEqual(p.uvs, topology.uvs); // Exact vertex/chart correspondence before any clipping or welding.
    assert.equal(p.rest.length, (topology.skinWeight.length / SKIN_INFLUENCES) * 3);
  }
  const arrays = Object.fromEntries(
    ["rest", "restNormals", "index", "uvs", "skinIndex", "skinWeight", "bodyRegion"].map((key) => [
      key,
      save(`part-${i}-${key}`, p[key as keyof typeof p] as ArrayData),
    ]),
  );
  const geometryHash = createHash("sha256")
    .update(raw(p.rest))
    .update(raw(p.index))
    .update(raw(p.uvs!))
    .digest("hex");
  const texture = p.material?.texture;
  if (texture)
    fs.copyFileSync(path.join(root, "packs/clothing/data", texture), path.join(output, texture));
  return {
    id: p.id,
    role: p.role,
    kind: p.kind,
    vertexCount: vertices,
    triangleCount: p.index.length / 3,
    geometryHash,
    material: p.material,
    textureUrl: texture ?? null,
    arrays,
  };
});
const stable = rest.parts.map((p) =>
  [p.rest, p.restNormals, p.index, p.uvs!].map((a) => sha(raw(a))),
);
const poses = ["relaxed", "overhead"].map((name) => {
  const fig = poseFigure(rest, bodyPoseRotations(rigData(assets), name));
  assert.deepEqual(
    rest.parts.map((p) => [p.rest, p.restNormals, p.index, p.uvs!].map((a) => sha(raw(a)))),
    stable,
  );
  let minY = Infinity;
  const posed = fig.parts.map((p, i) => {
    assert.equal(p.positions.length, rest.parts[i]!.rest.length);
    assert.equal(p.normals.length, p.positions.length);
    const sourcePart = rest.parts[i];
    assert.ok(sourcePart);
    const unlifted = skinPositions(
      rest.bones,
      fig.rotations,
      sourcePart.rest,
      sourcePart.skinIndex,
      sourcePart.skinWeight,
      new Float32Array(p.positions.length),
      i === 0 ? rest.folds : undefined,
    );
    for (let v = 0; v < p.positions.length; v++) {
      const expected = Math.fround((unlifted[v] as number) + (v % 3 === 1 ? fig.groundOffset : 0));
      assert.equal(p.positions[v], expected);
    }
    for (const v of p.index) minY = Math.min(minY, p.positions[v * 3 + 1] as number);
    return {
      id: p.id,
      positions: save(`${name}-part-${i}-positions`, p.positions),
      normals: save(`${name}-part-${i}-normals`, p.normals),
    };
  });
  assert.ok(Number.isFinite(minY));
  return {
    name,
    lowestVisibleY: minY,
    groundOffset: fig.groundOffset,
    grounding: "already applied once to every part; do not apply again",
    rotations: save(`${name}-rotations`, fig.rotations),
    parts: posed,
  };
});
assert.notEqual(poses[0]!.parts[1]!.positions.sha256, poses[1]!.parts[1]!.positions.sha256);
const receipt = {
  format: 1,
  unit: "metre",
  byteOrder: "little-endian",
  topology: body.topology,
  bodySha256: body.body.sha256,
  source: {
    body: body.source,
    clothing: clothing.source,
    garment: clothing.garments.entries.find((g: { id: string }) => g.id === recipe.outfit![0]),
  },
  contract:
    "Copied indexed arrays; canonical rest in model space before ground lift; UV per vertex in the part's own authored chart; visible triangle indices",
  geometryHashAlgorithm: "SHA256(rest Float32 bytes || index Uint32 bytes || UV Float32 bytes)",
  skinInfluences: SKIN_INFLUENCES,
  recipe,
  parts,
  poses,
  assertions: {
    indexRange: true,
    uvVertexCorrespondence: true,
    staticRestBothPoses: true,
    copiedArrays: true,
    sharedGroundLiftOnce: true,
    distinctGarmentPoses: true,
  },
};
fs.writeFileSync(path.join(output, "fixture.json"), JSON.stringify(receipt, null, 2));
console.log(
  JSON.stringify({
    output,
    parts: parts.map((p) => ({
      id: p.id,
      vertexCount: p.vertexCount,
      triangleCount: p.triangleCount,
      geometryHash: p.geometryHash,
    })),
    poses: poses.map((p) => ({ name: p.name, groundOffset: p.groundOffset })),
    assertions: receipt.assertions,
  }),
);
