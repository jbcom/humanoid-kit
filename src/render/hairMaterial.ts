/**
 * The material for scalp hair cards: MakeHuman's hair is flat strips painted
 * with strands on an alpha atlas, and this renders them as hair rather than as
 * paper.
 *
 * - **Colour** is the strand map (the atlas's luminance, normalised to a fixed
 *   mean) times the recipe's pigment colour (`hairTint`), so every style takes
 *   every colour, from black to platinum, with the strands' own structure.
 * - **Edges** are alpha-to-coverage when the canvas is multisampled: the cards'
 *   cut-outs are smooth and write depth, so hair needs no sorting and never
 *   shows the halos blending leaves at overlapping cards. Without MSAA the same
 *   cards render with a plain alpha test (hard edges, still correct).
 *   Shadows use the same alpha, so a card's cut-outs cast no shadow.
 * - **Hairlines** thin out: each vertex carries a fade (0 on a card edge that
 *   meets the scalp, 1 a centimetre in). With alpha-to-coverage it is the card's
 *   coverage, a smooth gradient; without it the fragment is discarded where the
 *   fade is below an interleaved-gradient noise of its pixel, which needs neither
 *   blending nor MSAA, so a hairline thins the same way on every GPU, software
 *   ones included. Either way it shows the tinted scalp
 *   (`SkinMaterial.setScalp`) through it.
 * - **Highlights** are Kajiya-Kay: a strand is a thin cylinder, and it reflects
 *   in a cone around its tangent, so a highlight is a band across the strands
 *   at any length of hair, short styles included. Two lobes, as Marschner
 *   measured: a white one from the fibre's surface, shifted toward the tip, and
 *   a second tinted by the pigment, shifted the other way. The tangent is the
 *   screen-space gradient of the vertices' growth (distance along the card from
 *   the root), so no tangent attribute is stored; the strand map's own
 *   brightness jitters the shift, so the band breaks up into strands.
 * - **Occlusion** is baked at pack time, one value per vertex (cards under
 *   others and against the scalp are darker) and scales every lighting term
 *   like the eyes' and teeth's (`patchOcclusionFragment`).
 */
