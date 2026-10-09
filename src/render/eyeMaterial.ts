/**
 * Eye material for MakeHuman-format eye textures.
 *
 * Any iris colour, from any eye texture: iris pixels are the chromatic ones
 * (the sclera is near-grey), so a saturation mask finds the iris without
 * knowing the texture's layout. Inside it the chosen colour replaces the hue
 * while the texture's luminance keeps the fibre pattern and the dark pupil;
 * outside it the sclera is lifted towards a warm white with its veins kept.
 * The cornea is the texture's transparent region; a clearcoat gives it a wet,
 * sharp highlight.
 */
import { Color, LinearSRGBColorSpace, MeshPhysicalMaterial } from "three";
import type { Rgb } from "../surface/skinTone.ts";

export interface EyeAppearance {
  /** Linear-RGB iris colour. */
  iris: Rgb;
  /** 0 = clinical white, 1 = warm ivory sclera. */
  scleraWarmth: number;
}

export const DEFAULT_EYE_APPEARANCE: Readonly<EyeAppearance> = {
  iris: [0.12, 0.055, 0.025],
  scleraWarmth: 0.5,
};

export class EyeMaterial extends MeshPhysicalMaterial {
  readonly hkUniforms = {
    hkIris: { value: new Color() },
    hkSclera: { value: new Color() },
  };

  constructor() {
    super({
      // A wet eye is glossy everywhere; a broad lobe reads as a grey smear over the iris.
      roughness: 0.1,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      // The cornea dome maps to the texture's transparent region. Cutting it with an
      // alpha test is robust without MSAA; the eyeball's clearcoat supplies the wet
      // highlight a cornea would.
      alphaTest: 0.5,
      // A cornea shows a small sharp catchlight, not the whole environment.
      envMapIntensity: 0.35,
    });
    this.setAppearance(DEFAULT_EYE_APPEARANCE);
  }

  setAppearance(a: EyeAppearance): void {
    this.hkUniforms.hkIris.value.setRGB(a.iris[0], a.iris[1], a.iris[2], LinearSRGBColorSpace);
    const w = Math.min(1, Math.max(0, a.scleraWarmth));
    this.hkUniforms.hkSclera.value.setRGB(
      0.86,
      0.84 - 0.04 * w,
      0.82 - 0.1 * w,
      LinearSRGBColorSpace,
    );
  }

  override onBeforeCompile: MeshPhysicalMaterial["onBeforeCompile"] = (shader) => {
    Object.assign(shader.uniforms, this.hkUniforms);
    if (!shader.fragmentShader.includes("#include <map_fragment>")) {
      throw new Error("EyeMaterial: three's map_fragment chunk moved");
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 hkIris;\nuniform vec3 hkSclera;",
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
	{
		vec3 c = diffuseColor.rgb;
		float mx = max( c.r, max( c.g, c.b ) );
		float mn = min( c.r, min( c.g, c.b ) );
		float sat = ( mx - mn ) / ( mx + 1e-3 );
		float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
		// Chromatic and not too bright: iris (and the dark pupil inside it).
		float iris = smoothstep( 0.25, 0.55, sat ) * ( 1.0 - smoothstep( 0.35, 0.6, lum ) );
		vec3 irisColour = hkIris * clamp( lum * 9.0, 0.0, 2.2 );
		vec3 sclera = hkSclera * clamp( lum / 0.42, 0.0, 1.15 );
		diffuseColor.rgb = mix( sclera, irisColour, iris );
	}`,
      );
  };

  override customProgramCacheKey(): string {
    return "humanoid-kit-eye-1";
  }
}
