/**
 * The coat's renderer (docs/ARCHITECTURE.md, "The coat"): short, dense hair as
 * shells over the body, one instanced draw on the body's own geometry and
 * skeleton.
 *
 * - **Shells.** Instance `i` of `N` is the skin pushed out along its rest normal
 *   by `(i + 1) / N` of the hair's length, leaning along the comb as it rises,
 *   before skinning, so the body's skinning (dual quaternions included, through
 *   `applyDualSkinning`) carries every shell as it carries the skin.
 * - **Regions.** Each vertex carries the coat regions' masks (two vec4 of
 *   bytes) and the comb; each region's paint for the figure is a pair of
 *   uniforms (`paintCoat`'s rows). The vertex blends the regions it lies in by
 *   mask × cover.
 * - **Strands.** A strand rises from each follicle cell of the skin's plane at
 *   true scale (`uv × hkUvScale`, cells the follicle spacing wide); a hash of
 *   the cell gives its root, its length and its id, and the strand is there
 *   when its id is under the cover, so cover thins the hair. A shell keeps a
 *   fragment inside a strand that reaches its height, its radius tapering to
 *   the tip. Where a cell is finer than a pixel the shells cannot resolve
 *   strands, and a fragment is kept by an interleaved-gradient dither of the
 *   strands' mean cover at that height instead (the far LOD).
 * - **Shading.** The pigment albedo, darker toward the root (the hair's own
 *   shade), with the hair cards' two Kajiya-Kay lobes along the skinned comb.
 */
import {
  BufferAttribute,
  type BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  ShaderChunk,
  Uint8BufferAttribute,
  Vector4,
} from "three";
import { COAT_REGION_LIMIT } from "../surface/coat.ts";
import { HAIR_LOBES } from "./hairMaterial.ts";
import { UV_SCALE_ATTRIBUTE } from "./skinMaterial.ts";

/** The comb attribute: three floats a vertex, rest space. */
export const COAT_COMB_ATTRIBUTE = "hkCoatComb";
/** The regions' masks: two attributes of four normalised bytes. */
export const COAT_MASK_ATTRIBUTES = ["hkCoatMaskA", "hkCoatMaskB"] as const;

/** Where `RE_Direct_Physical` adds its specular: the coat's strand lobes follow it. */
const DIRECT_SPECULAR =
  "reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;";

/** How dark a strand is at its root against its tip: hair shades the hair under it. A choice. */
export const COAT_ROOT_SHADE = 0.45;

const VERTEX_PARS = /* glsl */ `
attribute vec3 ${COAT_COMB_ATTRIBUTE};
attribute vec4 ${COAT_MASK_ATTRIBUTES[0]};
attribute vec4 ${COAT_MASK_ATTRIBUTES[1]};
attribute float ${UV_SCALE_ATTRIBUTE};
uniform vec4 hkCoatPaint[ ${COAT_REGION_LIMIT * 2} ];
uniform float hkCoatShells;
varying vec2 vCoatP;
varying float vCoatT;
varying float vCoatCover;
varying float vCoatSpacing;
varying float vCoatRadius;
varying vec3 vCoatColour;
varying vec3 vCoatComb;
`;

/** The regions blended at this vertex, the shell's height, and the shell's offset before skinning. */
const VERTEX_REGIONS = /* glsl */ `
	float hkMasks[ ${COAT_REGION_LIMIT} ];
	hkMasks[ 0 ] = ${COAT_MASK_ATTRIBUTES[0]}.x; hkMasks[ 1 ] = ${COAT_MASK_ATTRIBUTES[0]}.y;
	hkMasks[ 2 ] = ${COAT_MASK_ATTRIBUTES[0]}.z; hkMasks[ 3 ] = ${COAT_MASK_ATTRIBUTES[0]}.w;
	hkMasks[ 4 ] = ${COAT_MASK_ATTRIBUTES[1]}.x; hkMasks[ 5 ] = ${COAT_MASK_ATTRIBUTES[1]}.y;
	hkMasks[ 6 ] = ${COAT_MASK_ATTRIBUTES[1]}.z; hkMasks[ 7 ] = ${COAT_MASK_ATTRIBUTES[1]}.w;
	float hkSum = 0.0;
	vec4 hkGrow = vec4( 0.0 );
	vec4 hkLook = vec4( 0.0 );
	for ( int k = 0; k < ${COAT_REGION_LIMIT}; k ++ ) {
		vec4 grow = hkCoatPaint[ 2 * k ];
		float a = hkMasks[ k ] * grow.x;
		hkSum += a;
		hkGrow += a * grow;
		hkLook += a * hkCoatPaint[ 2 * k + 1 ];
	}
	// Cover is the regions' sum (their masks share the skin); the rest is their blend.
	float hkCoverHere = min( hkSum, 1.0 );
	vec4 hkMean = hkSum > 0.0 ? hkGrow / hkSum : vec4( 0.0 );
	vec4 hkLookMean = hkSum > 0.0 ? hkLook / hkSum : vec4( 0.0 );
	float hkLength = hkMean.y;
	float hkLie = hkMean.w;
	vCoatT = ( float( gl_InstanceID ) + 1.0 ) / hkCoatShells;
	vCoatCover = hkCoverHere;
	vCoatSpacing = hkMean.z > 0.0 ? 0.01 / sqrt( hkMean.z ) : 1.0;
	vCoatRadius = clamp( 1.5 * hkLookMean.w / vCoatSpacing, 0.08, 0.35 );
	vCoatColour = hkLookMean.rgb;
	vCoatP = uv * ${UV_SCALE_ATTRIBUTE};
`;

