/**
 * The shadow filter the studio's key light is drawn with: three's percentage-closer
 * map (`PCFShadowMap`, a depth texture the GPU compares against bilinearly) read
 * through a tent, a light's `shadow.radius` texels to each side of the sample, as
 * radius² of those bilinear comparisons.
 *
 * three's own PCF reads five comparisons on a disc turned per pixel by a noise, which
 * leaves grain wherever its radius is more than a texel or two; a variance map
 * (`VSMShadowMap`) is smooth, but it stores the depths' mean and spread at half
 * precision and decides by a bound that fails where the occluder and the receiver
 * nearly touch, which is everywhere a body shadows itself at a crease. The tent is
 * an exact convolution of the comparisons: no noise, no banding, the same edge
 * profile everywhere (`docs/ARCHITECTURE.md`, "The key light's shadow").
 *
 * What it cannot remove is the map's own staircase: a depth map knows an occluder's
 * outline only to the texel, so an edge running nearly along the map's rows steps a
 * whole texel every so often, and a tent shifts that step smoothly over its width
 * rather than erasing it. Against the penumbra (about 1.1 radius texels) what is
 * left shrinks as the radius grows: at worst (`tests/browser/shadowEdge.test.ts`)
 * 7.6 % of the penumbra at a radius of 4, 3.5 % at 8, 1.3 % at 12, 0.8 % at 16.
 *
 * Each bilinear comparison weighs two neighbouring texels on each axis; put where a
 * texel's two tent weights split, one read takes both at their exact weights, so
 * `radius` reads an axis cover the 2 radius texels the tent reaches.
 *
 * The filter replaces the body of three's PCF `getShadow` in `ShaderChunk`, the one
 * place every lit material (skin, clothing, hair, anything a consumer adds) reads a
 * directional or spot light's shadow from, so they all agree. A light left at three's
 * default radius of 1 gets one bilinear comparison, three's plain hardware PCF. It is a
 * global of three's, so it is installed once and before any material is compiled: a
 * program compiled earlier keeps three's filter, because three caches programs by
 * their parameters, not their source.
 */
import { ShaderChunk } from "three";

/** The widest tent the filter reads, in texels to each side: 16² = 256 reads. */
export const MAX_TENT_RADIUS = 16;

/**
 * The 10 % to 90 % width, in texels, of a straight shadow edge along the map's rows
 * through a tent of half-width `radius`. Across the edge it is a tent of half-width
 * R, whose area to the left of x (from -R) is (R + x)² / 2R²: 10 % at
 * x = -R (1 - √0.2), 90 % at the mirror of that, so the width is 2 R (1 - √0.2),
 * about 1.1 R.
 */
export function tentEdgeWidth(radius: number): number {
  return 2 * (1 - Math.sqrt(0.2)) * radius;
}

/** Marks the patched chunk, so installing twice is a no-op. */
const MARK = "/* humanoid-kit: tent PCF */";

const SIGNATURE =
  "float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {";
const NEXT_BRANCH = "#elif defined( SHADOWMAP_TYPE_VSM )";

/** The replacement: the same signature, read through a tent of half-width `shadowRadius` texels. */
const TENT_PCF = /* glsl */ `${MARK}
		${SIGNATURE}
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				// The tent's half-width R in texels, a whole number. Its 2R texels an axis
				// are those whose centres (at i + 0.5) lie within R of the sample, the first
				// at first; d is the sample's distance from it, in [R - 1, R).
				float R = clamp( floor( shadowRadius + 0.5 ), 1.0, ${MAX_TENT_RADIUS.toFixed(1)} );
				int reads = int( R );
				vec2 p = shadowCoord.xy * shadowMapSize;
				vec2 first = floor( p - 0.5 ) - ( R - 1.0 ) + 0.5;
				vec2 d = p - first;
				// Each read takes texels 2k and 2k + 1 at their tent weights a and b: placed
				// b / (a + b) past the first one's centre, weighing a + b.
				float xs[ ${MAX_TENT_RADIUS} ];
				float wx[ ${MAX_TENT_RADIUS} ];
				float sumX = 0.0;
				for ( int k = 0; k < ${MAX_TENT_RADIUS}; k ++ ) {
					if ( k >= reads ) break;
					float e = float( 2 * k );
					float a = max( 0.0, R - abs( e - d.x ) );
					float b = max( 0.0, R - abs( e + 1.0 - d.x ) );
					wx[ k ] = a + b;
					xs[ k ] = ( first.x + e + b / ( a + b ) ) / shadowMapSize.x;
					sumX += a + b;
				}
				float lit = 0.0;
				float sumY = 0.0;
				for ( int j = 0; j < ${MAX_TENT_RADIUS}; j ++ ) {
					if ( j >= reads ) break;
					float e = float( 2 * j );
					float a = max( 0.0, R - abs( e - d.y ) );
					float b = max( 0.0, R - abs( e + 1.0 - d.y ) );
					float y = ( first.y + e + b / ( a + b ) ) / shadowMapSize.y;
					float row = 0.0;
					for ( int k = 0; k < ${MAX_TENT_RADIUS}; k ++ ) {
						if ( k >= reads ) break;
						row += wx[ k ] * texture( shadowMap, vec3( xs[ k ], y, shadowCoord.z ) );
					}
					lit += ( a + b ) * row;
					sumY += a + b;
				}
				shadow = lit / ( sumX * sumY );
			}
			return mix( 1.0, shadow, shadowIntensity );
		}

	`;

/**
 * Installs the tent filter into three's PCF shadow chunk (idempotent). Call it before
 * the first frame that compiles a lit material; `configureKeyShadow` does.
 * Throws if three's chunk no longer has the function it replaces, so an upgrade of
 * three that moves it fails loudly instead of silently drawing three's filter.
 */
export function installShadowFilter(): void {
  const chunk = ShaderChunk.shadowmap_pars_fragment;
  if (chunk.includes(MARK)) return;
  const start = chunk.indexOf(SIGNATURE);
  const end = chunk.indexOf(NEXT_BRANCH, start);
  if (start < 0 || end < 0 || chunk.indexOf(SIGNATURE, start + 1) >= 0)
    throw new Error(
      "installShadowFilter: three's shadowmap_pars_fragment no longer has the one PCF getShadow it replaces",
    );
  ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + TENT_PCF + chunk.slice(end);
}

/** Whether the tent filter is installed. */
export function shadowFilterInstalled(): boolean {
  return ShaderChunk.shadowmap_pars_fragment.includes(MARK);
}