import {
  type BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  ShaderChunk,
  Vector2,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { type HairColour, hairTint } from "../surface/hairTone.ts";
import { patchOcclusionFragment } from "./occlusion.ts";

/** One float per vertex: how open the card is to light. */
export const HAIR_OCCLUSION_ATTRIBUTE = "hkHairOcclusion";

/** One float per vertex: 0 where the hair is dithered away (a hairline), 1 where it is all there. */
export const HAIR_FADE_ATTRIBUTE = "hkHairFade";

/** One float per vertex: 1 on a card standing out of the scalp (dithered away edge-on), 0 on one lying along it. */
export const HAIR_FIN_ATTRIBUTE = "hkHairFin";

/** One float per vertex: texture units per metre across the card. */
export const HAIR_UVSCALE_ATTRIBUTE = "hkHairUvScale";

/** One float per vertex: metres along the card from the hair's root. */
export const HAIR_GROWTH_ATTRIBUTE = "hkHairGrowth";

/**
 * Light that still reaches the deepest hair, as a fraction. Far higher than
 * the eyes' and teeth's floor: the bake treats cards as solid, so the inside of
 * a sparse style reads darker than strands with air between them would be.
 */
export const HAIR_OCCLUSION_FLOOR = 0.65;

/** Texels below this alpha are cut out. */
export const HAIR_ALPHA_CUTOFF = 0.4;

/**
 * The two highlight lobes: how far each shifts along the strand (as a tilt of
 * the tangent toward the normal), how strong each is, and how tight. Primary is
 * the white one, secondary the pigment-coloured, wider one.
 */
export const HAIR_LOBES = {
  primaryShift: -0.12,
  secondaryShift: 0.16,
  primaryStrength: 0.008,
  secondaryStrength: 0.15,
  primaryExponent: 48,
  secondaryExponent: 12,
  /** How far the strand map's brightness moves a lobe, per unit of its deviation from the mean. */
  shiftJitter: 0.45,
} as const;

/**
 * A fin card (one standing out of the scalp, `HairFieldData.fin`) turned this far
 * from facing the eye (|cos| of the angle between its normal and the view
 * direction) is dithered away between `from` (gone) and `to` (all there). A flat
 * card seen edge-on is a hairline-thin dark sliver, and styles that stand loose
 * cards out of the scalp (the afro's curls) otherwise read as a lattice of such
 * slivers across the head. A card lying along the scalp is never faded this way:
 * a head's shell is seen at a grazing angle over much of its area.
 */
export const HAIR_EDGE_ON = { from: 0.3, to: 0.8 } as const;

/**
 * The most a hair pixel may exceed its diffuse by (the base specular, the fibre
 * sheen and both strand lobes together), at any strand direction and light. Real
 * hair's specular is a low, broad sheen, never a mirror-like patch; dark hair's
 * diffuse is so small that its absolute specular is already about twice it, so
 * three times is the line a mirror-like patch (ten and more) would cross.
 * Browser-tested on analytic geometry.
 */
export const HIGHLIGHT_OVER_DIFFUSE = 3;

/**
 * How a hairline thins. Each strand ends at its own distance from the card's cut
 * edge (a hash of the strand, so hair thins in wisps, not a screen-door dot grid),
 * its tip tapering over `taper` of the fade, and the whole edge recedes along its
 * length by up to `wander` + `slow` of the fade (two slow noises, so no hairline is a
 * ruled straight line: a wander and a recession). `strands` is strands per metre
 * across the strand direction (1.5 mm); `wisp` bounds the hash so a card well in is
 * never thinned (1 - wander - slow stays above it); `wanderScale` and `slowScale`
 * are the noises' cycles per metre.
 */
export const HAIR_HAIRLINE = {
  strands: 660,
  wisp: 0.6,
  wander: 0.2,
  wanderScale: 25,
  slow: 0.15,
  slowScale: 8,
  taper: 0.2,
} as const;

/** Strength of the glint a bright strand of the strand map throws at the light, whatever the hair's colour. */
export const HAIR_GLINT = 0.03;

/** Share of the highlight a fluffy style (no direction to its strands) keeps against a combed one. */
export const FLUFFY_HIGHLIGHT = 0.35;

/**
 * Roughness of hair with no direction to its strands (frizz scatters wide) and of
 * perfectly combed hair: it falls linearly with the style's strand coherence.
 */
export const HAIR_ROUGHNESS = { fluffy: 0.95, combed: 0.7 } as const;

/** Scales the base microfacet specular (direct and from the environment): hair has no mirror. */
export const HAIR_SPECULAR_INTENSITY = 0.4;

/** Puts a style's per-vertex occlusion on its geometry for `HairMaterial`. */
export function setHairOcclusionAttribute(geometry: BufferGeometry, occlusion: Float32Array): void {
  geometry.setAttribute(HAIR_OCCLUSION_ATTRIBUTE, new Float32BufferAttribute(occlusion, 1));
}

/** Puts a style's per-vertex fade and growth on its geometry for `HairMaterial`. */
export function setHairStrandAttributes(
  geometry: BufferGeometry,
  fade: Float32Array,
  growth: Float32Array,
  fin: Float32Array,
  uvScale: Float32Array,
): void {
  geometry.setAttribute(HAIR_UVSCALE_ATTRIBUTE, new Float32BufferAttribute(uvScale, 1));
  geometry.setAttribute(HAIR_FADE_ATTRIBUTE, new Float32BufferAttribute(fade, 1));
  geometry.setAttribute(HAIR_FIN_ATTRIBUTE, new Float32BufferAttribute(fin, 1));
  geometry.setAttribute(HAIR_GROWTH_ATTRIBUTE, new Float32BufferAttribute(growth, 1));
}

/** Where `RE_Direct_Physical` adds its specular: the strand lobes follow it. */
const DIRECT_SPECULAR =
  "reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;";

/** Both strand lobes of one light, added to `RE_Direct_Physical`'s direct specular. */
const STRAND_LOBES = `
	{
		vec3 hkH = normalize( directLight.direction + geometryViewDir );
		vec3 hkT1 = normalize( hkT + geometryNormal * ( ${HAIR_LOBES.primaryShift.toFixed(3)} + hkShift ) );
		vec3 hkT2 = normalize( hkT + geometryNormal * ( ${HAIR_LOBES.secondaryShift.toFixed(3)} + hkShift ) );
		float hkS1 = sqrt( max( 0.0, 1.0 - pow2( dot( hkT1, hkH ) ) ) );
		float hkS2 = sqrt( max( 0.0, 1.0 - pow2( dot( hkT2, hkH ) ) ) );
		reflectedLight.directSpecular += irradiance * ${HAIR_GLINT.toFixed(4)} * hkGloss;
		reflectedLight.directSpecular += irradiance * hkTStrength * hkLobes.x * (
			pow( hkS1, hkLobes.z ) * vec3( hkLobes.y ) +
			pow( hkS2, hkLobes.w ) * material.diffuseContribution * hkLobes.y * ${(HAIR_LOBES.secondaryStrength / HAIR_LOBES.primaryStrength).toFixed(3)} );
	}`;

/**
 * Interleaved gradient noise (Jimenez 2014): a cheap, well-spread per-pixel value
 * in [0, 1) whose dither has no visible pattern at one pixel's scale.
 */
const NOISE = `float hkNoise( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
float hkHash( float n ) { return fract( sin( n * 127.1 ) * 43758.5453 ); }
float hkSlow( float x ) { return mix( hkHash( floor( x ) ), hkHash( floor( x ) + 1.0 ), smoothstep( 0.0, 1.0, fract( x ) ) ); }`;

/**
 * The strand's tangent in view space: the gradient of growth over the surface,
 * from the screen-space derivatives of position and growth (the surface-gradient
 * form of a cotangent frame). `hkTStrength` is how well growth is defined here:
 * a distance field changes one metre per metre, so a flat or degenerate
 * gradient (a card seen edge-on, an undefined root) switches the lobes off.
 */
const TANGENT = `
	{
		vec3 hkP = - vViewPosition;
		vec3 hkDp1 = dFdx( hkP );
		vec3 hkDp2 = dFdy( hkP );
		float hkDg1 = dFdx( vHkGrowth );
		float hkDg2 = dFdy( vHkGrowth );
		vec3 hkC1 = cross( hkDp2, normal );
		vec3 hkC2 = cross( normal, hkDp1 );
		float hkDet = dot( hkDp1, hkC1 );
		if ( abs( hkDet ) > 1e-13 ) {
			vec3 hkG = ( hkC1 * hkDg1 + hkC2 * hkDg2 ) / hkDet;
			float hkLen = length( hkG );
			hkTStrength = smoothstep( 0.35, 0.85, hkLen );
			hkT = hkG / max( hkLen, 1e-6 );
		}
	}`;

export class HairMaterial extends MeshPhysicalMaterial {
  /**
   * Strand-lobe parameters, shared with the shader: strength of the figure's
   * highlight (x, lower for fluffy styles), the white lobe's strength (y) and
   * both exponents (z, w).
   */
  readonly hkUniforms: { hkLobes: { value: Vector4 }; hkAcross: { value: Vector2 } };

  constructor() {
    super({
      side: DoubleSide,
      // The wide microfacet lobe is only the base: the strand lobes are the highlight.
      roughness: HAIR_ROUGHNESS.combed,
      metalness: 0,
      specularIntensity: HAIR_SPECULAR_INTENSITY,
      sheen: 0.35,
      sheenRoughness: 0.6,
      alphaTest: HAIR_ALPHA_CUTOFF,
      alphaToCoverage: true,
      transparent: false,
    });
    this.hkUniforms = {
      hkLobes: {
        value: new Vector4(
          1,
          HAIR_LOBES.primaryStrength,
          HAIR_LOBES.primaryExponent,
          HAIR_LOBES.secondaryExponent,
        ),
      },
      // Across the strands in texture space (strands along V give U).
      hkAcross: { value: new Vector2(1, 0) },
    };
  }

  /** Colours the hair: the strand map is multiplied by this pigment colour's tint. */
  setColour(colour: HairColour): void {
    const [r, g, b] = hairTint(colour);
    this.color.setRGB(r, g, b, LinearSRGBColorSpace);
    // Fibre fuzz at grazing angles takes the hair's own colour.
    this.sheenColor.setRGB(r, g, b, LinearSRGBColorSpace);
  }

  /**
   * Sets how strong the strand highlight is from how directional the style's
   * strands are (`coherence`: 0 fluffy or curly, 1 combed). A style with no
   * preferred direction still has a tangent along each card, but its strands
   * curl away from it, so the highlight is weaker than on combed hair.
   */
  setStrand(strand: { angle: number; coherence: number }): void {
    this.hkUniforms.hkLobes.value.x = FLUFFY_HIGHLIGHT + (1 - FLUFFY_HIGHLIGHT) * strand.coherence;
    this.hkUniforms.hkAcross.value.set(-Math.sin(strand.angle), Math.cos(strand.angle));
    // Frizzy hair scatters light wider than combed hair does.
    this.roughness =
      HAIR_ROUGHNESS.fluffy + (HAIR_ROUGHNESS.combed - HAIR_ROUGHNESS.fluffy) * strand.coherence;
  }

  /**
   * Chooses how the cut-outs' edges are drawn: alpha-to-coverage on a
   * multisampled target, a plain alpha test otherwise.
   */
  setMultisampled(multisampled: boolean): void {
    if (this.alphaToCoverage === multisampled) return;
    this.alphaToCoverage = multisampled;
    this.needsUpdate = true;
  }

  override onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, this.hkUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float ${HAIR_OCCLUSION_ATTRIBUTE};
varying float vHkOcclusion;
attribute float ${HAIR_FADE_ATTRIBUTE};
varying float vHkFade;
attribute float ${HAIR_FIN_ATTRIBUTE};
varying float vHkFin;
attribute float ${HAIR_GROWTH_ATTRIBUTE};
varying float vHkGrowth;
attribute float ${HAIR_UVSCALE_ATTRIBUTE};
varying float vHkUvScale;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
	vHkOcclusion = ${HAIR_OCCLUSION_ATTRIBUTE};
	vHkFade = ${HAIR_FADE_ATTRIBUTE};
	vHkFin = ${HAIR_FIN_ATTRIBUTE};
	vHkGrowth = ${HAIR_GROWTH_ATTRIBUTE};
	vHkUvScale = ${HAIR_UVSCALE_ATTRIBUTE};`,
      );
    for (const chunk of ["alphatest_fragment", "normal_fragment_maps", "map_fragment"])
      if (!shader.fragmentShader.includes(`#include <${chunk}>`))
        throw new Error(`HairMaterial: three's ${chunk} chunk moved`);
    const lighting = ShaderChunk.lights_physical_pars_fragment;
    if (!lighting.includes(DIRECT_SPECULAR))
      throw new Error("HairMaterial: three's direct specular line changed");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vHkFade;
varying float vHkFin;
varying float vHkGrowth;
varying float vHkUvScale;
uniform vec4 hkLobes;
vec3 hkT = vec3( 0.0 );
float hkTStrength = 0.0;
float hkShift = 0.0;
float hkKeep = 1.0;
float hkGloss = 0.0;
uniform vec2 hkAcross;
${NOISE}`,
      )
      // The strand map's brightness moves the highlight, so the band breaks into strands.
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
	#ifdef USE_MAP
		float hkTexel = texture2D( map, vMapUv ).g;
		hkShift = ( hkTexel - 0.4 ) * ${HAIR_LOBES.shiftJitter.toFixed(3)};
		// Only the brightest strands glint, so dark hair still shows its curls under the light.
		hkGloss = pow( clamp( ( hkTexel - 0.4 ) / 0.6, 0.0, 1.0 ), 2.0 );
	#endif`,
      )
      .replace(
        "#include <alphatest_fragment>",
        `{
		// A card seen edge-on is a dark line, not hair: it thins out as it turns away.
		vec3 hkFlat = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
		float hkFacing = abs( dot( hkFlat, normalize( vViewPosition ) ) );
		hkKeep = mix( 1.0, smoothstep( ${HAIR_EDGE_ON.from.toFixed(2)}, ${HAIR_EDGE_ON.to.toFixed(2)}, hkFacing ), vHkFin );
		// A fin turning edge-on is its coverage under alpha-to-coverage, a dither without it.
		#ifndef ALPHA_TO_COVERAGE
			if ( hkKeep <= hkNoise( gl_FragCoord.xy ) ) discard;
		#endif
		// A hairline thins strand by strand: each ends at a distance of its own, and the edge wanders.
		#ifdef USE_MAP
			// Metres across the strands, so a strand is a few millimetres wherever the card's island sits.
			float hkAcrossM = dot( vMapUv, hkAcross ) / max( vHkUvScale, 0.01 );
			float hkLine = vHkFade - ${HAIR_HAIRLINE.wander.toFixed(3)} * hkSlow( hkAcrossM * ${HAIR_HAIRLINE.wanderScale.toFixed(1)} ) - ${HAIR_HAIRLINE.slow.toFixed(3)} * hkSlow( hkAcrossM * ${HAIR_HAIRLINE.slowScale.toFixed(1)} + 17.0 );
			// Each strand's tip tapers over a fraction of the fade: coverage under alpha-to-coverage, a dither without.
			float hkTip = ${HAIR_HAIRLINE.wisp.toFixed(3)} * hkHash( floor( hkAcrossM * ${HAIR_HAIRLINE.strands.toFixed(1)} ) );
			hkKeep *= smoothstep( hkTip, hkTip + ${HAIR_HAIRLINE.taper.toFixed(3)}, hkLine );
			if ( hkKeep <= 0.004 ) discard;
			#ifndef ALPHA_TO_COVERAGE
				if ( hkKeep <= hkNoise( gl_FragCoord.xy ) ) discard;
			#endif
		#else
			if ( vHkFade <= hkNoise( gl_FragCoord.xy ) ) discard;
		#endif
	}
	#include <alphatest_fragment>
	#ifdef ALPHA_TO_COVERAGE
		diffuseColor.a *= hkKeep;
	#endif`,
      )
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>${TANGENT}`)
      .replace(
        "#include <lights_physical_pars_fragment>",
        lighting.replace(DIRECT_SPECULAR, `${DIRECT_SPECULAR}${STRAND_LOBES}`),
      );
    patchOcclusionFragment(shader, HAIR_OCCLUSION_FLOOR);
  };

  override customProgramCacheKey(): string {
    return "humanoid-kit-hair-4";
  }
}

/** Whether the renderer's current framebuffer is multisampled (alpha-to-coverage needs it). */
export function isMultisampled(gl: WebGL2RenderingContext | WebGLRenderingContext): boolean {
  return (gl.getParameter(gl.SAMPLES) as number) > 1;
}
