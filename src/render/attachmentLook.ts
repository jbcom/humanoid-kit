/**
 * The colour an attachment's material is drawn with.
 *
 * MakeHuman's materials multiply a diffuse colour into the texture in its own
 * display-referred pipeline, which the pack carries as it is. The teeth's is a
 * flat 0.64 over a texture whose teeth are mid grey, so here, where both are
 * decoded to linear light, enamel came out as a grey of about 0.18 albedo:
 * darker than the skin around it, where real teeth are the lightest thing in
 * a face. Teeth are therefore given the colour that makes their texture reach
 * the albedo of enamel, whatever the material said.
 */
import { Color, DoubleSide, FrontSide, LinearSRGBColorSpace } from "three";
import type { AttachmentMaterial } from "../format/assetFormat.ts";
import type { Lab } from "../surface/cielab.ts";
import { linearFromLab } from "../surface/cielab.ts";
import { GUM_SATURATION, gumAppearance } from "../surface/gumTone.ts";
import { DEFAULT_SKIN_TONE, type Rgb, type SkinTone } from "../surface/skinTone.ts";
import { AttachmentStandardMaterial, patchOcclusion } from "./occlusion.ts";

/**
 * A natural tooth's CIELAB colour: ivory, lighter than any skin and a little
 * yellow (typical dental spectrophotometry of a mid-light tooth, VITA
 * Classical A1 to A2 range: L* 74 to 77, a* about 1, b* 12 to 17; the lighter,
 * less yellow end, since a screen shows a tooth beside warm skin and the full
 * A2 yellow read as stained at every tone).
 */
export const ENAMEL_LAB: Readonly<Lab> = [76, 0.5, 12];

/**
 * The mean linear colour of the teeth texture's tooth texels (the opaque,
 * near-grey ones; the red are gum), measured from `teeth_base_teeth.webp`. A
 * test re-measures the shipped texture and fails if this drifts.
 */
export const TEETH_TEXTURE_MEAN: Readonly<Rgb> = [0.29, 0.267, 0.263];

/** The colour to multiply into `kind`'s texture: the pack's own, except for teeth. */
export function attachmentColour(kind: string, color: Readonly<Rgb>): Rgb {
  if (kind !== "teeth") return [color[0], color[1], color[2]];
  const enamel = linearFromLab(ENAMEL_LAB);
  return [
    enamel[0] / TEETH_TEXTURE_MEAN[0],
    enamel[1] / TEETH_TEXTURE_MEAN[1],
    enamel[2] / TEETH_TEXTURE_MEAN[2],
  ];
}

/** How finely the gum's pigment patches vary across the texture, in cycles per unit of UV. */
const PATCH_SCALE = 40;

/** The share of the full pigment the gum keeps between the patches. */
const PIGMENT_BETWEEN_PATCHES = 0.2;

/**
 * The teeth: the enamel colour above for the tooth texels, and for the gum
 * texels (the red ones) a colour of their own, a pale coral pink pigmented by
 * the figure's melanin (`src/surface/gumTone.ts`). A texel is gum by its
 * chroma, tooth texels being grey; the gum keeps the texture's luminance, so
 * the creases painted into it survive, and the pigment is spread in patches by
 * a smooth noise over the texture's UVs, not evenly.
 */
export class TeethMaterial extends AttachmentStandardMaterial {
  readonly hkUniforms = {
    hkGum: { value: new Color() },
    hkGumPigment: { value: new Color() },
    hkGumAmount: { value: 0 },
  };

  constructor(parameters?: ConstructorParameters<typeof AttachmentStandardMaterial>[0]) {
    super(parameters);
    this.setSkin(DEFAULT_SKIN_TONE);
  }

  /** Colour the gums for a figure of skin `tone`. */
  setSkin(tone: Pick<SkinTone, "melanin">): void {
    const a = gumAppearance(tone);
    this.hkUniforms.hkGum.value.setRGB(a.base[0], a.base[1], a.base[2], LinearSRGBColorSpace);
    this.hkUniforms.hkGumPigment.value.setRGB(
      a.pigment[0],
      a.pigment[1],
      a.pigment[2],
      LinearSRGBColorSpace,
    );
    this.hkUniforms.hkGumAmount.value = a.amount;
  }

  override onBeforeCompile: AttachmentStandardMaterial["onBeforeCompile"] = (shader) => {
    patchOcclusion(shader, this.occlusionKeys);
    if (!shader.fragmentShader.includes("#include <map_fragment>"))
      throw new Error("TeethMaterial: three's map_fragment chunk moved");
    Object.assign(shader.uniforms, this.hkUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 hkGum;
uniform vec3 hkGumPigment;
uniform float hkGumAmount;
float hkHash( vec2 p ) {
	p = fract( p * vec2( 123.34, 456.21 ) );
	p += dot( p, p + 45.32 );
	return fract( p.x * p.y );
}
float hkNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( hkHash( i ), hkHash( i + vec2( 1.0, 0.0 ) ), f.x ),
		mix( hkHash( i + vec2( 0.0, 1.0 ) ), hkHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
	#ifdef USE_MAP
	{
		// diffuseColor is now the material colour times the texel; the texel is what was added.
		vec3 texel = diffuseColor.rgb / max( diffuse, vec3( 1e-4 ) );
		// Gum texels are red (their red is mostly not green); tooth texels are near grey,
		// whatever their level, so a bright or stained tooth texel is never taken for gum.
		float gum = smoothstep( ${(GUM_SATURATION - 0.2).toFixed(2)}, ${GUM_SATURATION.toFixed(2)}, ( texel.r - texel.g ) / max( texel.r, 1e-3 ) );
		float lum = dot( texel, vec3( 0.2126, 0.7152, 0.0722 ) );
		float n = 0.65 * hkNoise( vMapUv * ${PATCH_SCALE.toFixed(1)} ) + 0.35 * hkNoise( vMapUv * ${(PATCH_SCALE * 2.8).toFixed(1)} + 7.3 );
		float hkPatch = smoothstep( 0.38, 0.62, n );
		float pigment = hkGumAmount * mix( ${PIGMENT_BETWEEN_PATCHES.toFixed(2)}, 1.0, hkPatch );
		diffuseColor.rgb = mix( diffuseColor.rgb, mix( hkGum, hkGumPigment, pigment ) * lum, gum );
	}
	#endif`,
      );
  };

  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}-teeth-1`;
  }
}

/**
 * A standard material for an attachment the way the pack describes it (its
 * roughness, transparency and culling), coloured by `attachmentColour`; teeth
 * get a `TeethMaterial`. The texture, if any, is set by the caller once it has
 * loaded.
 */
export function createAttachmentMaterial(
  kind: string,
  m: AttachmentMaterial,
): AttachmentStandardMaterial {
  const [r, g, b] = attachmentColour(kind, m.color);
  const parameters = {
    color: new Color(r, g, b),
    roughness: m.roughness,
    metalness: 0,
    transparent: m.transparent && !m.alphaToCoverage,
    alphaToCoverage: m.alphaToCoverage,
    side: m.backfaceCull ? FrontSide : DoubleSide,
  };
  return kind === "teeth"
    ? new TeethMaterial(parameters)
    : new AttachmentStandardMaterial(parameters);
}
