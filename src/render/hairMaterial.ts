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
 *   meets the scalp, 1 a centimetre in). A strand cell of the card's own surface
 *   is kept or dropped where its strand has ended (`HAIR_HAIRLINE`), so the
 *   hairline is wisps and frayed tips that hold still as the head moves, never a
 *   per-pixel dither. Only each cell's own edge is smoothed, analytically: the
 *   share of a `HAIR_EDGE_PX` footprint on kept cells, from the distance to the
 *   cell's edges over its screen-space derivative. Under MSAA that coverage goes
 *   to alpha-to-coverage, so the edge ramps over a pixel and a half instead of
 *   stepping; it is confined to that band, so no region of partial coverage
 *   (which alpha-to-coverage draws as a dot grid on hardware) ever forms.
 *   Without MSAA the same field is cut at a half. It shows the tinted scalp
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

/** One float per vertex: 0 where the hair has thinned away (a hairline), 1 where it is all there. */
export const HAIR_FADE_ATTRIBUTE = "hkHairFade";

/** One float per vertex: 1 on a card standing out of the scalp (dissolved strand cell by strand cell edge-on), 0 on one lying along it. */
export const HAIR_FIN_ATTRIBUTE = "hkHairFin";

/** One float per vertex: texture units per metre across the card. */
export const HAIR_UVSCALE_ATTRIBUTE = "hkHairUvScale";

/** One float per vertex: metres along the card from the hair's root. */
export const HAIR_GROWTH_ATTRIBUTE = "hkHairGrowth";

/**
 * One float per vertex, body hair cards only: its card's rank, 0..1. A card is
 * drawn while its rank is under the material's density (`setDensity`); absent
 * (scalp hair), it reads 0.
 */
export const HAIR_RANK_ATTRIBUTE = "hkHairRank";

