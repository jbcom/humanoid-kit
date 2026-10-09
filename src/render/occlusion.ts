/**
 * Applies baked attachment occlusion (`AttachmentTopology.occlusion`) in
 * three's lighting: every term (direct and ambient, diffuse, specular and
 * clearcoat) is scaled, so an enclosed surface neither glows nor sparkles.
 *
 * The occlusion follows the pose: it is baked at every corner of the
 * `OCCLUSION_KEYS` cube (jaw open, lips apart, smile) and blended
 * trilinearly in the vertex shader by the figure's key weights
 * (`occlusionKeyWeights`), so teeth uncovered by an open mouth are lit and an
 * enclosed cavity stays dark. A floor stands in for the light that bounces
 * round a cavity, which the visibility bake does not count.
 */
import {
  type BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { OCCLUSION_KEYS, occlusionCorners } from "../rig/occlusionKeys.ts";

/** Corner 0 (rest), one float per vertex. */
export const OCCLUSION_ATTRIBUTE = "hkOcclusion";
/** Corners 1–4, then 5–7. */
const CORNERS_A = "hkOcclusionA";
const CORNERS_B = "hkOcclusionB";

if (OCCLUSION_KEYS.length !== 3)
  throw new Error("occlusion: the shader blends three keys; update it with OCCLUSION_KEYS");
const CORNERS = occlusionCorners(OCCLUSION_KEYS.length);

/** Light that still reaches a fully enclosed surface, as a fraction. */
export const OCCLUSION_FLOOR = 0.15;

/**
 * Puts an attachment's per-vertex corner bakes (`occlusionCorners` per
 * vertex, interleaved) on its geometry as the attributes the patch reads.
 * Called again with as many values, it refills the same buffer rather than
 * leaving the old one uploaded: three frees a geometry's GPU buffers only for
 * the attributes it holds when disposed.
 */
export function setOcclusionAttributes(geometry: BufferGeometry, occlusion: Float32Array): void {
  const current = geometry.getAttribute(OCCLUSION_ATTRIBUTE);
  if (
    current instanceof InterleavedBufferAttribute &&
    current.data.array.length === occlusion.length
  ) {
    // The array is replaced, not written into: the old one may be shared.
    current.data.array = occlusion;
    current.data.needsUpdate = true;
    return;
  }
  const buffer = new InterleavedBuffer(occlusion, CORNERS);
  geometry.setAttribute(OCCLUSION_ATTRIBUTE, new InterleavedBufferAttribute(buffer, 1, 0));
  geometry.setAttribute(CORNERS_A, new InterleavedBufferAttribute(buffer, 4, 1));
  geometry.setAttribute(CORNERS_B, new InterleavedBufferAttribute(buffer, 3, 5));
}

/**
 * Patches a standard or physical material's shader to apply the occlusion
 * attributes, blended by `keys` (the figure's key weights, shared by its
 * attachments' materials).
 */
export function patchOcclusion(shader: WebGLProgramParametersWithUniforms, keys: Vector3): void {
  if (!shader.fragmentShader.includes("#include <aomap_fragment>"))
    throw new Error("occlusion: three's aomap_fragment chunk moved");
  shader.uniforms.hkOcclusionKeys = { value: keys };
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
attribute float ${OCCLUSION_ATTRIBUTE};
attribute vec4 ${CORNERS_A};
attribute vec3 ${CORNERS_B};
uniform vec3 hkOcclusionKeys;
varying float vHkOcclusion;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
	{
		// Corner m holds key i when bit i of m is set; x, y, z are keys 0, 1, 2.
		vec3 w = clamp( hkOcclusionKeys, 0.0, 1.0 );
		vec3 a = 1.0 - w;
		vHkOcclusion =
			${OCCLUSION_ATTRIBUTE} * a.x * a.y * a.z +
			${CORNERS_A}.x * w.x * a.y * a.z + ${CORNERS_A}.y * a.x * w.y * a.z +
			${CORNERS_A}.z * w.x * w.y * a.z + ${CORNERS_A}.w * a.x * a.y * w.z +
			${CORNERS_B}.x * w.x * a.y * w.z + ${CORNERS_B}.y * a.x * w.y * w.z +
			${CORNERS_B}.z * w.x * w.y * w.z;
	}`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vHkOcclusion;")
    .replace(
      "#include <aomap_fragment>",
      `#include <aomap_fragment>
	{
		float hkOcc = mix( ${OCCLUSION_FLOOR.toFixed(3)}, 1.0, clamp( vHkOcclusion, 0.0, 1.0 ) );
		reflectedLight.directDiffuse *= hkOcc;
		reflectedLight.indirectDiffuse *= hkOcc;
		reflectedLight.directSpecular *= hkOcc;
		reflectedLight.indirectSpecular *= hkOcc;
		#ifdef USE_CLEARCOAT
			clearcoatSpecularDirect *= hkOcc;
			clearcoatSpecularIndirect *= hkOcc;
		#endif
	}`,
    );
}

/** A standard material for attachments (teeth, tongue, ...) that honours baked occlusion. */
export class AttachmentStandardMaterial extends MeshStandardMaterial {
  /** The figure's occlusion key weights (`occlusionKeyWeights`); rest is (0, 0, 0). */
  occlusionKeys = new Vector3();

  constructor(parameters?: MeshStandardMaterialParameters) {
    super(parameters);
  }

  override onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) =>
    patchOcclusion(shader, this.occlusionKeys);

  override customProgramCacheKey(): string {
    return "humanoid-kit-attachment-occlusion-2";
  }
}
