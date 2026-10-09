/**
 * Applies baked attachment occlusion (`AttachmentTopology.occlusion`) in
 * three's lighting: every term (direct and ambient, diffuse, specular and
 * clearcoat) is scaled, so an enclosed surface neither glows nor sparkles. A floor keeps
 * fully enclosed surfaces from going black: the bake is of the resting figure,
 * and a mouth that opens should not show pitch-black teeth.
 */
import {
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  type WebGLProgramParametersWithUniforms,
} from "three";

/** Name of the per-vertex occlusion attribute (one float, 1 = open). */
export const OCCLUSION_ATTRIBUTE = "hkOcclusion";

/** Light that still reaches a fully enclosed surface, as a fraction. */
export const OCCLUSION_FLOOR = 0.15;

/** Patches a standard or physical material's shader to apply the occlusion attribute. */
export function patchOcclusion(shader: WebGLProgramParametersWithUniforms): void {
  if (!shader.fragmentShader.includes("#include <aomap_fragment>"))
    throw new Error("occlusion: three's aomap_fragment chunk moved");
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>\nattribute float ${OCCLUSION_ATTRIBUTE};\nvarying float vHkOcclusion;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n\tvHkOcclusion = ${OCCLUSION_ATTRIBUTE};`,
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
  constructor(parameters?: MeshStandardMaterialParameters) {
    super(parameters);
  }

  override onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => patchOcclusion(shader);

  override customProgramCacheKey(): string {
    return "humanoid-kit-attachment-occlusion-1";
  }
}