/** The shell's offset: out along the rest normal, leaning along the comb as it rises. */
const VERTEX_OFFSET = /* glsl */ `
	transformed += hkLength * vCoatT * ( normal * ( 1.0 - 0.7 * hkLie ) + ${COAT_COMB_ATTRIBUTE} * hkLie * vCoatT );
`;

/** The comb, skinned like the normal (dual quaternions where the skin uses them). */
const VERTEX_COMB = /* glsl */ `
	vec3 hkComb = ${COAT_COMB_ATTRIBUTE};
	#ifdef USE_SKINNING
		hkComb = ( skinMatrix * vec4( hkComb, 0.0 ) ).xyz;
		#ifdef HK_DUAL_MOTION
			if ( hkShare > 0.0 ) hkComb = mix( hkComb, hkQRotate( hkQ, ${COAT_COMB_ATTRIBUTE} ), hkShare );
		#endif
	#endif
	vCoatComb = ( modelViewMatrix * vec4( hkComb, 0.0 ) ).xyz;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec2 vCoatP;
varying float vCoatT;
varying float vCoatCover;
varying float vCoatSpacing;
varying float vCoatRadius;
varying vec3 vCoatColour;
varying vec3 vCoatComb;
uniform vec4 hkLobes;
float hkCoatHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float hkCoatNoise( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
`;

/** Keeps the fragment only inside a strand that reaches this shell, or, far away, by dither. */
const FRAGMENT_STRANDS = /* glsl */ `
	{
		if ( vCoatCover <= 0.0 ) discard;
		vec2 hkCell = vCoatP / vCoatSpacing;
		float hkPx = length( fwidth( hkCell ) );
		vec2 hkId = floor( hkCell );
		vec2 hkF = hkCell - hkId;
		vec2 hkRoot = 0.25 + 0.5 * vec2( hkCoatHash( hkId ), hkCoatHash( hkId + 17.31 ) );
		float hkReach = 0.6 + 0.4 * hkCoatHash( hkId + 5.17 );
		float hkPresent = step( hkCoatHash( hkId + 9.13 ), vCoatCover );
		float hkRadius = vCoatRadius * ( 1.0 - 0.75 * clamp( vCoatT / hkReach, 0.0, 1.0 ) );
		float hkNear = hkPresent * step( vCoatT, hkReach ) * step( length( hkF - hkRoot ), hkRadius );
		// The strands' mean cover at this height, for the dither where a cell is finer than a pixel.
		float hkMeanCover = vCoatCover * smoothstep( 1.0, 0.6, vCoatT ) * 3.14159 * hkRadius * hkRadius;
		float hkFar = step( hkCoatNoise( gl_FragCoord.xy ), hkMeanCover );
		if ( mix( hkNear, hkFar, smoothstep( 0.35, 0.7, hkPx ) ) < 0.5 ) discard;
		diffuseColor.rgb = vCoatColour * mix( ${COAT_ROOT_SHADE.toFixed(3)}, 1.0, vCoatT );
	}
`;

/** The two Kajiya-Kay lobes of one light along the comb, as the hair cards' (`HAIR_LOBES`). */
const STRAND_LOBES = /* glsl */ `
	{
		vec3 hkT = normalize( vCoatComb );
		vec3 hkH = normalize( directLight.direction + geometryViewDir );
		vec3 hkT1 = normalize( hkT + geometryNormal * ${HAIR_LOBES.primaryShift.toFixed(3)} );
		vec3 hkT2 = normalize( hkT + geometryNormal * ${HAIR_LOBES.secondaryShift.toFixed(3)} );
		float hkS1 = sqrt( max( 0.0, 1.0 - pow2( dot( hkT1, hkH ) ) ) );
		float hkS2 = sqrt( max( 0.0, 1.0 - pow2( dot( hkT2, hkH ) ) ) );
		reflectedLight.directSpecular += irradiance * (
			pow( hkS1, hkLobes.z ) * vec3( hkLobes.y ) +
			pow( hkS2, hkLobes.w ) * material.diffuseContribution * hkLobes.x );
	}`;

