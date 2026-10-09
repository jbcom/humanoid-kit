/**
 * The material for eyebrows and eyelashes: MakeHuman's decals are flat quads
 * lying on the skin, cut out by a white alpha mask (the pack's texture), so the
 * material is a plain one, tinted by the hair colour (`browColour`,
 * `lashColour`) and blended by the mask's alpha.
 *
 * - **Blended, not cut out.** A brow is a band of hairs a fraction of a
 *   millimetre wide, thinner than a pixel at any distance a face is seen from.
 *   An alpha test (or alpha-to-coverage, which is one) keeps a stroke or drops
 *   it, so the first renders were a few hard-edged pencil lines. Blending gives
 *   a thin stroke the partial opacity it covers of its pixel, which is how a
 *   band of fine hairs reads. The decal lies on opaque skin and draws after it
 *   without writing depth.
 * - **A soft fill under the strokes.** The mask blurred (a high mip of itself)
 *   is added as a faint underlay, `SOFT_FILL` of its strength, so the band has
 *   the soft, sparse edge and the density a brow has between its hairs.
 * - **Fibre sheen, as the scalp's.** Hair's fuzz at grazing angles takes the hair's
 *   own colour (`HairMaterial` does the same), which is what makes dark brown and
 *   red hair read warmer than its diffuse alone; without it a brow of the same
 *   colour read less saturated than the head's hair.
 * - **The scalp's base specular.** A hair's sheen on a brow is slight, and the same
 *   as on the scalp: the base lobe's strength and roughness are `HairMaterial`'s, so
 *   a brow and the head's hair of one colour add the same neutral light (a test
 *   renders both and holds their chromaticity together).
 * - It draws over the skin it lies on (a polygon offset toward the camera)
 *   however little it is lifted.
 *
 * `setOpacity` thins it for a young face: the opacity multiplies the mask's
 * alpha, so a toddler's brow is a fainter, sparser one.
 */
import {
  DoubleSide,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  type WebGLProgramParametersWithUniforms,
} from "three";
import type { Rgb } from "../surface/skinTone.ts";

/** Texels below this alpha (after the opacity) are dropped. */
export const DECAL_ALPHA_CUTOFF = 0.01;

/**
 * The soft fill under the strokes: two blurs of the mask (a mip each), the finer
 * giving a thin stroke the body of a band of hairs, the broader the sparse soft
 * edge, each added at its share of the blur's density.
 */
export const SOFT_FILL = [
  { lod: 1.5, share: 0.9 },
  { lod: 3, share: 0.5 },
] as const;

/**
 * How much of a standard material's specular a decal keeps, and its roughness: those
 * of `HairMaterial`'s base lobe (`HAIR_SPECULAR_INTENSITY`, the combed roughness), so
 * a brow and the scalp of one colour add the same neutral light.
 */
export const DECAL_SPECULAR = 0.4;
export const DECAL_ROUGHNESS = 0.7;

export class DecalMaterial extends MeshPhysicalMaterial {
  constructor() {
    super({
      side: DoubleSide,
      roughness: DECAL_ROUGHNESS,
      metalness: 0,
      specularIntensity: DECAL_SPECULAR,
      sheen: 0.35,
      sheenRoughness: 0.6,
      alphaTest: DECAL_ALPHA_CUTOFF,
      transparent: true,
      depthWrite: false,
      // Over the skin it lies on, whatever the depth precision.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /** The hair colour, linear. */
  setColour(rgb: Readonly<Rgb>): void {
    this.color.setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace);
    this.sheenColor.setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace);
  }

  /** How much of the mask is kept, 0 to 1 (`decalOpacity`). */
  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  override onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    if (!shader.fragmentShader.includes("#include <map_fragment>"))
      throw new Error("DecalMaterial: three's map_fragment chunk moved");
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
	{
		vec4 sampledDiffuseColor = texture2D( map, vMapUv );
		// The strokes, and under them a faint blur of them: the soft density between hairs.
		float hkSoft = max(
			textureLod( map, vMapUv, ${SOFT_FILL[0].lod.toFixed(1)} ).a * ${SOFT_FILL[0].share.toFixed(2)},
			textureLod( map, vMapUv, ${SOFT_FILL[1].lod.toFixed(1)} ).a * ${SOFT_FILL[1].share.toFixed(2)} );
		sampledDiffuseColor.a = max( sampledDiffuseColor.a, hkSoft );
		diffuseColor *= sampledDiffuseColor;
	}
	#endif`,
    );
  };

  override customProgramCacheKey(): string {
    return "humanoid-kit-decal-3";
  }
}
