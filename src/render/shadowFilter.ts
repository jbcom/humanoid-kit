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
 * three reads every directional and spot light's shadow in one function, `getShadow`
 * in the shared `ShaderChunk.shadowmap_pars_fragment`. The filter never touches that
 * chunk: a library that rewrote it would change how every lit material in the host
 * app, and every light of its own, is drawn. It is spliced into the shader of one
 * material instead, in that material's `onBeforeCompile` (`patchShadowFilter`), which
 * swaps the PCF `getShadow` in the copy of the chunk that material's program is built
 * from. The kit's materials do it themselves, so skin, clothing, hair, eyes and
 * attachments agree; a consumer's own material opts in with `applyShadowFilter`; and
 * every other material compiles three's chunk untouched.
 *
 * A material that has the filter reads every directional and spot light's shadow
 * through the tent, the host's lights included, at that light's `shadow.radius`: one
 * bilinear comparison at three's default radius of 1, so a figure on a game's board
 * keeps a shadow edge as sharp as the board's own. three caches a program by its
 * parameters, not its source, so the patched program is keyed apart (`SHADOW_FILTER_KEY`)
 * and cannot be taken for the stock one.
 */
import { type Material, ShaderChunk } from "three";

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

/** Marks a shader that has the tent, so patching twice is a no-op. */
export const SHADOW_FILTER_MARK = "/* humanoid-kit: tent PCF */";
const MARK = SHADOW_FILTER_MARK;

/** Part of the program key of every material that has the filter: its program differs from three's. */
export const SHADOW_FILTER_KEY = "humanoid-kit-tent-shadow-1";

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

const INCLUDE = "#include <shadowmap_pars_fragment>";

/** three's shadow chunk with the tent in place of its PCF read, built once per source. */
let built: { from: string; chunk: string } | null = null;

/**
 * Three's `shadowmap_pars_fragment` with its PCF `getShadow` swapped for the tent. A new
 * string: the chunk itself is read, never written. Throws if three's chunk no longer has
 * the function it replaces, so an upgrade of three that moves it fails loudly instead of
 * silently drawing three's filter.
 */
function tentShadowChunk(): string {
  const stock = ShaderChunk.shadowmap_pars_fragment;
  if (built?.from === stock) return built.chunk;
  const start = stock.indexOf(SIGNATURE);
  const end = stock.indexOf(NEXT_BRANCH, start);
  if (start < 0 || end < 0 || stock.indexOf(SIGNATURE, start + 1) >= 0)
    throw new Error(
      "patchShadowFilter: three's shadowmap_pars_fragment no longer has the one PCF getShadow it replaces",
    );
  built = { from: stock, chunk: stock.slice(0, start) + TENT_PCF + stock.slice(end) };
  return built.chunk;
}

/**
 * Has the shader in `shader` (as `onBeforeCompile` receives it, its includes not yet
 * resolved) read directional and spot lights' shadows through the tent. Idempotent, and a
 * shader with no shadow read (an unlit material) is left as it is. Pair it with
 * `SHADOW_FILTER_KEY` in the material's `customProgramCacheKey`, or use
 * `applyShadowFilter`, which does both.
 */
export function patchShadowFilter(shader: { fragmentShader: string }): void {
  if (shader.fragmentShader.includes(MARK) || !shader.fragmentShader.includes(INCLUDE)) return;
  shader.fragmentShader = shader.fragmentShader.replace(INCLUDE, () => tentShadowChunk());
}

/** The materials `applyShadowFilter` has already wrapped. */
const applied = new WeakSet<Material>();

/**
 * Opts `material` in to the tent filter the kit's own materials draw shadows with, so a
 * consumer's own garment, prop or floor agrees with the figure beside it. It keeps the
 * `onBeforeCompile` and `customProgramCacheKey` the material already has, is idempotent,
 * and touches no other material: three's own materials, and the host's, compile three's
 * chunk. Returns the material.
 */
export function applyShadowFilter<M extends Material>(material: M): M {
  if (applied.has(material)) return material;
  applied.add(material);
  const before = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    patchShadowFilter(shader);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|${SHADOW_FILTER_KEY}`;
  material.needsUpdate = true;
  return material;
}
