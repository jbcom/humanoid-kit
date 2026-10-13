/**
 * A graft on a model's figure (`HumanoidModel.graft`, docs/GRAFT.md): resolves
 * the cut on the base mesh at rest, then builds the graft on whichever body
 * surface an evaluation draws, the first time it draws it.
 */
import { evaluateSurface, type SurfaceMesh } from "../build/surfaceMesh.ts";
import { type HumanoidAssets, jointPosition } from "../format/assetFormat.ts";
import type { Evaluation } from "../model/humanoidModel.ts";
import { restBones } from "../rig/pose.ts";
import { type ControlMesh, type ResolvedCut, resolveFaceCut, resolvePlaneCut } from "./cut.ts";
import { buildGraft, type Graft, type GraftCutInput } from "./graft.ts";
import { CUT_SITES } from "./sites.ts";
import {
  GraftError,
  type GraftSpec,
  type GraftSurface,
  type GraftTopology,
  type Vec3,
} from "./types.ts";

/** One of the model's body surfaces, as built. */
export interface ModelSurface {
  mesh: SurfaceMesh;
  trianglesPerFace: number | Uint32Array;
  /** Per body face, 1 when the mounted attachments leave it shown. */
  visible: Uint8Array;
}

/** What a model gives a graft: its assets, its body faces, its surfaces and what it wears. */
export interface ModelGraftInput {
  assets: HumanoidAssets;
  bodyFaces: Uint32Array;
  base: ModelSurface;
  /** The adult surface, when the model has one. */
  adult: () => ModelSurface | null;
  attachments: readonly { id: string; refVerts: Uint32Array }[];
}

/** A graft on a model's figure, refit on each of its evaluations. */
export interface ModelGraft {
  /** The merged surface's topology for a body surface (the base one by default). */
  topology(surface?: "base" | "adult"): GraftTopology;
  /**
   * The graft on an evaluation: every merged vertex's position and normal, and,
   * when the evaluation carries its own skin (`Evaluation.skin`), the merged
   * skin with the body's part replaced by it.
   */
  evaluate(evaluation: Evaluation): GraftSurface & {
    surface: "base" | "adult";
    skin: { skinIndex: Uint16Array; skinWeight: Float32Array } | null;
  };
}

const joint = (assets: HumanoidAssets, name: string): Vec3 => {
  const o = new Float32Array(3);
  jointPosition(assets, assets.positions, name, o);
  return [o[0] as number, o[1] as number, o[2] as number];
};

