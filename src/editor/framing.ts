/**
 * Camera framing from MakeHuman's slider camera hints.
 *
 * Upstream hints name a direction (`frontView`, `leftView`, `rightView`), the
 * whole figure (`globalCamera`), or a body part and direction
 * (`leftHandFrontCamera`, `rightArmTopCamera`, ...); a task may name a default
 * (`faceCamera`). The editor resolves a hint to a part and a direction, finds
 * that part's bounds on the evaluated surface (from the skin weights), and
 * places the camera to fit them.
 *
 * Coordinates are the model's: the figure faces +z, its left side is +x and y
 * is up.
 */

export const FRAME_PARTS = [
  "body",
  "head",
  "leftArm",
  "rightArm",
  "leftHand",
  "rightHand",
  "leftLeg",
  "rightLeg",
  "leftFoot",
  "rightFoot",
] as const;
export type FramePart = (typeof FRAME_PARTS)[number];
export type FrameDirection = "front" | "left" | "right" | "top";

export interface FrameRequest {
  part: FramePart;
  direction: FrameDirection;
}

const PART_HINT = /^(left|right)(Hand|Foot|Arm|Leg)(Front|Left|Right|Top)Camera$/;

/** Resolves a slider's camera hint, falling back to its task's. */
export function frameRequest(sliderHint: string | null, taskHint: string | null): FrameRequest {
  const facePart: FramePart = taskHint === "faceCamera" ? "head" : "body";
  const m = sliderHint ? PART_HINT.exec(sliderHint) : null;
  if (m) {
    return {
      part: `${m[1]}${m[2]}` as FramePart,
      direction: (m[3] as string).toLowerCase() as FrameDirection,
    };
  }
  switch (sliderHint) {
    case "leftView":
      return { part: facePart, direction: "left" };
    case "rightView":
      return { part: facePart, direction: "right" };
    case "globalCamera":
      return { part: "body", direction: "front" };
    default:
      return { part: facePart, direction: "front" };
  }
}

/** The frame parts a skeleton bone's skin weight counts towards. */
export function framePartsOfBone(bone: string): FramePart[] {
  const side = bone.endsWith(".L") ? "left" : bone.endsWith(".R") ? "right" : null;
  const parts: FramePart[] = ["body"];
  if (side && /^(wrist|metacarpal|finger)/.test(bone)) parts.push(`${side}Hand`, `${side}Arm`);
  else if (side && /^(shoulder|upperarm|lowerarm)/.test(bone)) parts.push(`${side}Arm`);
  else if (side && /^(foot|toe)/.test(bone)) parts.push(`${side}Foot`, `${side}Leg`);
  else if (side && /^(upperleg02|lowerleg)/.test(bone)) parts.push(`${side}Leg`);
  else if (!/^(neck|spine|clavicle|breast|pelvis|root|upperleg01|shoulder)/.test(bone))
    parts.push("head");
  return parts;
}

/**
 * One bitmask per render vertex: bit `i` set when the vertex's dominant bone
 * counts towards `FRAME_PARTS[i]`.
 */
export function vertexFrameParts(
  skinIndex: ArrayLike<number>,
  skinWeight: ArrayLike<number>,
  bones: readonly string[],
): Uint16Array {
  const boneMask = bones.map((b) =>
    framePartsOfBone(b).reduce((m, p) => m | (1 << FRAME_PARTS.indexOf(p)), 0),
  );
  const n = skinWeight.length / 4;
  const out = new Uint16Array(n);
  for (let v = 0; v < n; v++) {
    let best = 0;
    for (let k = 1; k < 4; k++)
      if ((skinWeight[v * 4 + k] as number) > (skinWeight[v * 4 + best] as number)) best = k;
    out[v] = boneMask[skinIndex[v * 4 + best] as number] ?? 1;
  }
  return out;
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function partBounds(
  positions: ArrayLike<number>,
  parts: Uint16Array,
  part: FramePart,
): Bounds | null {
  const bit = 1 << FRAME_PARTS.indexOf(part);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (let v = 0; v < parts.length; v++) {
    if (!((parts[v] as number) & bit)) continue;
    any = true;
    for (let k = 0; k < 3; k++) {
      const x = positions[v * 3 + k] as number;
      lo[k] = Math.min(lo[k] as number, x);
      hi[k] = Math.max(hi[k] as number, x);
    }
  }
  if (!any) return null;
  const [x0, y0, z0] = lo as [number, number, number];
  const [x1, y1, z1] = hi as [number, number, number];
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

const DIRECTIONS: Record<FrameDirection, [number, number, number]> = {
  front: [0, 0.08, 1],
  left: [1, 0.08, 0],
  right: [-1, 0.08, 0],
  top: [0, 1, 0.35],
};

/**
 * Camera position and target that fit `bounds` seen from `direction`, for a
 * perspective camera with vertical field of view `fovDeg` and the given aspect.
 */
export function frameCamera(
  bounds: Bounds,
  direction: FrameDirection,
  fovDeg: number,
  aspect: number,
  margin = 1.15,
): { position: [number, number, number]; target: [number, number, number] } {
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  const target: [number, number, number] = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2;
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const distance = (radius * margin) / Math.sin(Math.min(vFov, hFov) / 2);
  const [dx, dy, dz] = DIRECTIONS[direction];
  const k = distance / Math.hypot(dx, dy, dz);
  return {
    position: [target[0] + dx * k, target[1] + dy * k, target[2] + dz * k],
    target,
  };
}
