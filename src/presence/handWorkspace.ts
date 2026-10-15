/** Small geometry adapter: presence publishes numbers, never a rig or a sampler. */
import { createArmSkinnedFrameSampler } from "../affordance/armSkinnedFrameSampler.ts";
import { frameOut, type LandmarkAnchors } from "../foundation/landmarks.ts";
import type { Evaluation } from "../model/humanoidModel.ts";
import type { SkinWeights } from "../model/reservoirSkin.ts";
import { armChain } from "../rig/armTarget.ts";
import { type BoneRotations, posedBones, type RestBones } from "../rig/bones.ts";
import type { HandWorkspace } from "./presence.ts";

export interface HandWorkspaceGeometry extends SkinWeights {
  anchors: LandmarkAnchors;
}

interface CachedWorkspace {
  names: readonly string[];
  heads: Float32Array;
  parents: Int16Array;
  rotations: BoneRotations;
  geometry: HandWorkspaceGeometry;
  lift: number;
  value: Record<"L" | "R", HandWorkspace>;
}
const cache = new WeakMap<Evaluation, CachedWorkspace>();
function samePose(a: BoneRotations, b: BoneRotations): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Samples only the two grip frames, using exactly the renderer's skin weights. */
export function measuredHandWorkspaces(
  evaluation: Evaluation,
  restBones: RestBones,
  rotations: BoneRotations,
  geometry: HandWorkspaceGeometry,
  lift: number,
): Record<"L" | "R", HandWorkspace> {
  const known = cache.get(evaluation);
  if (
    known &&
    known.names === restBones.names &&
    known.heads === restBones.heads &&
    known.parents === restBones.parents &&
    samePose(known.rotations, rotations) &&
    known.geometry.anchors === geometry.anchors &&
    known.geometry.skinIndex === geometry.skinIndex &&
    known.geometry.skinWeight === geometry.skinWeight &&
    known.lift === lift
  )
    return known.value;
  const posed = posedBones(restBones, rotations);
  const point = (bone: number): [number, number, number] => [
    posed.heads[bone * 3] as number,
    posed.heads[bone * 3 + 1] as number,
    posed.heads[bone * 3 + 2] as number,
  ];
  const distance = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(
      (a[0] as number) - (b[0] as number),
      (a[1] as number) - (b[1] as number),
      (a[2] as number) - (b[2] as number),
    );
  const side = (hand: "L" | "R"): HandWorkspace => {
    const chain = armChain(restBones, hand);
    const shoulder = point(chain[1] as number);
    const elbow = point(chain[3] as number);
    const wrist = point(chain[5] as number);
    const sampler = createArmSkinnedFrameSampler({
      generation: evaluation,
      rest: evaluation.positions,
      restNormals: evaluation.normals,
      restBones,
      sourceRotations: rotations,
      armBones: chain,
      side: hand,
      ...geometry,
    });
    const palm = sampler.frame(evaluation, rotations, frameOut());
    const offset = palm.position.map((value, index) => value - (wrist[index] as number));
    const dot = (axis: readonly number[]) =>
      offset.reduce((sum, value, index) => sum + value * (axis[index] as number), 0);
    return {
      shoulder: [shoulder[0], shoulder[1] + lift, shoulder[2]],
      upperLength: distance(shoulder, elbow),
      forearmLength: distance(elbow, wrist),
      palmOffset: [dot(palm.tangent), dot(palm.bitangent), dot(palm.normal)],
    };
  };
  const value = { L: side("L"), R: side("R") };
  cache.set(evaluation, {
    names: restBones.names,
    heads: restBones.heads,
    parents: restBones.parents,
    rotations: Float32Array.from(rotations),
    geometry,
    lift,
    value,
  });
  return value;
}