/** The coat's material: shells on the body's surface. One per figure. */
export class CoatMaterial extends MeshStandardMaterial {
  readonly hkUniforms: {
    hkCoatPaint: { value: Vector4[] };
    hkCoatShells: { value: number };
    hkLobes: { value: Vector4 };
  };

  constructor() {
    super({ roughness: 0.6, metalness: 0, side: DoubleSide });
    this.color.setRGB(1, 1, 1, LinearSRGBColorSpace);
    this.hkUniforms = {
      hkCoatPaint: { value: Array.from({ length: COAT_REGION_LIMIT * 2 }, () => new Vector4()) },
      hkCoatShells: { value: 8 },
      hkLobes: {
        value: new Vector4(
          HAIR_LOBES.secondaryStrength,
          HAIR_LOBES.primaryStrength,
          HAIR_LOBES.primaryExponent,
          HAIR_LOBES.secondaryExponent,
        ),
      },
    };
  }

  /** The figure's paint (`paintCoat`'s table: per region, two rows of four). */
  setPaint(table: Float32Array): void {
    this.hkUniforms.hkCoatPaint.value.forEach((v, i) => {
      v.set(
        table[i * 4] as number,
        table[i * 4 + 1] as number,
        table[i * 4 + 2] as number,
        table[i * 4 + 3] as number,
      );
    });
  }

  /** How many shells the geometry draws (it must agree with its `instanceCount`). */
  setShells(count: number): void {
    this.hkUniforms.hkCoatShells.value = count;
  }

  override onBeforeCompile: MeshStandardMaterial["onBeforeCompile"] = (shader) => {
    Object.assign(shader.uniforms, this.hkUniforms);
    for (const chunk of ["skinnormal_vertex", "begin_vertex"])
      if (!shader.vertexShader.includes(`#include <${chunk}>`))
        throw new Error(`CoatMaterial: three's ${chunk} chunk moved`);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <skinnormal_vertex>", `#include <skinnormal_vertex>\n${VERTEX_COMB}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${VERTEX_REGIONS}${VERTEX_OFFSET}`,
      );
    const lighting = ShaderChunk.lights_physical_pars_fragment;
    if (!lighting.includes(DIRECT_SPECULAR))
      throw new Error("CoatMaterial: three's direct specular line changed");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAGMENT_STRANDS}`)
      .replace(
        "#include <lights_physical_pars_fragment>",
        lighting.replace(DIRECT_SPECULAR, `${DIRECT_SPECULAR}${STRAND_LOBES}`),
      );
  };

  override customProgramCacheKey(): string {
    return "humanoid-kit-coat-1";
  }
}

/** The body's attributes the coat's geometry draws with: the body's, not the coat's. */
const BODY_ATTRIBUTES = ["position", "normal", "uv", "skinIndex", "skinWeight", UV_SCALE_ATTRIBUTE];

/**
 * The coat's geometry. Disposing it frees only the coat's own buffers: three
 * frees every attribute of a disposed geometry, and the body's, freed under
 * it, leave the body drawing nothing, or the shape it had before.
 */
export class CoatGeometry extends InstancedBufferGeometry {
  override dispose(): void {
    for (const name of BODY_ATTRIBUTES) this.deleteAttribute(name);
    super.dispose();
  }
}

/**
 * The coat's geometry: the body's own attributes (shared, so an evaluation that
 * moves the body moves the coat), the coat's comb and masks, the coat's index
 * (`coatTriangles`), drawn `shells` times.
 */
export function coatGeometry(
  body: BufferGeometry,
  coat: { comb: Float32Array; masks: Uint8Array },
  index: Uint32Array,
  shells: number,
): CoatGeometry {
  const g = new CoatGeometry();
  for (const name of BODY_ATTRIBUTES) {
    const a = body.getAttribute(name);
    if (!a) throw new Error(`coat geometry: the body has no ${name} attribute`);
    g.setAttribute(name, a);
  }
  const n = body.getAttribute("position").count;
  if (coat.comb.length !== n * 3 || coat.masks.length !== n * COAT_REGION_LIMIT)
    throw new RangeError("coat geometry: the coat's fields are not the body's vertices'");
  g.setAttribute(COAT_COMB_ATTRIBUTE, new Float32BufferAttribute(coat.comb, 3));
  const half = (k: number) => {
    const out = new Uint8Array(n * 4);
    for (let v = 0; v < n; v++)
      for (let j = 0; j < 4; j++)
        out[v * 4 + j] = coat.masks[v * COAT_REGION_LIMIT + k * 4 + j] as number;
    return new Uint8BufferAttribute(out, 4, true);
  };
  g.setAttribute(COAT_MASK_ATTRIBUTES[0], half(0));
  g.setAttribute(COAT_MASK_ATTRIBUTES[1], half(1));
  g.setIndex(new BufferAttribute(index, 1));
  g.instanceCount = shells;
  return g;
}
