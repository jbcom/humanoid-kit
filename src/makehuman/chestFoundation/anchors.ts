/** Source-derived chest landmarks from MakeHuman's shipped helper joints. */
import type { BodyManifest } from "../../format/assetFormat.ts";

export type ChestSide = "L" | "R";
export type Vec3 = [number, number, number];

export interface ChestAnchors {
  apex: Record<ChestSide, Vec3>;
  halfSpan: number;
  rise: number;
}

function joint(manifest: BodyManifest, control: Float32Array, name: string): Vec3 {
  const vertices = manifest.skeleton.joints[name];
  if (!vertices?.length) throw new Error(`no joint helper ${name}`);
  return [0, 1, 2].map(
    (axis) =>
      vertices.reduce((sum, vertex) => sum + (control[vertex * 3 + axis] as number), 0) /
      vertices.length,
  ) as Vec3;
}

export function chestAnchors(manifest: BodyManifest, control: Float32Array): ChestAnchors {
  const left = joint(manifest, control, "breast.L____tail");
  const right = joint(manifest, control, "breast.R____tail");
  const clavicleLeft = joint(manifest, control, "clavicle.L____head");
  return {
    apex: { L: left, R: right },
    halfSpan: Math.abs(left[0] - right[0]) / 2,
    rise: clavicleLeft[1] - left[1],
  };
}
