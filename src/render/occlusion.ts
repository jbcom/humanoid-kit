/**
 * Applies baked occlusion in three's lighting: every term (direct and ambient,
 * diffuse, specular, clearcoat and sheen) is scaled, so an enclosed surface
 * neither glows nor sparkles. It serves the attachments
 * (`AttachmentTopology.occlusion`) and the body's own cavities
 * (`ModelTopology.body.occlusion`, through `SkinMaterial`).
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

if (OCCLUSION_KEYS.length !== 3)
  throw new Error("occlusion: the shader blends three keys; update it with OCCLUSION_KEYS");
const CORNERS = occlusionCorners(OCCLUSION_KEYS.length);

/** The attributes one kind of geometry carries its corners in (corner 0 first, then 1–4, then 5–7). */
interface OcclusionLayout {
  base: string;
  a: string;
  b: string;
  /**
   * The attributes hold how enclosed a vertex is, not how open. A geometry
   * without them (a plain mesh in a skin material) reads as open, since an
   * unset attribute reads as zero.
   */
  enclosure: boolean;
}

/** Corner 0 (rest), one float per vertex. */
export const OCCLUSION_ATTRIBUTE = "hkOcclusion";
const ATTACHMENT: OcclusionLayout = {
  base: OCCLUSION_ATTRIBUTE,
  a: "hkOcclusionA",
  b: "hkOcclusionB",
  enclosure: false,
};
const BODY: OcclusionLayout = {
  base: "hkEnclosure",
  a: "hkEnclosureA",
  b: "hkEnclosureB",
  enclosure: true,
};

/** Light that still reaches a fully enclosed surface, as a fraction. */
export const OCCLUSION_FLOOR = 0.15;
/**
 * The same for the body's own cavities. Skin scatters light through the cheeks
 * and lips into the mouth, so an enclosed mouth is dim, not black.
 */
export const BODY_OCCLUSION_FLOOR = 0.1;
/**
 * The body's occlusion is raised to a power that grows with how enclosed the
 * vertex is at rest, from 1 for skin that is open at rest (a fold, which keeps
 * its value) up to this for one that is fully enclosed (a cavity). A cavity's
 * directional light must come through the same aperture the visibility counts,
 * so the light it loses is more than the visibility it loses: the mouth's back
 * wall, 75% visible with the jaw dropped, is lit far less than 75%.
 */
export const BODY_OCCLUSION_POWER = 10;

/**
 * Puts an attachment's per-vertex corner bakes (`occlusionCorners` per
 * vertex, interleaved) on its geometry as the attributes the patch reads.
 * Called again with as many values, it refills the same buffer rather than
 * leaving the old one uploaded: three frees a geometry's GPU buffers only for
 * the attributes it holds when disposed.
 */
export function setOcclusionAttributes(geometry: BufferGeometry, occlusion: Float32Array): void {
  const current = geometry.getAttribute(ATTACHMENT.base);
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
  geometry.setAttribute(ATTACHMENT.base, new InterleavedBufferAttribute(buffer, 1, 0));
  geometry.setAttribute(ATTACHMENT.a, new InterleavedBufferAttribute(buffer, 4, 1));
  geometry.setAttribute(ATTACHMENT.b, new InterleavedBufferAttribute(buffer, 3, 5));
}

/**
 * Puts the body's per-vertex corner bytes (`ModelTopology.body.occlusion`) on
 * its geometry, kept as bytes on the GPU and read as 0..1. They are uploaded as
 * how enclosed each vertex is, so a body geometry without them is open.
 */
export function setBodyOcclusionAttributes(geometry: BufferGeometry, occlusion: Uint8Array): void {
  const enclosure = Uint8Array.from(occlusion, (v) => 255 - v);
  const buffer = new InterleavedBuffer(enclosure, CORNERS);
  geometry.setAttribute(BODY.base, new InterleavedBufferAttribute(buffer, 1, 0, true));
  geometry.setAttribute(BODY.a, new InterleavedBufferAttribute(buffer, 4, 1, true));
  geometry.setAttribute(BODY.b, new InterleavedBufferAttribute(buffer, 3, 5, true));
}

/**
 * Patches a standard or physical material's shader to apply occlusion
 * attributes, blended by `keys` (the figure's key weights, shared by its
 * materials). `body` reads the body's attributes; otherwise an attachment's.
 */
export function patchOcclusion(
  shader: WebGLProgramParametersWithUniforms,
  keys: Vector3,
  { floor = OCCLUSION_FLOOR, power = 1, body = false } = {},
): void {
  if (!shader.fragmentShader.includes("#include <aomap_fragment>"))
    throw new Error("occlusion: three's aomap_fragment chunk moved");
  const layout = body ? BODY : ATTACHMENT;
  shader.uniforms.hkOcclusionKeys = { value: keys };
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
attribute float ${layout.base};
attribute vec4 ${layout.a};
attribute vec3 ${layout.b};
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
		float blended =
			${layout.base} * a.x * a.y * a.z +
			${layout.a}.x * w.x * a.y * a.z + ${layout.a}.y * a.x * w.y * a.z +
			${layout.a}.z * w.x * w.y * a.z + ${layout.a}.w * a.x * a.y * w.z +
			${layout.b}.x * w.x * a.y * w.z + ${layout.b}.y * a.x * w.y * w.z +
			${layout.b}.z * w.x * w.y * w.z;
		float occ = clamp( ${layout.enclosure ? "1.0 - blended" : "blended"}, 0.0, 1.0 );${
      power === 1
        ? "\n\t\t\tvHkOcclusion = occ;"
        : `
			// Enclosed at rest, a vertex is in a cavity, which loses light faster than the
			// visibility it loses; open at rest, it is only in a fold and keeps its value.
			float restOcc = clamp( ${layout.enclosure ? `1.0 - ${layout.base}` : layout.base}, 0.0, 1.0 );
			vHkOcclusion = pow( occ, 1.0 + ${(power - 1).toFixed(1)} * ( 1.0 - restOcc ) );`
    }
	}`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vHkOcclusion;")
    .replace(
      "#include <aomap_fragment>",
      `#include <aomap_fragment>
	{
		float hkOcc = mix( ${floor.toFixed(3)}, 1.0, clamp( vHkOcclusion, 0.0, 1.0 ) );
		reflectedLight.directDiffuse *= hkOcc;
		reflectedLight.indirectDiffuse *= hkOcc;
		reflectedLight.directSpecular *= hkOcc;
		reflectedLight.indirectSpecular *= hkOcc;
		#ifdef USE_CLEARCOAT
			clearcoatSpecularDirect *= hkOcc;
			clearcoatSpecularIndirect *= hkOcc;
		#endif
		#ifdef USE_SHEEN
			sheenSpecularDirect *= hkOcc;
			sheenSpecularIndirect *= hkOcc;
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
