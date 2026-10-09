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

/**
 * The attributes one kind of geometry carries its corners in: the corners in
 * order (corner 0 first), packed into these attributes in turn, each `size`
 * wide, interleaved in one buffer.
 */
interface OcclusionLayout {
  attributes: readonly { name: string; size: 1 | 3 | 4 }[];
  /**
   * The attributes hold how enclosed a vertex is, not how open, so a geometry
   * without them (a plain mesh in a skin material) reads as open: an unset
   * attribute reads as zero. That also keeps the layout off `vec4`, whose unset
   * fourth component reads as one and would darken it at some poses.
   */
  enclosure: boolean;
}

/** Corner 0 (rest), one float per vertex. */
export const OCCLUSION_ATTRIBUTE = "hkOcclusion";
const ATTACHMENT: OcclusionLayout = {
  attributes: [
    { name: OCCLUSION_ATTRIBUTE, size: 1 },
    { name: "hkOcclusionA", size: 4 },
    { name: "hkOcclusionB", size: 3 },
  ],
  enclosure: false,
};
const BODY: OcclusionLayout = {
  attributes: [
    { name: "hkEnclosure", size: 1 },
    { name: "hkEnclosureA", size: 3 },
    { name: "hkEnclosureB", size: 3 },
    { name: "hkEnclosureC", size: 1 },
  ],
  enclosure: true,
};

/** The GLSL expression of each corner, in order. */
const cornerExpressions = (layout: OcclusionLayout): string[] =>
  layout.attributes.flatMap(({ name, size }) =>
    size === 1 ? [name] : ["x", "y", "z", "w"].slice(0, size).map((c) => `${name}.${c}`),
  );

for (const layout of [ATTACHMENT, BODY])
  if (cornerExpressions(layout).length !== CORNERS)
    throw new Error("occlusion: a layout does not hold one attribute component per corner");

/** Puts an interleaved corner array on a geometry as `layout`'s attributes. */
function setAttributes(
  geometry: BufferGeometry,
  layout: OcclusionLayout,
  array: Float32Array | Uint8Array,
  normalized: boolean,
): void {
  const buffer = new InterleavedBuffer(array, CORNERS);
  let offset = 0;
  for (const { name, size } of layout.attributes) {
    geometry.setAttribute(name, new InterleavedBufferAttribute(buffer, size, offset, normalized));
    offset += size;
  }
}

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
  setAttributes(geometry, ATTACHMENT, occlusion, false);
}

/**
 * Puts the body's per-vertex corner bytes (`ModelTopology.body.occlusion`) on
 * its geometry, kept as bytes on the GPU and read as 0..1. They are uploaded as
 * how enclosed each vertex is, so a body geometry without them is open.
 */
export function setBodyOcclusionAttributes(geometry: BufferGeometry, occlusion: Uint8Array): void {
  setAttributes(
    geometry,
    BODY,
    Uint8Array.from(occlusion, (v) => 255 - v),
    true,
  );
}

/**
 * Patches a standard or physical material's shader to apply occlusion
 * attributes, blended by `keys` (the figure's key weights, shared by its
 * materials). `body` reads the body's attributes; otherwise an attachment's.
 */
export function patchOcclusion(
  shader: WebGLProgramParametersWithUniforms,
  keys: Vector3,
  { floor = OCCLUSION_FLOOR, power = 1, body = false, exposure = 1 } = {},
): void {
  if (!shader.fragmentShader.includes("#include <aomap_fragment>"))
    throw new Error("occlusion: three's aomap_fragment chunk moved");
  const layout = body ? BODY : ATTACHMENT;
  const corners = cornerExpressions(layout);
  // Corner m holds key i when bit i of m is set; x, y, z are keys 0, 1, 2.
  const weightOf = (m: number) =>
    ["x", "y", "z"].map((k, i) => `${m & (1 << i) ? "w" : "a"}.${k}`).join(" * ");
  shader.uniforms.hkOcclusionKeys = { value: keys };
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
${layout.attributes.map(({ name, size }) => `attribute ${size === 1 ? "float" : `vec${size}`} ${name};`).join("\n")}
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
			${corners.map((c, m) => `${c} * ${weightOf(m)}`).join(" +\n\t\t\t")};
		float occ = clamp( ${layout.enclosure ? "1.0 - blended" : "blended"}, 0.0, 1.0 );${
      power === 1
        ? `\n\t\t\tvHkOcclusion = ${exposure === 1 ? "occ" : `pow( occ, ${exposure.toFixed(3)} )`};`
        : `
			// Enclosed at rest, a vertex is in a cavity, which loses light faster than the
			// visibility it loses; open at rest, it is only in a fold and keeps its value.
			float restOcc = clamp( ${layout.enclosure ? `1.0 - ${corners[0]}` : corners[0]}, 0.0, 1.0 );
			vHkOcclusion = pow( occ, 1.0 + ${(power - 1).toFixed(1)} * ( 1.0 - restOcc ) );`
    }
	}`,
    );
  patchOcclusionFragment(shader, floor);
}

/**
 * The fragment half of the patch, shared with hair: scales every lighting term
 * by the interpolated `vHkOcclusion` (floored at `OCCLUSION_FLOOR`), which the
 * vertex shader of the caller sets.
 */
export function patchOcclusionFragment(
  shader: WebGLProgramParametersWithUniforms,
  floor = OCCLUSION_FLOOR,
): void {
  if (!shader.fragmentShader.includes("#include <aomap_fragment>"))
    throw new Error("occlusion: three's aomap_fragment chunk moved");
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
