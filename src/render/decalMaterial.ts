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
 * - **Little specular.** A hair's sheen on a brow is slight; a standard
 *   material's reflection of the studio's cool environment turned pale hair
 *   grey-blue.
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

/** The share of the mask's blurred density that fills between its strokes. */
export const SOFT_FILL = 0.35;

/** The mip of the mask the soft fill is read from: 2^3 texels across, about a hair's clump. */
export const SOFT_FILL_LOD = 3;

/** How much of a standard material's specular a decal keeps. */
export const DECAL_SPECULAR = 0.25;

export class DecalMaterial extends MeshPhysicalMaterial {
  constructor() {
    super({
      side: DoubleSide,
      roughness: 0.8,
      metalness: 0,
      specularIntensity: DECAL_SPECULAR,
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
		float hkSoft = textureLod( map, vMapUv, ${SOFT_FILL_LOD.toFixed(1)} ).a;
		sampledDiffuseColor.a = max( sampledDiffuseColor.a, hkSoft * ${SOFT_FILL.toFixed(3)} );
		diffuseColor *= sampledDiffuseColor;
	}
	#endif`,
    );
  };

  override customProgramCacheKey(): string {
    return "humanoid-kit-decal-2";
  }
}
