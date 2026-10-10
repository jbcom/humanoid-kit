/**
 * Projecting a decal onto the body in UV space, shared by the body-art bakes
 * (`bodyArtTexture.ts` for marks, `bodyArtDecals.ts` for tattoos and naevi): the body is
 * drawn at its UVs, and each fragment finds its place in the decal's frame
 * (`DecalFrame`) from the figure's morphed rest surface, so a decal crosses a
 * UV seam whole: both sides of the seam are the same place on the body.
 */
import { Vector3 } from "three";
import type { DecalFrame } from "../bodyArt/decals.ts";

/**
 * How far off the skin's plane at a decal's centre the projection still
 * reaches, as a share of the decal's longer side, and at least `DECAL_REACH_MIN`
 * metres: enough to follow the skin's curve under the decal (a cheek, a
 * shoulder), too little to reach a limb behind it. Beyond `DECAL_REACH_FADE` of
 * it the decal fades out rather than ending in a cut along the skin's curve.
 * CHOICES.
 */
export const DECAL_REACH = 0.5;
export const DECAL_REACH_MIN = 0.01;
export const DECAL_REACH_FADE = 0.6;
/**
 * How squarely the skin must face the decal (cosine) to take it: fully from
 * `DECAL_FACING[1]`, fading to nothing at `DECAL_FACING[0]`, so the
 * projection's far sides are skipped without a cut where the skin turns away.
 */
export const DECAL_FACING: readonly [number, number] = [0.05, 0.35];
/**
 * The same for a patch (`markShape`), which ends by its own depth rather than
 * by a reach: only skin turned more than a right angle away from it, the far
 * side of a thin part such as an ear, is skipped, fading in between. A CHOICE.
 */
export const PATCH_FACING: readonly [number, number] = [-0.35, -0.05];

/** Draws the body at its UVs, passing its rest position and normal on. */
export const DECAL_VERTEX = /* glsl */ `
in vec2 uv;
in vec3 position;
in vec3 normal;
out vec3 vPosition;
out vec3 vNormal;
void main() {
  vPosition = position;
  vNormal = normal;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * GLSL: the decal's frame: the point's place in it (metres along right and
 * up), and how fully the skin there takes it (`hkDecalWeight`), fading out
 * toward the reach's end and where the skin turns away; skin it does not reach
 * is skipped.
 */
export const DECAL_FRAME = /* glsl */ `
uniform vec3 centre;
uniform vec3 right;
uniform vec3 up;
uniform vec3 normal;
uniform float reach;
in vec3 vPosition;
in vec3 vNormal;
float hkDecalWeight;
vec2 hkDecalPoint() {
  vec3 d = vPosition - centre;
  hkDecalWeight = (1.0 - smoothstep(${DECAL_REACH_FADE.toFixed(3)} * reach, reach, abs(dot(d, normal))))
    * smoothstep(${DECAL_FACING[0].toFixed(3)}, ${DECAL_FACING[1].toFixed(3)}, dot(normalize(vNormal), normal));
  if (hkDecalWeight <= 0.0) discard;
  return vec2(dot(d, right), dot(d, up));
}
// The point in the frame's own space (right, up, normal), for a shape that
// measures its own depth; skin facing away (\`PATCH_FACING\`) is skipped.
float hkDecalFacing;
vec3 hkDecalLocal() {
  vec3 d = vPosition - centre;
  hkDecalFacing = smoothstep(${PATCH_FACING[0].toFixed(3)}, ${PATCH_FACING[1].toFixed(3)}, dot(normalize(vNormal), normal));
  if (hkDecalFacing <= 0.0) discard;
  return vec3(dot(d, right), dot(d, up), dot(d, normal));
}`;

export function frameUniforms() {
  return {
    centre: { value: new Vector3() },
    right: { value: new Vector3() },
    up: { value: new Vector3() },
    normal: { value: new Vector3() },
    reach: { value: 0 },
  };
}

/** Sets `u` to frame `f`, for a decal whose longer side is `extent` metres. */
export function setFrame(u: ReturnType<typeof frameUniforms>, f: DecalFrame, extent: number): void {
  u.centre.value.fromArray(f.centre);
  u.right.value.fromArray(f.right);
  u.up.value.fromArray(f.up);
  u.normal.value.fromArray(f.normal);
  u.reach.value = Math.max(DECAL_REACH_MIN, DECAL_REACH * extent);
}
