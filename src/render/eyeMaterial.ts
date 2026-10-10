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
 *
 * A material of the eye pack (`humanoid-kit-eyes`) swaps the texture and tells the
 * shader what was measured of it (`EyeMaterialEntry`): where its iris ends, how
 * bright its iris and sclera are against the built-in texture's, and its sclera's
 * tint. The iris is then a disc around the known centres (not a chroma mask, which
 * a bright or grey iris defeats) and the colours are still the recipe's: the texture
 * contributes pattern and detail, scaled so the recipe's iris is the iris's mean
 * colour, as it is for the built-in one. A texture with no iris is all sclera detail.
 */
import { Color, LinearSRGBColorSpace, MeshPhysicalMaterial, Vector3, Vector4 } from "three";
import type { EyeManifest, EyeMaterialEntry } from "../eyes/library.ts";
import type { Rgb } from "../surface/skinTone.ts";
import { patchOcclusion } from "./occlusion.ts";

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

/** Fraction of the environment's specular reflection the eye keeps (GLSL float literal). */
const ENV_SPECULAR = "0.06";

export class EyeMaterial extends MeshPhysicalMaterial {
  /** The figure's occlusion key weights (`occlusionKeyWeights`); rest is (0, 0, 0). */
  occlusionKeys = new Vector3();
  readonly hkUniforms = {
    hkIris: { value: new Color() },
    hkSclera: { value: new Color() },
    /** 0: the built-in texture (a chroma mask), 1: a pack material with an iris, 2: one without. */
    hkEyeMode: { value: 0 },
    hkEyeCentres: { value: new Vector4() },
    /** The iris's radius (texture units), and the gains and tint the material was measured to need. */
    hkEyeShape: { value: new Vector4(0, 1, 1, 0) },
    hkScleraTint: { value: new Vector3(1, 1, 1) },
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

  /** Wears a material of the eye pack (null: the built-in texture). The caller sets `map`. */
  setMaterial(entry: EyeMaterialEntry | null, manifest?: EyeManifest): void {
    const u = this.hkUniforms;
    if (!entry || !manifest) {
      u.hkEyeMode.value = 0;
      u.hkEyeShape.value.set(0, 1, 1, 0);
      u.hkScleraTint.value.set(1, 1, 1);
      return;
    }
    const [[ax, ay], [bx, by]] = manifest.centres;
    u.hkEyeMode.value = entry.hasIris ? 1 : 2;
    u.hkEyeCentres.value.set(ax, ay, bx, by);
    u.hkEyeShape.value.set(entry.irisRadius, entry.irisGain, entry.scleraGain, 0);
    u.hkScleraTint.value.set(...entry.scleraTint);
  }

  override onBeforeCompile: MeshPhysicalMaterial["onBeforeCompile"] = (shader) => {
    Object.assign(shader.uniforms, this.hkUniforms);
    // Lids shade the eyeball; without this the whites glow as if pasted on.
    patchOcclusion(shader, this.occlusionKeys);
    for (const chunk of ["map_fragment", "lights_fragment_maps"]) {
      if (!shader.fragmentShader.includes(`#include <${chunk}>`)) {
        throw new Error(`EyeMaterial: three's ${chunk} chunk moved`);
      }
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 hkIris;\nuniform vec3 hkSclera;\nuniform float hkEyeMode;\nuniform vec4 hkEyeCentres;\nuniform vec4 hkEyeShape;\nuniform vec3 hkScleraTint;",
      )
      // Cause of the grey crescent across one iris: with scene.environment set, three
      // ignores material.envMapIntensity (it uses scene.environmentIntensity), so the
      // mirror-like cornea reflected the studio softbox at full strength, and only the
      // eye whose normals line up with it showed a ring. Direct lights still give the
      // small sharp catchlight; the reflected environment is scaled down here instead.
      .replace(
        "#include <lights_fragment_maps>",
        `#include <lights_fragment_maps>
	#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
		radiance *= ${ENV_SPECULAR};
		#ifdef USE_CLEARCOAT
			clearcoatRadiance *= ${ENV_SPECULAR};
		#endif
	#endif`,
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
		float iris = 0.0;
		float irisGain = 1.0;
		float scleraGain = 1.0;
		vec3 tint = vec3( 1.0 );
		if ( hkEyeMode < 0.5 ) {
			// Chromatic and not too bright: iris (and the dark pupil inside it).
			iris = smoothstep( 0.25, 0.55, sat ) * ( 1.0 - smoothstep( 0.35, 0.6, lum ) );
		} else {
			if ( hkEyeMode < 1.5 ) {
				// A disc around the nearer eye's centre; a bright, grey spot in it (a painted catchlight) is sclera.
				vec2 uv = vMapUv;
				float d = min( distance( uv, hkEyeCentres.xy ), distance( uv, hkEyeCentres.zw ) );
				iris = 1.0 - smoothstep( 0.93 * hkEyeShape.x, 1.05 * hkEyeShape.x, d );
				iris *= 1.0 - smoothstep( 0.55, 0.8, lum ) * ( 1.0 - smoothstep( 0.1, 0.3, sat ) );
			}
			irisGain = hkEyeShape.y;
			scleraGain = hkEyeShape.z;
			tint = hkScleraTint;
		}
		vec3 irisColour = hkIris * clamp( lum * 9.0 * irisGain, 0.0, 2.2 );
		vec3 sclera = hkSclera * tint * clamp( lum * scleraGain / 0.42, 0.0, 1.15 );
		diffuseColor.rgb = mix( sclera, irisColour, iris );
	}`,
      );
  };

  override customProgramCacheKey(): string {
    return "humanoid-kit-eye-5";
  }
}