/** Gives a body hair card entry's geometry its cards' ranks (`HairTopology.rank`). */
export function setHairRankAttribute(geometry: BufferGeometry, rank: Float32Array): void {
  geometry.setAttribute(HAIR_RANK_ATTRIBUTE, new Float32BufferAttribute(rank, 1));
}

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
 * direction) dissolves strand cell by cell between `from` (gone) and `to` (all there). A flat
 * card seen edge-on is a hairline-thin dark sliver, and styles that stand loose
 * cards out of the scalp (the afro's curls) otherwise read as a lattice of such
 * slivers across the head. A card lying along the scalp is never faded this way:
 * a head's shell is seen at a grazing angle over much of its area.
 */
export const HAIR_EDGE_ON = { from: 0.5, to: 0.95 } as const;

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
 * its tip fraying over `taper` of the fade cell by cell along the strand, and the
 * whole edge recedes along its length by up to `wander` + `slow` of the fade (two
 * slow noises, so no hairline is a ruled straight line: a wander and a recession).
 * Every decision is a yes or no per cell of the card's own surface, never per screen
 * pixel; only the cells' edges are smoothed (`HAIR_EDGE_PX`). `strands` is strands
 * per metre across the strand direction (1.5 mm) and `cells` the fray's cells per metre
 * along it (4.5 mm); `wisp` bounds the hash so a card well in is never thinned
 * (`wisp + taper + wander + slow` is at most 1, so a card at full fade is whole at every
 * strand); `wanderScale` and `slowScale` are the noises' cycles per metre.
 */
export const HAIR_HAIRLINE = {
  strands: 660,
  cells: 220,
  reach: 0.016,
  wisp: 0.45,
  wander: 0.2,
  wanderScale: 25,
  slow: 0.15,
  slowScale: 8,
  taper: 0.2,
} as const;

/**
 * Width in pixels of the footprint a strand cell's edge is smoothed over: a box this wide
 * centred on the pixel, so coverage ramps from 0 to 1 across about one and a half pixels.
 * A box exactly one pixel wide would still put an empty and a whole pixel either side of an
 * edge that falls on a pixel boundary; any wider and a strand 2 px across goes soft.
 */
export const HAIR_EDGE_PX = 1.5;

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
const NOISE = `float hkHash( float n ) { return fract( sin( n * 127.1 ) * 43758.5453 ); }
float hkHash2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float hkSlow( float x ) { return mix( hkHash( floor( x ) ), hkHash( floor( x ) + 1.0 ), smoothstep( 0.0, 1.0, fract( x ) ) ); }`;

/**
 * How much of strand cell `id` is there, 0..1: its strand's tip (a hash of the strand plus
 * a fray per cell) against the hairline's thinning field `line`, times the cell's own
 * threshold against the fin's keep. Each is a ramp over its field's footprint (`lineW`,
 * `finW`), so a strand's end within a cell is smooth too; a field that does not change
 * over the pixel makes it a yes or no for the whole cell.
 */
const CELL_KEEP = `float hkCellKeep( vec2 id, float line, float lineW, float fin, float finW ) {
	float tip = ${HAIR_HAIRLINE.wisp.toFixed(3)} * hkHash( id.x ) + ${HAIR_HAIRLINE.taper.toFixed(3)} * hkHash2( vec2( id.x + 71.0, id.y ) );
	return clamp( 0.5 + ( line - tip ) / lineW, 0.0, 1.0 ) * clamp( 0.5 + ( fin - hkHash2( id ) ) / finW, 0.0, 1.0 );
}`;

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
  readonly hkUniforms: {
    hkLobes: { value: Vector4 };
    hkAcross: { value: Vector2 };
    hkDensity: { value: number };
  };

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
      hkDensity: { value: 1 },
    };
  }

  /**
   * How much of a body hair card entry is drawn, 0..1 (the figure's coverage):
   * the cards whose rank is under it. Scalp hair carries no ranks (all 0) and is
   * drawn whole at the default of 1.
   */
  setDensity(density: number): void {
    this.hkUniforms.hkDensity.value = Math.min(1, Math.max(0, density));
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
varying float vHkUvScale;
attribute float ${HAIR_RANK_ATTRIBUTE};
varying float vHkRank;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
	vHkRank = ${HAIR_RANK_ATTRIBUTE};
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
varying float vHkRank;
uniform float hkDensity;
uniform vec4 hkLobes;
vec3 hkT = vec3( 0.0 );
float hkTStrength = 0.0;
float hkShift = 0.0;
float hkCover = 1.0;
float hkOwn = 1.0;
float hkGloss = 0.0;
uniform vec2 hkAcross;
${NOISE}
${CELL_KEEP}`,
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
		// Body hair cards: a card is drawn while its rank is under the figure's
		// coverage, whole or not at all (scalp hair has rank 0 and density 1).
		if ( vHkRank >= hkDensity ) discard;
		// A card seen edge-on is a dark line, not hair: it thins out as it turns away.
		vec3 hkFlat = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
		float hkFacing = abs( dot( hkFlat, normalize( vViewPosition ) ) );
		float hkFinKeep = mix( 1.0, smoothstep( ${HAIR_EDGE_ON.from.toFixed(2)}, ${HAIR_EDGE_ON.to.toFixed(2)}, hkFacing ), vHkFin );
		// Each strand cell of the card's own surface is kept or dropped (never a decision per screen
		// pixel), and only a cell's own edge is smoothed: the share of a ${HAIR_EDGE_PX.toFixed(2)}-pixel
		// footprint that falls on kept cells, from the distance to the cell's edges over the screen-space
		// derivative. Under MSAA that is alpha-to-coverage; without it the same field is cut at a half.
		#ifdef USE_MAP
			// Metres across and along the strands, so a strand is a few millimetres wherever the card's island sits.
			vec2 hkAlongDir = vec2( hkAcross.y, -hkAcross.x );
			float hkScale = max( vHkUvScale, 0.01 );
			float hkAcrossM = dot( vMapUv, hkAcross ) / hkScale;
			float hkAlongM = dot( vMapUv, hkAlongDir ) / hkScale;
			// A hairline thins strand by strand: each ends at a distance of its own, its tip frays, and the edge wanders.
			// Where the card is a hairline (its fade is low: it is near an edge that meets the scalp) the
			// thinning follows the hair that is painted, not the card: a card's mesh reaches well past
			// its painted hair, so a fade measured on the mesh runs out over transparent texels. The
			// painted edge's distance is the blurred alpha (a mip chosen to span the reach in metres), 0.5 at
			// the edge and 1 a reach inside it.
			float hkLod = log2( max( 1.0, ${HAIR_HAIRLINE.reach.toFixed(4)} * hkScale * float( textureSize( map, 0 ).x ) ) );
			float hkBlur = textureLod( map, vMapUv, hkLod ).a;
			float hkOnLine = 1.0 - smoothstep( 0.7, 1.0, vHkFade );
			float hkFade = mix( 1.0, pow( clamp( ( hkBlur - 0.45 ) / 0.5, 0.0, 1.0 ), 1.6 ), hkOnLine );
			float hkLine = hkFade - ${HAIR_HAIRLINE.wander.toFixed(3)} * hkSlow( hkAcrossM * ${HAIR_HAIRLINE.wanderScale.toFixed(1)} ) - ${HAIR_HAIRLINE.slow.toFixed(3)} * hkSlow( hkAcrossM * ${HAIR_HAIRLINE.slowScale.toFixed(1)} + 17.0 );
			// Strand cells: x across the strands (one per strand), y along them (a fin dissolves, and a tip frays, cell by cell).
			vec2 hkUv = vec2( hkAcrossM * ${HAIR_HAIRLINE.strands.toFixed(1)}, hkAlongM * ${HAIR_HAIRLINE.cells.toFixed(1)} );
			// The pixel's footprint in cells, and how much of it lies over the nearer neighbour on each axis
			// (a half at the shared edge, none once the edge is half a footprint away).
			vec2 hkFoot = max( fwidth( hkUv ) * ${HAIR_EDGE_PX.toFixed(2)}, vec2( 1e-4 ) );
			vec2 hkId = floor( hkUv );
			vec2 hkIn = hkUv - hkId;
			vec2 hkSide = vec2( hkIn.x < 0.5 ? -1.0 : 1.0, hkIn.y < 0.5 ? -1.0 : 1.0 );
			vec2 hkW = clamp( ( 0.5 * hkFoot - min( hkIn, 1.0 - hkIn ) ) / hkFoot, 0.0, 0.5 );
			float hkLineW = max( fwidth( hkLine ) * ${HAIR_EDGE_PX.toFixed(2)}, 1e-5 );
			float hkFinW = max( fwidth( hkFinKeep ) * ${HAIR_EDGE_PX.toFixed(2)}, 1e-5 );
			hkOwn = hkCellKeep( hkId, hkLine, hkLineW, hkFinKeep, hkFinW );
			hkCover = mix(
				mix( hkOwn, hkCellKeep( hkId + vec2( hkSide.x, 0.0 ), hkLine, hkLineW, hkFinKeep, hkFinW ), hkW.x ),
				mix( hkCellKeep( hkId + vec2( 0.0, hkSide.y ), hkLine, hkLineW, hkFinKeep, hkFinW ), hkCellKeep( hkId + hkSide, hkLine, hkLineW, hkFinKeep, hkFinW ), hkW.x ),
				hkW.y );
		#else
			hkCover = clamp( 0.5 + ( vHkFade - 0.5 ) / max( fwidth( vHkFade ) * ${HAIR_EDGE_PX.toFixed(2)}, 1e-5 ), 0.0, 1.0 )
				* clamp( 0.5 + ( hkFinKeep - 0.5 ) / max( fwidth( hkFinKeep ) * ${HAIR_EDGE_PX.toFixed(2)}, 1e-5 ), 0.0, 1.0 );
			hkOwn = hkCover;
		#endif
	}
	#include <alphatest_fragment>
	// Under MSAA alpha-to-coverage turns the smoothed coverage into samples; without it the
	// fragment's own cell decides, exactly as a yes or no.
	#ifdef ALPHA_TO_COVERAGE
		diffuseColor.a *= hkCover;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		if ( hkOwn < 0.5 ) discard;
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
    return "humanoid-kit-hair-5";
  }
}

/** Whether the renderer's current framebuffer is multisampled (alpha-to-coverage needs it). */
export function isMultisampled(gl: WebGL2RenderingContext | WebGLRenderingContext): boolean {
  return (gl.getParameter(gl.SAMPLES) as number) > 1;
}