/** Resolves the cut a spec names, on the base mesh at rest. */
function resolve(input: ModelGraftInput, spec: GraftSpec) {
  const control: ControlMesh = {
    faceVerts: input.assets.faceVerts,
    faces: input.bodyFaces,
    positions: input.assets.positions,
  };
  const at = spec.at;
  let resolved: ResolvedCut;
  let rootBone: string;
  let forward: Vec3 = [0, 0, 1];
  if (typeof at === "string") {
    const site = CUT_SITES[at];
    if (!site)
      throw new GraftError(`no cut site ${at} (sites: ${Object.keys(CUT_SITES).join(", ")})`);
    const from = joint(input.assets, site.from);
    const to = joint(input.assets, site.to);
    const normal: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const point: Vec3 = [
      from[0] + normal[0] * site.at,
      from[1] + normal[1] * site.at,
      from[2] + normal[2] * site.at,
    ];
    resolved = resolvePlaneCut(control, { point, normal }, to);
    rootBone = site.rootBone;
    forward = site.forward;
  } else if ("plane" in at) {
    resolved = resolvePlaneCut(control, at.plane, at.seed);
    rootBone = at.rootBone;
    forward = at.forward ?? forward;
  } else {
    resolved = resolveFaceCut(control, at.faces);
    rootBone = at.rootBone;
    forward = at.forward ?? forward;
  }
  const names = input.assets.manifest.skeleton.bones.map((b) => b.name);
  const root = names.indexOf(rootBone);
  if (root < 0) throw new GraftError(`no bone ${rootBone}`);
  const fv = input.assets.faceVerts;
  const removedFaces: number[] = [];
  const inside = new Set<number>();
  const kept = new Set<number>();
  input.bodyFaces.forEach((f, i) => {
    const target = resolved.removed[i] ? inside : kept;
    if (resolved.removed[i]) removedFaces.push(f);
    for (let k = 0; k < 4; k++) target.add(fv[f * 4 + k] as number);
  });
  // The loop's vertices belong to both sides: only the removed side's own count as inside.
  for (const v of kept) inside.delete(v);
  const droppedAttachments = input.attachments
    .filter((a) => a.refVerts.length > 0 && a.refVerts.every((v) => inside.has(v)))
    .map((a) => a.id);
  // A bone is inside when the body vertex nearest its rest head is.
  const heads = restBones(input.assets, input.assets.positions).heads;
  const bodyVerts = [...inside, ...kept];
  const P = input.assets.positions;
  const removedBones = names.filter((_, b) => {
    if (b === root) return false;
    let best = Number.POSITIVE_INFINITY;
    let near = -1;
    for (const v of bodyVerts) {
      const d =
        ((P[v * 3] as number) - (heads[b * 3] as number)) ** 2 +
        ((P[v * 3 + 1] as number) - (heads[b * 3 + 1] as number)) ** 2 +
        ((P[v * 3 + 2] as number) - (heads[b * 3 + 2] as number)) ** 2;
      if (d < best) {
        best = d;
        near = v;
      }
    }
    return inside.has(near);
  });
  const cut: GraftCutInput = {
    removed: resolved.removed,
    rootBone: root,
    rootBoneName: rootBone,
    forward,
    removedFaces: Uint32Array.from(removedFaces),
    droppedAttachments,
    removedBones,
  };
  return cut;
}

/** Builds the graft a spec asks for on a model (`HumanoidModel.graft`). */
export function graftOnModel(input: ModelGraftInput, spec: GraftSpec): ModelGraft {
  const cut = resolve(input, spec);
  const { at: _at, part, ...options } = spec;
  const built = new Map<"base" | "adult", Graft>();
  const graftOf = (surface: "base" | "adult"): Graft => {
    let g = built.get(surface);
    if (g) return g;
    const s = surface === "base" ? input.base : input.adult();
    if (!s) throw new GraftError("the model has no adult surface");
    const n = s.mesh.renderToSurface.length * 3;
    const restPositions = new Float32Array(n);
    const restNormals = new Float32Array(n);
    evaluateSurface(s.mesh, input.assets.positions, restPositions, restNormals);
    g = buildGraft(
      {
        index: s.mesh.index,
        trianglesPerFace: s.trianglesPerFace,
        visible: s.visible,
        renderToSurface: s.mesh.renderToSurface,
        uvs: s.mesh.uvs,
        skinIndex: s.mesh.skinIndex,
        skinWeight: s.mesh.skinWeight,
        restPositions,
        restNormals,
      },
      cut,
      part,
      options,
    );
    built.set(surface, g);
    return g;
  };
  // Build the base surface's graft now, so a bad part or cut fails at once.
  graftOf("base");
  return {
    topology: (surface = "base") => graftOf(surface).topology,
    evaluate(evaluation) {
      const g = graftOf(evaluation.surface);
      const out = g.evaluate(evaluation.positions, evaluation.normals);
      let skin: { skinIndex: Uint16Array; skinWeight: Float32Array } | null = null;
      if (evaluation.skin) {
        const t = g.topology;
        const skinIndex = Uint16Array.from(t.skinIndex);
        const skinWeight = Float32Array.from(t.skinWeight);
        skinIndex.set(evaluation.skin.skinIndex.subarray(0, t.bodyVertexCount * 4));
        skinWeight.set(evaluation.skin.skinWeight.subarray(0, t.bodyVertexCount * 4));
        skin = { skinIndex, skinWeight };
      }
      return { ...out, surface: evaluation.surface, skin };
    },
  };
}
