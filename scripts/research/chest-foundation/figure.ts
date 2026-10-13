/**
 * A figure as the chest lab sees it: the evaluated control mesh plus anchors read
 * from the figure's OWN skeleton joints (the helper-vertex groups the body pack
 * ships), so every length and position is figure-relative. Nothing here is a world
 * coordinate; a taller, shorter, broader or narrower body moves its anchors with it.
 */
import { buildSurfaceMesh, evaluateSurface } from "../../../src/build/surfaceMesh.ts";
import type { BodyManifest, HumanoidAssets } from "../../../src/format/assetFormat.ts";
import type { HumanoidModel } from "../../../src/model/humanoidModel.ts";
import { createRecipe, type Recipe } from "../../../src/recipe/recipe.ts";
import type { Camera, Vec3 } from "./raster.ts";

export interface Anchors {
  /** Per side (-1 left of the figure's +x? see `side`): the breast bone's tail, the nipple apex proxy. */
  apex: Record<"L" | "R", Vec3>;
  clavicleHead: Record<"L" | "R", Vec3>;
  shoulderTail: Record<"L" | "R", Vec3>;
  neck: Vec3;
  spine3: Vec3;
  spine4: Vec3;
  /** Half the distance between the two apexes: the figure's lateral chest scale. */
  halfSpan: number;
  /** Apex height to clavicle height: the figure's vertical chest scale. */
  rise: number;
}

export const joint = (manifest: BodyManifest, control: Float32Array, name: string): Vec3 => {
  const vs = (manifest.skeleton.joints as Record<string, number[]>)[name];
  if (!vs?.length) throw new Error(`no joint helper ${name}`);
  const p = [0, 1, 2].map(
    (a) => vs.reduce((s, v) => s + (control[v * 3 + a] as number), 0) / vs.length,
  );
  return [p[0] as number, p[1] as number, p[2] as number];
};

export function anchors(manifest: BodyManifest, control: Float32Array): Anchors {
  const j = (n: string) => joint(manifest, control, n);
  const apexL = j("breast.L____tail");
  const apexR = j("breast.R____tail");
  const claL = j("clavicle.L____head");
  return {
    apex: { L: apexL, R: apexR },
    clavicleHead: { L: claL, R: j("clavicle.R____head") },
    shoulderTail: { L: j("shoulder01.L____tail"), R: j("shoulder01.R____tail") },
    neck: j("neck01____head"),
    spine3: j("spine03____head"),
    spine4: j("spine04____head"),
    halfSpan: Math.abs(apexL[0] - apexR[0]) / 2,
    rise: claL[1] - apexL[1],
  };
}

export interface Lab {
  assets: HumanoidAssets;
  manifest: BodyManifest;
  model: HumanoidModel;
}

/** The adult macros the lab holds fixed unless a case varies them. */
export const FIXED = { age: 25, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5 } as const;

export function frameRecipe(over: Partial<Recipe["macros"]> & { gender: number }): Recipe {
  return createRecipe({
    macros: { ...FIXED, breastSize: 0.5, breastFirmness: 0.5, ...over },
  });
}

/** A body surface (render level `level`) of a control mesh, for drawing. */
export function surfaceOf(lab: Lab, control: Float32Array, level: 0 | 1 | 2) {
  const group = lab.manifest.groups.find((g) => g.name === "body");
  if (!group) throw new Error("body face group missing");
  const faces = Uint32Array.from({ length: group.faceCount }, (_, i) => group.faceStart + i);
  const mesh = buildSurfaceMesh(
    {
      vertexCount: lab.manifest.vertexCount,
      faceVerts: lab.assets.faceVerts,
      faceUvs: lab.assets.faceUvs,
      uvs: lab.assets.uvs,
      skinIndex: lab.assets.skinIndex,
      skinWeight: lab.assets.skinWeight,
    },
    faces,
    level,
  );
  const positions = new Float32Array(mesh.renderToSurface.length * 3);
  const normals = new Float32Array(positions.length);
  evaluateSurface(mesh, control, positions, normals);
  return { positions, normals, index: mesh.index, mesh };
}

/** The control mesh itself as a drawable scene (flat quads split in two), with optional per-vertex colours. */
export function controlScene(
  mesh: import("./mesh.ts").BodyMesh,
  control: Float32Array,
  colours?: Float32Array,
) {
  const index: number[] = [];
  for (let f = 0; f < mesh.faces.length; f += 4) {
    const a = mesh.faces[f] as number,
      b = mesh.faces[f + 1] as number,
      c = mesh.faces[f + 2] as number,
      d = mesh.faces[f + 3] as number;
    index.push(a, b, c, a, c, d);
  }
  return {
    positions: control,
    normals: vertexNormalsOf(mesh, control),
    index,
    ...(colours ? { colours } : {}),
  };
}

import { vertexNormals as vertexNormalsOf } from "./mesh.ts";

export function chestCameras(a: Anchors): Record<string, Camera> {
  const c: Vec3 = [0, a.apex.L[1] + 0.2 * a.rise, a.apex.L[2] * 0.55];
  const d = 6 * a.halfSpan;
  const half = 1.9 * a.rise;
  const at = (az: number): Vec3 => [c[0] + d * Math.sin(az), c[1], c[2] + d * Math.cos(az)];
  return {
    front: { eye: at(0), target: c, ortho: half },
    "three-quarter-l": { eye: at(-Math.PI / 4.5), target: c, ortho: half },
    "three-quarter-r": { eye: at(Math.PI / 4.5), target: c, ortho: half },
    profile: { eye: at(Math.PI / 2), target: [c[0], c[1], c[2]], ortho: half },
  };
}
