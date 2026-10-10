/**
 * A physically based skin material for humanoid-kit figures.
 *
 * It extends three's MeshPhysicalMaterial with:
 * - subsurface scattering derived from the colour itself, so any colour (skin,
 *   fur, scales, fantasy) scatters plausibly with no per-colour tuning: each
 *   channel's scatter distance follows from its albedo (Chiang, Kutz & Burley
 *   2016; Christensen & Burley 2015), and how much light it carries round a
 *   curve follows from that distance and the surface's curvature through
 *   Penner's pre-integration of Burley's profile, tabulated
 *   (docs/research/ALGORITHMIC-APPEARANCE.md §2);
 * - regional colour from the skin layer stack (src/surface/layers.ts): a field
 *   atlas shared by every figure (`setLayerAtlas`) and this figure's stop
 *   table, applied per pixel in UV space, so it follows every shape change;
 * - a fine tiling pore normal map and a low sheen for vellus hair.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  ShaderChunk,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { inkOptics } from "../bodyArt/ink.ts";
import { MARK_DARK_STEPS, markRatios, SCAR_RAISE, SCAR_SMOOTHNESS } from "../bodyArt/marks.ts";
import { type AtlasPlan, OWNER_GRID, planAtlas } from "../surface/atlasPlan.ts";
import {
  CREASE_SHARPNESS,
  MAX_STRAND_COVER,
  paintStopTable,
  type SkinLayer,
  type SkinPaintInput,
  STOP_COUNT,
  STOP_TABLE_WIDTH,
  TUBERCLE_RADIUS,
} from "../surface/layers.ts";
import { LIPS_LAYER, NAIL_GLOSS_LAYER, SKIN_LAYERS } from "../surface/regions/index.ts";
import {
  RIDGE_ACROSS,
  RIDGE_ALONG,
  RIDGE_CELL_PERIODS,
  RIDGE_CONTRAST,
  RIDGE_KERNELS,
  RIDGE_ORIENTATION_SEAM,
  RIDGE_SIGMA,
} from "../surface/ridges.ts";
import { SKIN_SCATTER, WAVELENGTH_RATIO } from "../surface/scatter.ts";
import { SCATTER_TABLE } from "../surface/scatterTable.ts";
import { luminance, MELANIN_ANCHORS, type Rgb, skinAlbedo } from "../surface/skinTone.ts";
import {
  STRIA_CELL,
  STRIA_CLUSTER_LENGTH,
  STRIA_CLUSTER_RAMP,
  STRIA_CLUSTER_SPACING,
  STRIA_CLUSTER_TURN,
  STRIA_CLUSTER_WIDTH,
  STRIA_MARK_AREA,
  STRIA_MARK_SHARE,
  STRIA_MARKS,
  STRIA_MASK_EDGE,
  STRIA_MEANDER,
  STRIA_PATCH,
  STRIA_PATCH_SHARE,
  STRIA_RELIEF_SOFT,
  STRIA_SALTS,
  STRIA_SOFT,
  STRIAE_DETAIL_FADE,
  STRIAE_MEAN_SAMPLES,
  STRIAE_ORIENTATION_SEAM,
  STRIAE_RELIEF_FADE,
} from "../surface/striae.ts";
import { DECAL_FUNCTIONS } from "./bodyArtDecals.ts";
import { type BodyArtTexture, MARK_NEUTRAL } from "./bodyArtTexture.ts";
import { DUAL_SKINNING_KEY, type DualBones, patchDualSkinning } from "./dualSkinning.ts";
import { emptyLayerAtlas, emptyOwners, type SkinLayerAtlas } from "./layerAtlas.ts";
import { BODY_OCCLUSION_FLOOR, BODY_OCCLUSION_POWER, patchOcclusion } from "./occlusion.ts";
import { STRAND_FOOTPRINT } from "./strandFootprint.ts";

/** What the skin material is painted from: the recipe's skin and the figure's state signals. */
export type SkinAppearance = Omit<SkinPaintInput, "signals"> & {
  signals?: SkinPaintInput["signals"];
};

export const DEFAULT_SKIN_APPEARANCE: Readonly<SkinAppearance> = {
  tone: { melanin: 0.35, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0.45,
  lips: 0.55,
  areola: 0.5,
};

const DIRECT_DIFFUSE =
  "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );";

/** Name of the per-vertex curvature attribute (mean curvature magnitude, m⁻¹). */
export const CURVATURE_ATTRIBUTE = "hkCurvature";

/**
 * Name of the per-vertex attribute holding how densely the worn hair style grows
 * from the skin there (`HairTopology.scalp`): 0 on a figure with none.
 */
export const SCALP_ATTRIBUTE = "hkScalp";

/** How far the skin goes toward its stubble tone where hair grows from it at full density. */
export const SCALP_STRENGTH = 0.7;

/**
 * The stubble tone is the skin's own colour in the shade of the hair above it
 * (`SCALP_SHADE` of it) with a little of the hair's colour (`SCALP_HAIR_SHARE`).
 * Built from the skin, not from the hair, so white hair does not paint a pale
 * patch on deep skin, nor black hair a dark one on fair.
 */
export const SCALP_SHADE = 0.7;
export const SCALP_HAIR_SHARE = 0.15;

/** A GLSL float literal. */
const glslFloat = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** Name of the per-vertex attribute holding metres of skin per UV unit. */
export const UV_SCALE_ATTRIBUTE = "hkUvScale";

/** How many directions strand layers quantise the hair flow to (over a half turn). */
export const STRAND_DIRECTIONS = 8;

/**
 * Pixel sizes, in cells across, between which strands give way to their mean
 * cover: drawn one by one while a pixel is under a third of a cell, the mean
 * from two thirds on.
 */
export const STRAND_NEAR_LIMIT = 0.33;
export const STRAND_FAR_START = 0.66;

/**
 * Strand layers (kind 6): hair lying on the skin, drawn at true scale.
 *
 * Each layer's strands are roots scattered over a grid of cells in the plane
 * of the skin (metres, `uv × hkUvScale`), a cell half a strand long along the
 * hair's flow and as wide across it as the follicle density leaves, so one
 * root a cell is the density. A root carries a strand when a hash of its cell
 * is under the layer's coverage times its mask, so a mask's soft edge thins
 * the hair rather than fading it. A strand is a segment of random length
 * (half to all of the layer's), tilted a little, thinning to its tip; its
 * coverage of the pixel is the strand footprint across it (`STRAND_FOOTPRINT`,
 * its width under a tent a pixel either side, shared with the coat), so a
 * strand about a pixel wide is soft-edged rather than a hard dash, and a far
 * one a faint line rather than a flickering one.
 *
 * The flow is the bind pose's downward direction carried through the
 * skinning (`vHkFlow`, view space), so hair runs down the limbs and trunk and
 * follows them as they move. The pixel's UV-space direction comes from the
 * position and UV derivatives. Rotating the grid by that direction pixel by
 * pixel would shear it wherever the direction varies (the grid's coordinates
 * are thousands of cells), so it is quantised to `STRAND_DIRECTIONS` fixed
 * grids over a half turn, and each root belongs to the nearer of the two
 * grids round the flow by a hash weighted by closeness: the density is kept
 * and no strand is drawn faint twice.
 *
 * Where a cell across is smaller than a pixel the grid cannot be sampled, and
 * the strands become their mean cover (`strandCover`, what `applyLayers`
 * computes), eased in as the pixel grows from `STRAND_NEAR_LIMIT` to
 * `STRAND_FAR_START` of a cell: the search covers the cells round the pixel's
 * centre, so a pixel any wider than a cell would sample a few strands of many
 * and speckle.
 */
const STRAND_FUNCTIONS = (count: number) => `
${STRAND_FOOTPRINT}
varying vec3 vHkFlow;
// The strands' relief at this pixel, metres, left by hkApplyStrands for the normal.
float hkStrandHeight = 0.0;
// A hash that holds up at the large cell coordinates strands reach (Hoskins' hash12).
float hkHashS( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
// One grid's strands at p (metres), oriented at angle: their cover of the pixel, 0..1.
// keep: the share of roots this grid draws; cover: the share that carry hair.
float hkStrandGrid( vec2 p, float angle, float seed, float keep, float cover, float density, float len, float width, float px ) {
	float cl = 0.5 * len;
	float ca = 1.0 / ( density * cl );
	float c = cos( angle ), s = sin( angle );
	vec2 q = vec2( c * p.x + s * p.y, - s * p.x + c * p.y );
	vec2 g = floor( q / vec2( cl, ca ) );
	float clear = 1.0;
	for ( int dx = -2; dx <= 0; dx ++ )
		for ( int dy = -1; dy <= 1; dy ++ ) {
			vec2 id = g + vec2( float( dx ), float( dy ) );
			vec2 k = id + seed;
			if ( hkHashS( k + 3.71 ) >= keep || hkHashS( k + 9.13 ) >= cover ) continue;
			vec2 root = ( id + vec2( hkHashS( k ), hkHashS( k + 17.31 ) ) ) * vec2( cl, ca );
			float slen = len * ( 0.5 + 0.5 * hkHashS( k + 5.17 ) );
			float tilt = ( 2.0 * hkHashS( k + 7.77 ) - 1.0 ) * min( 0.25, 0.45 * ca / slen );
			vec2 dir = vec2( cos( tilt ), sin( tilt ) );
			vec2 rel = q - root;
			float t = dot( rel, dir );
			if ( t < - px || t > slen + px ) continue;
			float d = dot( rel, vec2( - dir.y, dir.x ) );
			float w = width * ( 1.0 - 0.6 * clamp( t / slen, 0.0, 1.0 ) );
			float across = hkStrandFootprint( d, w, px );
			float along = clamp( ( t + 0.5 * px ) / px, 0.0, 1.0 ) * clamp( ( slen - t + 0.5 * px ) / px, 0.0, 1.0 );
			clear *= 1.0 - across * along;
		}
	return 1.0 - clear;
}
// Applies every strand layer to the colour c at uv, and leaves their relief in hkStrandHeight.
vec3 hkApplyStrands( vec3 c, vec2 uv ) {
	// A surface without a scale (no metres per UV unit) has no true-scale detail.
	if ( vHkUvScale <= 0.0 ) return c;
	vec2 p = uv * vHkUvScale;
	float px = max( max( length( dFdx( p ) ), length( dFdy( p ) ) ), 1e-7 );
	// The flow's direction in UV: the screen-space combination of the position's
	// derivatives nearest to it, carried to UV by the same combination of uv's.
	vec3 dpx = dFdx( - vViewPosition );
	vec3 dpy = dFdy( - vViewPosition );
	vec2 dux = dFdx( uv );
	vec2 duy = dFdy( uv );
	float a11 = dot( dpx, dpx ), a12 = dot( dpx, dpy ), a22 = dot( dpy, dpy );
	float det = a11 * a22 - a12 * a12;
	vec2 r = vec2( dot( dpx, vHkFlow ), dot( dpy, vHkFlow ) );
	vec2 k = abs( det ) > 1e-30 ? vec2( a22 * r.x - a12 * r.y, a11 * r.y - a12 * r.x ) / det : vec2( 0.0 );
	vec2 flow = k.x * dux + k.y * duy;
	float theta = dot( flow, flow ) > 0.0 ? atan( flow.y, flow.x ) : 0.0;
	float f = mod( theta, 3.14159265 ) / ( 3.14159265 / ${glslFloat(STRAND_DIRECTIONS)} );
	float i0 = floor( f );
	float wNext = f - i0;
	float turn = 3.14159265 / ${glslFloat(STRAND_DIRECTIONS)};
	for ( int l = 0; l < ${count}; l ++ ) {
		vec4 head = hkHeader( l );
		if ( hkKind( head ) != 6 || head.x <= 0.0 ) continue;
		float mask = hkFields( l, uv ).x;
		if ( mask <= 0.0 ) continue;
		vec4 hair = texelFetch( hkLayerStops, ivec2( 1, l ), 0 );
		vec4 more = texelFetch( hkLayerStops, ivec2( 2, l ), 0 );
		float relief = more.x * 1e-3;
		float density = head.z * 1e4;
		float len = head.w * 1e-3;
		float width = hair.w * 1e-3;
		float cover = head.x * mask;
		// Hair the skin's measured albedo already holds (vellus) adds no mean cover.
		float mean = more.y > 0.5 ? 0.0 : min( ${glslFloat(MAX_STRAND_COVER)}, cover * density * 0.75 * len * width );
		float ca = 1.0 / ( density * 0.5 * len );
		float far = smoothstep( ${glslFloat(STRAND_NEAR_LIMIT)}, ${glslFloat(STRAND_FAR_START)}, px / ca );
		float a = mean;
		if ( far < 1.0 ) {
			float seed = float( l ) * 101.0;
			float a0 = hkStrandGrid( p, i0 * turn, seed, 1.0 - wNext, cover, density, len, width, px );
			float a1 = hkStrandGrid( p, ( i0 + 1.0 ) * turn, seed + 53.0, wNext, cover, density, len, width, px );
			float near = 1.0 - ( 1.0 - a0 ) * ( 1.0 - a1 );
			a = mix( near, mean, far );
			hkStrandHeight += ( 1.0 - far ) * near * relief;
		}
		// Hair is never lighter than the skin it lies on: a fair strand on deep
		// skin is seen as a darker line, not a light fleck.
		float lh = dot( hair.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		float ls = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
		vec3 strand = lh > ls ? hair.rgb * ( ls / lh ) : hair.rgb;
		c = mix( c, strand, a );
	}
	return c;
}`;

/**
 * The layer stack, per pixel: the shader form of `applyLayers`,
 * `surfaceChange` and `creaseHeight`, which the browser tests hold it to.
 * Layer l's fields are in atlas page l / 2 (RG for even l, BA for odd); its
 * row of the stop table starts with the header (strength, kind, a, b) and, for
 * a colour layer, the stops, which linear filtering interpolates along the
 * coordinate. The kind comes from the table, the same for every pixel, so the
 * branches on it are uniform and the derivatives under them well defined.
 */
const layerFunctions = (count: number) => `
varying vec2 vHkUv;
varying float vHkUvScale;
uniform highp sampler2DArray hkLayerAtlas;
uniform sampler2D hkLayerStops;
// Which cell of the body's UV plane owns each texel of a channel that layers share.
uniform highp sampler2DArray hkLayerOwners;
// Per layer, the atlas channels of its mask (x, -1: none, mask 1) and coordinate (y, -1: none), four to a page,
// and, for a layer that shares its channels, its owner map (z, -1: none) and its id in it (w).
uniform vec4 hkChannel[${Math.max(1, count)}];
vec4 hkPage( float c, vec2 uv ) { return texture( hkLayerAtlas, vec3( uv, floor( c * 0.25 ) ) ); }
float hkChannelOf( vec4 page, float c ) { return page[ int( c - 4.0 * floor( c * 0.25 ) + 0.5 ) ]; }
vec2 hkFields( int l, vec2 uv ) {
	vec4 ch = hkChannel[ l ];
	// A layer on all the skin has no channel.
	if ( ch.x < 0.0 ) return vec2( 1.0, 0.0 );
	if ( ch.z >= 0.0 ) {
		// The channel holds this layer's fields only in the cells the owner map gives it.
		ivec2 cell = ivec2( clamp( uv, 0.0, 0.9999 ) * ${glslFloat(OWNER_GRID)} );
		vec4 owners = texelFetch( hkLayerOwners, ivec3( cell, int( floor( ch.z * 0.25 ) ) ), 0 );
		float owner = owners[ int( ch.z - 4.0 * floor( ch.z * 0.25 ) + 0.5 ) ];
		if ( abs( owner * 255.0 - ch.w ) > 0.5 ) return vec2( 0.0 );
	}
	vec4 maskPage = hkPage( ch.x, uv );
	float mask = hkChannelOf( maskPage, ch.x );
	if ( ch.y < 0.0 ) return vec2( mask, 0.0 );
	vec4 coordPage = floor( ch.y * 0.25 ) == floor( ch.x * 0.25 ) ? maskPage : hkPage( ch.y, uv );
	return vec2( mask, hkChannelOf( coordPage, ch.y ) );
}
vec4 hkHeader( int l ) { return texelFetch( hkLayerStops, ivec2( 0, l ), 0 ); }
int hkKind( vec4 head ) { return int( head.y + 0.5 ); }
// Roughness change (x) and specular change (y) of the surface layers.
vec2 hkSurfaceChange( vec2 uv ) {
	vec2 s = vec2( 0.0 );
	for ( int l = 0; l < ${count}; l ++ ) {
		vec4 head = hkHeader( l );
		if ( hkKind( head ) != 4 ) continue;
		s += hkFields( l, uv ).x * head.x * head.zw;
	}
	return s;
}
${STRAND_FUNCTIONS(count)}
float hkHash( vec2 p ) {
	return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
// A jittered field of rounded bumps, one per cell (p in cells): 1 at a bump's top.
float hkBumps( vec2 p ) {
	vec2 i = floor( p );
	float h = 0.0;
	for ( int y = -1; y <= 1; y ++ )
		for ( int x = -1; x <= 1; x ++ ) {
			vec2 c = i + vec2( float( x ), float( y ) );
			vec2 centre = c + 0.2 + 0.6 * vec2( hkHash( c ), hkHash( c + 17.31 ) );
			float d = length( p - centre ) / 0.35;
			h = max( h, pow( max( 1.0 - d * d, 0.0 ), 2.0 ) );
		}
	return h;
}
// Tubercles: bumps in a share of the cells, the share (0..1) being layer l's occupancy (its
// profile) at the bump's own centre: the layer's coordinate is read from the atlas at the
// centre's UV (cellUv: UV per cell), so every pixel of a bump makes the same decision and a
// bump is drawn whole or not at all. A cell raises a bump once the occupancy passes its own
// random draw, and only if its centre lies inside the limit, which the paint has drawn in by a
// bump's radius (DetailPaint.limit in layers.ts): none crosses the edge it stands for.
float hkTubercles( vec2 p, int l, vec2 uv, float cellUv, float limit ) {
	vec2 i = floor( p );
	float h = 0.0;
	for ( int y = -1; y <= 1; y ++ )
		for ( int x = -1; x <= 1; x ++ ) {
			vec2 c = i + vec2( float( x ), float( y ) );
			vec2 centre = c + 0.2 + 0.6 * vec2( hkHash( c ), hkHash( c + 17.31 ) );
			vec2 at2 = hkFields( l, uv + ( centre - p ) * cellUv );
			float at = at2.y;
			if ( at2.x <= 0.0 || at > limit ) continue;
			float u = ( 1.5 + clamp( at, 0.0, 1.0 ) * ${glslFloat(STOP_COUNT - 1)} ) / ${glslFloat(STOP_TABLE_WIDTH)};
			float occupancy = texture( hkLayerStops, vec2( u, ( float( l ) + 0.5 ) / ${glslFloat(count)} ) ).r;
			if ( occupancy <= hkHash( c + 41.7 ) ) continue;
			float d = length( p - centre ) / ${glslFloat(TUBERCLE_RADIUS)};
			h = max( h, pow( max( 1.0 - d * d, 0.0 ), 2.0 ) );
		}
	return h;
}
// Friction ridges: sparse Gabor noise, the shader form of ridgeHeight (src/surface/ridges.ts).
uvec2 hkRidgeHash( uvec2 v ) {
	v = v * 1664525u + 1013904223u;
	v.x += v.y * 1664525u;
	v.y += v.x * 1664525u;
	v = v ^ ( v >> 16u );
	v.x += v.y * 1664525u;
	v.y += v.x * 1664525u;
	v = v ^ ( v >> 16u );
	return v;
}
float hkRidges( vec2 p, float theta, float spacing ) {
	float cell = ${glslFloat(RIDGE_CELL_PERIODS)} * spacing;
	ivec2 i = ivec2( floor( p / cell ) );
	vec2 w = vec2( cos( theta ), sin( theta ) );
	float sa = ${glslFloat(RIDGE_ALONG)} * spacing;
	float sc = ${glslFloat(RIDGE_ACROSS)} * spacing;
	float sum = 0.0;
	for ( int j = -1; j <= 1; j ++ )
		for ( int k = -1; k <= 1; k ++ ) {
			ivec2 c = i + ivec2( k, j );
			for ( int n = 0; n < ${RIDGE_KERNELS}; n ++ ) {
				uvec2 h = hkRidgeHash( uvec2( uint( c.x + 32768 ), uint( c.y * ${RIDGE_KERNELS} + n + 32768 ) ) );
				float phase = float( hkRidgeHash( uvec2( uint( c.x + 16384 ), uint( c.y * ${RIDGE_KERNELS} + n + 16384 ) ) ).x ) * 2.3283064365386963e-10;
				vec2 centre = ( vec2( c ) + vec2( h ) * 2.3283064365386963e-10 ) * cell;
				vec2 d = p - centre;
				float across = dot( d, w );
				float along = - d.x * w.y + d.y * w.x;
				float env = exp( - 0.5 * ( along * along / ( sa * sa ) + across * across / ( sc * sc ) ) );
				sum += env * cos( 6.28318530718 * ( across / spacing + phase ) );
			}
		}
	return clamp( 0.5 + ${glslFloat(RIDGE_CONTRAST / RIDGE_SIGMA)} * sum, 0.0, 1.0 );
}
// How much of a periodic relief survives at this footprint (in periods per pixel):
// all of it up to a tenth of a period, none from three tenths, where a period is
// under about 3 px and the shading would shimmer. The one function the creases and
// the ridges fade by.
float hkFootprintFade( float periodsPerPixel ) {
	return 1.0 - smoothstep( 0.1, 0.3, periodsPerPixel );
}
// Perlin's smootherstep on 0..1 (smootherstep in layers.ts).
float hkSmootherstep( float t ) {
	float x = clamp( t, 0.0, 1.0 );
	return x * x * x * ( x * ( 6.0 * x - 15.0 ) + 10.0 );
}
// Layer l's control value k of a swell's cross-section: stop k's red, clamped to the ends.
float hkSwellControl( int l, int k ) {
	float u = ( 1.5 + float( clamp( k, 0, ${STOP_COUNT - 1} ) ) ) / ${glslFloat(STOP_TABLE_WIDTH)};
	return texture( hkLayerStops, vec2( u, ( float( l ) + 0.5 ) / ${glslFloat(count)} ) ).r;
}
// A swell's cross-section at the coordinate: the uniform cubic B-spline through the
// controls (swellProfile in layers.ts), smooth in slope and curvature everywhere.
float hkSwellProfile( int l, float coord ) {
	float x = clamp( coord, 0.0, 1.0 ) * ${glslFloat(STOP_COUNT - 1)};
	int i = min( int( floor( x ) ), ${STOP_COUNT - 2} );
	float f = x - float( i );
	float f2 = f * f;
	float f3 = f2 * f;
	float g = 1.0 - f;
	return (
		g * g * g * hkSwellControl( l, i - 1 ) +
		( 3.0 * f3 - 6.0 * f2 + 4.0 ) * hkSwellControl( l, i ) +
		( -3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0 ) * hkSwellControl( l, i + 1 ) +
		f3 * hkSwellControl( l, i + 2 )
	) / 6.0;
}
// Stretch marks: striaMark in src/surface/striae.ts, in typical widths. Two fractions from a
// cell's stream.
vec2 hkStriaRandom( ivec2 c, int salt ) {
	uvec2 h = hkRidgeHash( uvec2( uint( c.x + 32768 ), uint( c.y * ${STRIA_SALTS} + salt + 32768 ) ) );
	return vec2( h ) * 2.3283064365386963e-10;
}
float hkStriaRamp( float x, float threshold, float r ) {
	return clamp( ( x - threshold ) / r, 0.0, 1.0 );
}
float hkStriaRampMean( float x, float r ) {
	return x >= r ? x - r * 0.5 : max( x, 0.0 ) * max( x, 0.0 ) / ( 2.0 * r );
}
float hkStriaPatchShare( float u ) {
	return ${glslFloat(STRIA_PATCH_SHARE[0])} + ${glslFloat(STRIA_PATCH_SHARE[1])} * u;
}
// The share of a pixel fw wide, its centre across from a line half wide either side, the line covers.
float hkStriaCover( float across, float hw, float fw, float soft ) {
	if ( hw <= 0.0 ) return 0.0;
	float w = max( fw, soft );
	return max( 0.0, min( across + w * 0.5, hw ) - max( across - w * 0.5, - hw ) ) / w;
}
// Whether there is a mark at q (typical widths), 0 to 1, for marks square to theta, edges no
// sharper than soft.
float hkStriae( vec2 q, float theta, float amount, float fw, float soft ) {
	float a = clamp( amount, 0.0, 1.0 );
	ivec2 i0 = ivec2( floor( q / ${glslFloat(STRIA_CELL)} ) );
	float best = 0.0;
	for ( int j = -1; j <= 1; j ++ )
		for ( int i = -1; i <= 1; i ++ ) {
			ivec2 c = i0 + ivec2( i, j );
			vec2 h01 = hkStriaRandom( c, 0 );
			vec2 h23 = hkStriaRandom( c, 1 );
			vec2 h45 = hkStriaRandom( c, 2 );
			float patchU = hkStriaRandom( ivec2( floor( vec2( c ) / ${glslFloat(STRIA_PATCH)} ) ), 3 ).x;
			float shown = hkStriaRamp( a * hkStriaPatchShare( patchU ), h01.x, ${glslFloat(STRIA_CLUSTER_RAMP)} );
			if ( shown <= 0.0 ) continue;
			vec2 d = q - ( vec2( c ) + vec2( h01.y, h23.x ) ) * ${glslFloat(STRIA_CELL)};
			float turn = theta + ( 2.0 * h23.y - 1.0 ) * ${glslFloat(STRIA_CLUSTER_TURN)};
			vec2 n = vec2( cos( turn ), sin( turn ) );
			float across = dot( d, n );
			float along = - d.x * n.y + d.y * n.x;
			float clusterWidth = ${glslFloat(STRIA_CLUSTER_WIDTH[0])} + ${glslFloat(STRIA_CLUSTER_WIDTH[1] - STRIA_CLUSTER_WIDTH[0])} * h45.x * h45.x;
			float len = ${glslFloat(STRIA_CLUSTER_LENGTH[0])} + ${glslFloat(STRIA_CLUSTER_LENGTH[1] - STRIA_CLUSTER_LENGTH[0])} * h45.y;
			float spacing = ${glslFloat(STRIA_CLUSTER_SPACING[0])} + ${glslFloat(STRIA_CLUSTER_SPACING[1] - STRIA_CLUSTER_SPACING[0])} * hkStriaRandom( c, 4 ).x;
			int near = int( floor( across / spacing + ${glslFloat((STRIA_MARKS - 1) / 2)} + 0.5 ) );
			for ( int k = max( 0, near - 2 ); k <= min( ${STRIA_MARKS - 1}, near + 2 ); k ++ ) {
				vec2 m01 = hkStriaRandom( c, 8 + k );
				vec2 m23 = hkStriaRandom( c, 24 + k );
				if ( m01.x >= ${glslFloat(STRIA_MARK_SHARE)} ) continue;
				float markLength = len * ( 0.5 + 0.7 * m23.x );
				float t = 2.0 * ( along - ( m23.y - 0.5 ) * 0.3 * len ) / markLength;
				if ( t <= -1.0 || t >= 1.0 ) continue;
				vec2 m45 = hkStriaRandom( c, 40 + k );
				float phase = 6.28318530718 * along / ${glslFloat(STRIA_MEANDER[1])};
				float wave = sin( phase + 6.28318530718 * m45.x );
				float swell = 1.0 + ${glslFloat(STRIA_MEANDER[2])} * sin( phase + 6.28318530718 * m45.y );
				float t2 = t * t;
				float hw = 0.5 * clusterWidth * ( 0.6 + 0.4 * m01.y ) * ( 1.0 - t2 * t2 ) * swell;
				float axis = ( float( k ) - ${glslFloat((STRIA_MARKS - 1) / 2)} ) * spacing + ( m01.y - 0.5 ) * 0.7 * spacing + ( m23.y - 0.5 ) * 0.6 * ( 1.0 - t2 ) + ${glslFloat(STRIA_MEANDER[0])} * wave;
				best = max( best, shown * hkStriaCover( across - axis, hw, fw, soft ) );
			}
		}
	return best;
}
// The share of the skin the marks cover at an amount, on average (striaeMeanCover).
float hkStriaeMean( float amount ) {
	float a = clamp( amount, 0.0, 1.0 );
	float clusters = 0.0;
	for ( int q = 0; q < ${STRIAE_MEAN_SAMPLES}; q ++ )
		clusters += hkStriaRampMean( a * hkStriaPatchShare( ( float( q ) + 0.5 ) / ${glslFloat(STRIAE_MEAN_SAMPLES)} ), ${glslFloat(STRIA_CLUSTER_RAMP)} );
	clusters /= ${glslFloat(STRIAE_MEAN_SAMPLES)};
	return clusters * ${glslFloat(STRIA_MARKS * STRIA_MARK_SHARE * STRIA_MARK_AREA)};
}
// The stretch marks' weight at this pixel, 0 to 1, times the layer's strength: the mask scales the
// amount, so the sites' density follows it, and fades the marks at the sites' edges. The colour (striaeWeight) shows the marks where a pixel
// resolves them and their mean cover where it does not; the relief shows only the marks, with softer
// edges, and fades out sooner.
float hkStriaeWeight( int l, vec4 head, vec2 f, vec2 uv, bool relief ) {
	vec2 p = uv * vHkUvScale;
	float fw = length( fwidth( p ) ) / head.w;
	float amount = texture( hkLayerStops, vec2( 2.5 / ${glslFloat(STOP_TABLE_WIDTH)}, ( float( l ) + 0.5 ) / ${glslFloat(count)} ) ).r * f.x;
	if ( amount <= 0.0 || head.x <= 0.0 ) return 0.0;
	float edge = head.x * smoothstep( 0.0, ${glslFloat(STRIA_MASK_EDGE)}, f.x );
	float detail = relief
		? 1.0 - smoothstep( ${glslFloat(STRIAE_RELIEF_FADE[0])}, ${glslFloat(STRIAE_RELIEF_FADE[1])}, fw )
		: 1.0 - smoothstep( ${glslFloat(STRIAE_DETAIL_FADE[0])}, ${glslFloat(STRIAE_DETAIL_FADE[1])}, fw );
	float mean = relief ? 0.0 : hkStriaeMean( amount );
	if ( detail <= 0.0 ) return edge * mean;
	float theta = f.y * 3.14159265359 + ${glslFloat(STRIAE_ORIENTATION_SEAM)};
	float soft = relief ? ${glslFloat(STRIA_RELIEF_SOFT)} : ${glslFloat(STRIA_SOFT)};
	return edge * mix( mean, hkStriae( p / head.w, theta, amount, fw, soft ), detail );
}
vec3 hkApplyLayers( vec3 c, vec2 uv ) {
	for ( int l = 0; l < ${count}; l ++ ) {
		vec4 head = hkHeader( l );
		int kind = hkKind( head );
		if ( kind > 1 && kind != 9 ) continue;
		vec2 f = hkFields( l, uv );
		if ( kind == 9 ) {
			// Stretch marks: the skin where there is a mark is multiplied by the layer's colour ratio.
			vec3 ratio = texture( hkLayerStops, vec2( 1.5 / ${glslFloat(STOP_TABLE_WIDTH)}, ( float( l ) + 0.5 ) / ${glslFloat(count)} ) ).rgb;
			c = mix( c, c * ratio, hkStriaeWeight( l, head, f, uv, false ) );
			continue;
		}
		float u = ( 1.5 + clamp( f.y, 0.0, 1.0 ) * ${glslFloat(STOP_COUNT - 1)} ) / ${glslFloat(STOP_TABLE_WIDTH)};
		vec3 stop = texture( hkLayerStops, vec2( u, ( float( l ) + 0.5 ) / ${glslFloat(count)} ) ).rgb;
		vec3 target = kind == 1 ? c * stop : stop;
		c = mix( c, target, f.x * head.x );
	}
	return c;
}
// The detail layers' relief at this pixel, metres. Relief finer than a pixel
// fades out rather than aliasing.
float hkDetailHeight( vec2 uv ) {
	float H = 0.0;
	for ( int l = 0; l < ${count}; l ++ ) {
		vec4 head = hkHeader( l );
		int kind = hkKind( head );
		if ( kind <= 1 ) {
			// A colour layer's line that also shades: its stops' depths (their alpha, the layer's
			// deepest in the header) along the exact coordinate, so the normal is tilted by the
			// gradient across the line, per pixel, and the line is lit on one side and shadowed
			// on the other at any tone. Smoothed so it has no kink to catch the light.
			if ( head.x <= 0.0 || head.z <= 0.0 ) continue;
			vec2 g = hkFields( l, uv );
			float u = ( 1.5 + clamp( g.y, 0.0, 1.0 ) * ${glslFloat(STOP_COUNT - 1)} ) / ${glslFloat(STOP_TABLE_WIDTH)};
			float depth = texture( hkLayerStops, vec2( u, ( float( l ) + 0.5 ) / ${glslFloat(count)} ) ).a;
			float s = clamp( depth / head.z, 0.0, 1.0 );
			// A line is a period of two stops of the coordinate: gone by the time that is ten pixels.
			float lineFade = hkFootprintFade( fwidth( g.y ) * ${glslFloat((STOP_COUNT - 1) / 2)} );
			H -= g.x * head.x * head.z * lineFade * s * s * ( 3.0 - 2.0 * s );
			continue;
		}
		if ( kind != 2 && kind != 3 && kind != 5 && kind != 7 && kind != 8 && kind != 9 && kind != 10 ) continue;
		// A layer at no strength (a joint that is not bent) adds nothing: skip its field fetch.
		if ( head.x <= 0.0 ) continue;
		vec2 f = hkFields( l, uv );
		float a = f.x * head.x;
		if ( kind == 10 ) {
			// A swell: the smooth cross-section, faded by the smootherstep of the mask per pixel, so
			// it leaves the skin with no outline where the mask ends (swellHeight in layers.ts).
			H += head.x * head.z * hkSmootherstep( f.x ) * hkSwellProfile( l, f.y );
		} else if ( kind == 9 ) {
			// A stretch mark is a shallow atrophic dip: depth is the layer's height.
			H -= head.z * hkStriaeWeight( l, head, f, uv, true );
		} else if ( kind == 2 || kind == 7 || kind == 8 ) {
			vec2 p = uv * vHkUvScale / head.w;
			float fade = 1.0 - smoothstep( 0.25, 0.75, length( fwidth( p ) ) );
			if ( kind == 2 ) {
				H += a * head.z * fade * hkBumps( p );
			} else {
				// The amplitude profile along the coordinate, read from the stops' red channel.
				float u = ( 1.5 + clamp( f.y, 0.0, 1.0 ) * ${glslFloat(STOP_COUNT - 1)} ) / ${glslFloat(STOP_TABLE_WIDTH)};
				float profile = texture( hkLayerStops, vec2( u, ( float( l ) + 0.5 ) / ${glslFloat(count)} ) ).r;
				if ( kind == 7 ) H += a * profile * head.z * fade * hkBumps( p );
				else {
					// The coordinate no bump's centre lies past (stop 0, green).
					float limit = texture( hkLayerStops, vec2( 1.5 / ${glslFloat(STOP_TABLE_WIDTH)}, ( float( l ) + 0.5 ) / ${glslFloat(count)} ) ).g;
					H += f.x * head.x * head.z * fade * hkTubercles( p, l, uv, head.w / vHkUvScale, limit );
				}
			}
		} else if ( kind == 5 ) {
			vec2 p = uv * vHkUvScale;
			// Ridges within a pixel of one another blur to a flat; fade them out before they alias.
			float fade = hkFootprintFade( length( fwidth( p ) ) / head.w );
			// The derivatives above are taken in uniform flow; only the pattern is skipped off the ridged skin.
			if ( a > 0.002 && fade > 0.0 ) {
				float theta = f.y * 3.14159265359 + ${glslFloat(RIDGE_ORIENTATION_SEAM)};
				H += a * head.z * fade * ( hkRidges( p, theta, head.w ) - 0.5 );
			}
		} else {
			float phase = f.y * head.w;
			// A groove is a thin line: it goes by the time a period is ten pixels, not one, or
			// seen end-on down a limb it shows as a dotted ring.
			float fade = hkFootprintFade( fwidth( phase ) );
			H -= a * head.z * fade * pow( 0.5 * ( 1.0 - cos( 6.28318530718 * phase ) ), ${glslFloat(CREASE_SHARPNESS)} );
		}
	}
	return H + hkStrandHeight;
}
// Tilts the normal by the gradient of a height field (metres) across the
// surface (Mikkelsen's surface gradient, unnormalised so relief keeps its size).
vec3 hkPerturbNormal( vec3 n, float h, vec3 position, float faceDirection ) {
	vec3 sx = dFdx( position );
	vec3 sy = dFdy( position );
	vec3 r1 = cross( sy, n );
	vec3 r2 = cross( n, sx );
	float det = dot( sx, r1 ) * faceDirection;
	vec3 grad = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
	return normalize( abs( det ) * n - grad );
}`;

/**
 * Scatter functions, defined before three's lighting code uses them: the
 * shader form of `src/surface/scatter.ts`, which the sphere parity test checks
 * it against.
 */
const SCATTER_FUNCTIONS = `
uniform float hkScatterMfp;
uniform float hkScatterSlope;
uniform float hkPigmentDepth;
uniform vec3 hkSubstrate;
varying float vHkCurvature;
// Chiang, Kutz & Burley 2016, Eq. 1: surface albedo -> single-scattering albedo.
vec3 hkSingleScatterAlbedo( vec3 A ) {
	return 1.0 - exp( -5.09406 * A + 2.61188 * A * A - 4.31805 * A * A * A );
}
// Christensen & Burley 2015, Eq. 6 (diffuse surface transmission).
vec3 hkProfileScale( vec3 A ) {
	vec3 t = A - 0.8;
	return 1.9 - A + 3.5 * t * t;
}
// Per-channel Burley profile width, in metres.
vec3 hkScatterDistance( vec3 albedo ) {
	vec3 A = clamp( albedo, vec3( 0.001 ), vec3( 0.999 ) );
	// Pigment above the scattering layer: scatter as the unpigmented substrate does.
	A = pow( A, vec3( 1.0 - hkPigmentDepth ) ) * pow( clamp( hkSubstrate, vec3( 0.001 ), vec3( 0.999 ) ), vec3( hkPigmentDepth ) );
	// Representative wavelengths 612, 549, 465 nm relative to 550 nm.
	vec3 ls = hkScatterMfp * pow( vec3( ${WAVELENGTH_RATIO.map((r) => r.toFixed(6)).join(", ")} ), vec3( hkScatterSlope ) );
	return hkSingleScatterAlbedo( A ) * ls / hkProfileScale( A );
}
// Penner's pre-integrated diffusion of Burley's profile over a sphere, for profile
// width x in sphere radii: Lambert plus the tabulated residual (SCATTER_TABLE),
// sampled between texel centres exactly as scatterTableDiffuse does.
uniform sampler2D hkScatterTable;
float hkPreintegrated( float nDotL, float x ) {
	float u = max( x, 0.0 ) / ( max( x, 0.0 ) + ${glslFloat(SCATTER_TABLE.knee)} );
	vec2 uv = vec2(
		( ( clamp( nDotL, -1.0, 1.0 ) * 0.5 + 0.5 ) * ${glslFloat(SCATTER_TABLE.cosSteps - 1)} + 0.5 ) / ${glslFloat(SCATTER_TABLE.cosSteps)},
		( u * ${glslFloat(SCATTER_TABLE.uSteps - 1)} + 0.5 ) / ${glslFloat(SCATTER_TABLE.uSteps)}
	);
	return max( nDotL, 0.0 ) + texture2D( hkScatterTable, uv ).r;
}
`;

/**
 * Body art (`bakeBodyArt`, src/bodyArt/), under `HK_BODY_ART` only, after the
 * layer stack and before scattering: the marks page's melanin and haemoglobin
 * multiply the skin by this tone's ratios raised to them (`markedAlbedo`), and
 * the ink (the ink page's dermal pigment with the tattoos' decals over it,
 * `hkDecals`), seen through this skin (`inkSeen`), mixes in by its coverage,
 * as ink lies in the dermis. Naevi, decals too, add to the melanin and the
 * raise. A scar's smoothness and raise (`hkMarkSurface`) go to the roughness
 * and the relief; they are 0 without body art.
 */
const BODY_ART_FUNCTIONS = `
vec2 hkMarkSurface = vec2( 0.0 );
#ifdef HK_BODY_ART
uniform sampler2DArray hkBodyArt;
uniform vec3 hkInkThrough;
uniform vec3 hkInkVeil;
uniform vec3 hkInkKeep;
uniform vec3 hkMarkLight;
uniform vec3 hkMarkDark[ ${MARK_DARK_STEPS} ];
uniform vec3 hkMarkBlood;
uniform vec3 hkMarkSkin;
uniform vec3 hkMarkLip;
uniform vec3 hkMarkLipLight;
vec3 hkSrgbToLinear( vec3 c ) {
	return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
}
// Melanin added, 0 to 1: the ratio table along the measured tone axis (its
// steps at squares), interpolated.
vec3 hkMarkDarkRatio( float up ) {
	float x = sqrt( clamp( up, 0.0, 1.0 ) ) * ${glslFloat(MARK_DARK_STEPS - 1)};
	int i = min( int( x ), ${MARK_DARK_STEPS - 2} );
	return mix( hkMarkDark[ i ], hkMarkDark[ i + 1 ], x - float( i ) );
}
${DECAL_FUNCTIONS}
vec3 hkApplyBodyArt( vec3 c, vec2 uv ) {
	// The nail plate is not skin: no mark or ink acts on it.
	#ifdef HK_NAIL_PLATE
		float skin = 1.0 - clamp( hkFields( HK_NAIL_PLATE, uv ).x, 0.0, 1.0 );
	#else
		float skin = 1.0;
	#endif
	vec4 mark = texture( hkBodyArt, vec3( uv, 1.0 ) );
	float melanin = ( mark.r * 255.0 - ${MARK_NEUTRAL.toFixed(1)} ) / 127.0;
	vec2 surface = mark.ba;
	vec4 pigment = texture( hkBodyArt, vec3( uv, 0.0 ) );
	vec4 ink = vec4( hkSrgbToLinear( pigment.rgb ) * pigment.a, pigment.a );
	// The decals: tattoos over the dermal pigment, naevi into the marks.
	#ifdef HK_DECAL_LAYERS
		hkDecals( uv, ink, melanin, surface );
	#endif
	melanin *= skin;
	hkMarkSurface = surface * skin;
	// Where the lips' layer mixes in (at its mask times its strength), vitiligo
	// takes the skin and the lip each to its own depigmented colour.
	#ifdef HK_LIPS
		float lip = clamp( hkFields( HK_LIPS, uv ).x, 0.0, 1.0 ) * hkHeader( HK_LIPS ).x;
		vec3 light = mix( hkMarkSkin * hkMarkLight, hkMarkLip * hkMarkLipLight, lip ) / max( mix( hkMarkSkin, hkMarkLip, lip ), vec3( 1e-4 ) );
	#else
		vec3 light = hkMarkLight;
	#endif
	c *= pow( light, vec3( max( - melanin, 0.0 ) ) ) * hkMarkDarkRatio( melanin ) * pow( hkMarkBlood, vec3( mark.g * skin ) );
	vec3 colour = ink.a > 0.0 ? ink.rgb / ink.a : vec3( 0.0 );
	return mix( c, hkInkThrough * ( hkInkVeil + hkInkKeep * colour ), ink.a * skin );
}
#endif
`;

/**
 * Which of `layers` body art treats apart: the nail plate's (`NAIL_GLOSS_LAYER`,
 * whose mask is the plate), which it leaves alone, and the lips'
 * (`LIPS_LAYER`), which vitiligo pales to a depigmented lip.
 */
function bodyArtLayerDefines(layers: readonly SkinLayer[]): string {
  const nail = layers.findIndex((layer) => layer.id === NAIL_GLOSS_LAYER.id);
  const lips = layers.findIndex((layer) => layer.id === LIPS_LAYER.id);
  return `${nail < 0 ? "" : `#define HK_NAIL_PLATE ${nail}\n`}${lips < 0 ? "" : `#define HK_LIPS ${lips}\n`}`;
}

const BODY_ART_COLOUR = `
	#ifdef HK_BODY_ART
		diffuseColor.rgb = hkApplyBodyArt( diffuseColor.rgb, vHkUv );
	#endif`;

const SUBSURFACE_DIFFUSE = `
	// humanoid-kit: scatter dims the lit side and carries light past the terminator,
	// each channel by its own profile width times the surface's curvature.
	float hkNdotL = dot( geometryNormal, directLight.direction );
	vec3 hkX = hkScatterDistance( material.diffuseContribution ) * vHkCurvature;
	vec3 hkDiffuse = vec3( hkPreintegrated( hkNdotL, hkX.r ), hkPreintegrated( hkNdotL, hkX.g ), hkPreintegrated( hkNdotL, hkX.b ) );
	// The light the sheen layer reflects is not available below it, as in three's own line.
	#ifdef USE_SHEEN
		vec3 hkLight = directLight.color * sheenEnergyComp;
	#else
		vec3 hkLight = directLight.color;
	#endif
	reflectedLight.directDiffuse += hkDiffuse * hkLight * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
`;

let scatterTexture: DataTexture | null = null;

/** The pre-integrated scatter table as a single-channel half-float texture, built once. */
function scatterTableTexture(): DataTexture {
  if (scatterTexture) return scatterTexture;
  const bytes = Uint8Array.from(atob(SCATTER_TABLE.data), (ch) => ch.charCodeAt(0));
  scatterTexture = new DataTexture(
    new Uint16Array(bytes.buffer),
    SCATTER_TABLE.cosSteps,
    SCATTER_TABLE.uSteps,
    RedFormat,
    HalfFloatType,
  );
  scatterTexture.magFilter = LinearFilter;
  scatterTexture.minFilter = LinearFilter;
  scatterTexture.wrapS = ClampToEdgeWrapping;
  scatterTexture.wrapT = ClampToEdgeWrapping;
  scatterTexture.generateMipmaps = false;
  scatterTexture.colorSpace = NoColorSpace;
  scatterTexture.needsUpdate = true;
  return scatterTexture;
}

let poreTexture: DataTexture | null = null;

/** A tiling normal map of fine skin pores and creases, generated once. */
function poreNormalMap(): DataTexture {
  if (poreTexture) return poreTexture;
  const size = 256;
  const h = new Float32Array(size * size);
  // Sum of a few octaves of tiling value noise built from a seeded hash.
  const hash = (x: number, y: number, s: number) => {
    let n = (((x % s) + s) % s) * 374761393 + (((y % s) + s) % s) * 668265263 + s * 2147483647;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  for (const [cells, amp] of [
    [64, 0.55],
    [128, 0.3],
    [32, 0.15],
  ] as const) {
    const step = size / cells;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = x / step;
        const gy = y / step;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const a = hash(x0, y0, cells);
        const b = hash(x0 + 1, y0, cells);
        const c = hash(x0, y0 + 1, cells);
        const d = hash(x0 + 1, y0 + 1, cells);
        const i = y * size + x;
        h[i] =
          (h[i] as number) + amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (xx: number, yy: number) =>
        h[(((yy + size) % size) * size + ((xx + size) % size)) as number] as number;
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const n = new Vector3(-dx * 2.2, -dy * 2.2, 1).normalize();
      const o = (y * size + x) * 4;
      data[o] = Math.round((n.x * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  poreTexture = new DataTexture(data, size, size, RGBAFormat);
  poreTexture.wrapS = RepeatWrapping;
  poreTexture.wrapT = RepeatWrapping;
  poreTexture.repeat.set(48, 48);
  poreTexture.colorSpace = LinearSRGBColorSpace;
  poreTexture.generateMipmaps = true;
  poreTexture.needsUpdate = true;
  return poreTexture;
}

function stopTexture(layerCount: number): DataTexture {
  const t = new DataTexture(
    new Uint16Array(layerCount * STOP_TABLE_WIDTH * 4),
    STOP_TABLE_WIDTH,
    layerCount,
    RGBAFormat,
    HalfFloatType,
  );
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.colorSpace = NoColorSpace;
  t.generateMipmaps = false;
  return t;
}

/** One owner texture that owns nothing, shared by every material without its atlas. */
let noOwnersTexture: Texture | undefined;
function noOwners(): Texture {
  noOwnersTexture ??= emptyOwners();
  return noOwnersTexture;
}

/** Writes each layer's channels, owner map and id from the plan into the shader's table. */
function setChannels(table: Vector4[], plan: AtlasPlan): void {
  for (let l = 0; l < plan.value.length; l++)
    table[l]?.set(
      plan.value[l] as number,
      plan.coord[l] as number,
      plan.owner[l] as number,
      plan.ownerId[l] as number,
    );
}

/** One all-zero atlas per page count, shared by every material without its atlas. */
const noLayers = new Map<number, Texture>();
function noLayersFor(pages: number): Texture {
  let t = noLayers.get(pages);
  if (!t) {
    t = emptyLayerAtlas(pages);
    noLayers.set(pages, t);
  }
  return t;
}

export class SkinMaterial extends MeshPhysicalMaterial {
  /** The layer stack this material applies; its atlas must be built from the same list. */
  readonly layers: readonly SkinLayer[];
  readonly hkUniforms: {
    /** Scattering mean free path, metres; 0 disables scatter. */
    hkScatterMfp: { value: number };
    /** How much further red scatters than blue (spectral slope). */
    hkScatterSlope: { value: number };
    /** 0 = pigment mixed through the medium; 1 = all pigment above an unpigmented layer. */
    hkPigmentDepth: { value: number };
    /** The unpigmented layer's albedo (linear), used when pigment depth > 0. */
    hkSubstrate: { value: Vector3 };
    hkScatterTable: { value: DataTexture };
    /** The shared field atlas (`buildLayerAtlas`); all zero (no layers) until set. */
    hkLayerAtlas: { value: Texture };
    /** The atlas's owner maps (`SkinLayerAtlas.owners`). */
    hkLayerOwners: { value: Texture };
    /** This figure's stop table (`paintStopTable`). */
    hkLayerStops: { value: DataTexture };
    /** The hair's albedo (linear), a little of which the stubble tone takes. */
    hkScalpColour: { value: Vector3 };
    /** 0 without hair on the figure, else `SCALP_STRENGTH`. */
    hkScalpStrength: { value: number };
    /** Per layer, its atlas channels, owner map and id in it (the atlas's plan). */
    hkChannel: { value: Vector4[] };
    /** The figure's body-art texture (`bakeBodyArt`); read only while one is set (`setBodyArt`). */
    hkBodyArt: { value: Texture | null };
    /** Its tattoos' decals (`TattooDecals`); read only while it has some. */
    hkDecalCoordinates: { value: Texture | null };
    hkDecalImages: { value: Texture | null };
    hkDecalTable: { value: Texture | null };
    /** How ink looks through this figure's skin (`inkOptics`). */
    hkInkThrough: { value: Vector3 };
    hkInkVeil: { value: Vector3 };
    hkInkKeep: { value: Vector3 };
    /** What marks multiply this skin by (`markRatios`). */
    hkMarkLight: { value: Vector3 };
    hkMarkDark: { value: Vector3[] };
    hkMarkBlood: { value: Vector3 };
    /** The skin's and the lips' albedo, and a depigmented lip's over the lip's (`markRatios`). */
    hkMarkSkin: { value: Vector3 };
    hkMarkLip: { value: Vector3 };
    hkMarkLipLight: { value: Vector3 };
  };
  private readonly stopTable: Float32Array;
  private dualBones: DualBones | null = null;

  /**
   * Skins by `bones` (dual quaternions mixed with three's linear skinning,
   * `src/render/dualSkinning.ts`), or by three's alone when null. The shader is
   * rebuilt once, when the choice changes.
   */
  setDualBones(bones: DualBones | null): void {
    if (bones === this.dualBones) return;
    this.dualBones = bones;
    this.needsUpdate = true;
  }

  /**
   * The figure's occlusion key weights (`occlusionKeyWeights`); rest is (0, 0, 0).
   * It darkens the cavities of a body geometry that carries
   * `ModelTopology.body.occlusion` (`setBodyOcclusionAttributes`); any other
   * geometry is open.
   */
  occlusionKeys = new Vector3();

  /**
   * Tints the skin where the worn hair style grows (the geometry's `SCALP_ATTRIBUTE`)
   * toward this hair's albedo, so a hairline that thins out shows scalp rather than
   * bare skin. `null`: the figure wears no hair.
   */
  setScalp(hairAlbedo: Rgb | null): void {
    const u = this.hkUniforms;
    u.hkScalpStrength.value = hairAlbedo ? SCALP_STRENGTH : 0;
    if (hairAlbedo) u.hkScalpColour.value.set(hairAlbedo[0], hairAlbedo[1], hairAlbedo[2]);
  }

  /**
   * Uses the shared field atlas built for the body this material draws, with
   * its owner maps and the plan that lays the layers out in it; none draws no
   * layer. The atlas must be planned for this material's layers.
   */
  setLayerAtlas(atlas: SkinLayerAtlas | null): void {
    const plan = atlas?.plan ?? planAtlas(this.layers);
    if (plan.value.length !== this.layers.length)
      throw new RangeError(
        `SkinMaterial: an atlas planned for ${plan.value.length} layers, not ${this.layers.length}`,
      );
    this.hkUniforms.hkLayerAtlas.value = atlas?.texture ?? noLayersFor(plan.pages);
    this.hkUniforms.hkLayerOwners.value = atlas?.owners ?? noOwners();
    setChannels(this.hkUniforms.hkChannel.value, plan);
  }

  /** The decal layers of the figure's tattoos and naevi the shader is built for (0 without). */
  private decalLayers = 0;

  /**
   * Draws the figure's body art (`bakeBodyArt`), or none. The shader reads it
   * only while one is set, so a figure without body art pays nothing for it,
   * and reads decals only for the layers it has; a change in either rebuilds
   * the shader once, and replacing one bake with another like it does not.
   */
  setBodyArt(art: Pick<BodyArtTexture, "texture" | "decals"> | null): void {
    const u = this.hkUniforms;
    const had = [u.hkBodyArt.value !== null, this.decalLayers] as const;
    u.hkBodyArt.value = art?.texture ?? null;
    u.hkDecalCoordinates.value = art?.decals?.coordinates ?? null;
    u.hkDecalImages.value = art?.decals?.images ?? null;
    u.hkDecalTable.value = art?.decals?.table ?? null;
    this.decalLayers = art?.decals?.layers ?? 0;
    if (had[0] === (art !== null) && had[1] === this.decalLayers) return;
    const { HK_BODY_ART: _, HK_DECAL_LAYERS: __, ...rest } = this.defines ?? {};
    this.defines = {
      ...rest,
      ...(art && { HK_BODY_ART: "" }),
      ...(this.decalLayers && { HK_DECAL_LAYERS: String(this.decalLayers) }),
    };
    this.needsUpdate = true;
  }

  constructor(layers: readonly SkinLayer[] = SKIN_LAYERS) {
    super({
      // Measured skin: roughness ≈ 0.5 (Weyrich et al. 2006) and an index of
      // refraction of about 1.4 (F0 ≈ 0.028), the same at every skin tone.
      // three's default ior 1.5 would make the surface reflection ~45% too strong,
      // which reads as oily on deep skin, where less diffuse light competes with it.
      roughness: 0.52,
      metalness: 0,
      ior: 1.4,
      sheenRoughness: 0.8,
    });
    this.layers = layers;
    const plan = planAtlas(layers);
    this.stopTable = new Float32Array(layers.length * STOP_TABLE_WIDTH * 4);
    this.hkUniforms = {
      hkScatterMfp: { value: SKIN_SCATTER.mfp },
      hkScatterSlope: { value: SKIN_SCATTER.slope },
      hkPigmentDepth: { value: SKIN_SCATTER.pigmentDepth },
      hkSubstrate: { value: new Vector3(...(MELANIN_ANCHORS[0] as Rgb)) },
      hkScatterTable: { value: scatterTableTexture() },
      hkLayerAtlas: { value: noLayersFor(plan.pages) },
      hkLayerOwners: { value: noOwners() },
      hkLayerStops: { value: stopTexture(layers.length) },
      hkScalpColour: { value: new Vector3() },
      hkScalpStrength: { value: 0 },
      // A GLSL array has at least one element, so a stack with no layers still gets one.
      hkChannel: { value: Array.from({ length: Math.max(1, layers.length) }, () => new Vector4()) },
      hkBodyArt: { value: null },
      hkDecalCoordinates: { value: null },
      hkDecalImages: { value: null },
      hkDecalTable: { value: null },
      hkInkThrough: { value: new Vector3() },
      hkInkVeil: { value: new Vector3() },
      hkInkKeep: { value: new Vector3() },
      hkMarkLight: { value: new Vector3() },
      hkMarkDark: { value: Array.from({ length: MARK_DARK_STEPS }, () => new Vector3(1, 1, 1)) },
      hkMarkBlood: { value: new Vector3() },
      hkMarkSkin: { value: new Vector3(1, 1, 1) },
      hkMarkLip: { value: new Vector3(1, 1, 1) },
      hkMarkLipLight: { value: new Vector3(1, 1, 1) },
    };
    setChannels(this.hkUniforms.hkChannel.value, plan);
    this.normalMap = poreNormalMap();
    // Pores are felt in the highlights, not seen as texture: keep the relief faint.
    this.normalScale = new Vector2(0.06, 0.06);
    this.setAppearance(DEFAULT_SKIN_APPEARANCE);
  }

  setAppearance(a: SkinAppearance): void {
    const albedo = skinAlbedo(a.tone);
    this.color.setRGB(albedo[0], albedo[1], albedo[2], LinearSRGBColorSpace);
    // Natural skin keeps its melanin in the epidermis, above a dermis that scatters
    // much the same in everyone (fitted p = 0.75 over the lightest measured skin).
    // Any other colour is taken as pigment mixed through the medium (p = 0).
    this.hkUniforms.hkPigmentDepth.value = a.tone.override ? 0 : SKIN_SCATTER.pigmentDepth;
    // Vellus sheen takes the surface's own hue. A near-white sheen over dark
    // colours is the optical signature of dry, "ashy" skin, so it is tinted, and
    // reduced with luminance across the measured skin range.
    const peak = Math.max(albedo[0], albedo[1], albedo[2], 1e-6);
    this.sheenColor.setRGB(
      0.75 * (albedo[0] / peak) + 0.25,
      0.75 * (albedo[1] / peak) + 0.25,
      0.75 * (albedo[2] / peak) + 0.25,
      LinearSRGBColorSpace,
    );
    const y = luminance(albedo);
    const t = Math.min(1, Math.max(0, (y - 0.05) / (0.355 - 0.05)));
    this.sheen = 0.12 + 0.13 * t * t * (3 - 2 * t);
    const ink = inkOptics(a.tone);
    this.hkUniforms.hkInkThrough.value.fromArray(ink.through);
    this.hkUniforms.hkInkVeil.value.fromArray(ink.veil);
    this.hkUniforms.hkInkKeep.value.fromArray(ink.keep);
    const marks = markRatios(a.tone, a.lips);
    this.hkUniforms.hkMarkLight.value.fromArray(marks.light);
    marks.dark.forEach((r, i) => {
      this.hkUniforms.hkMarkDark.value[i]?.fromArray(r);
    });
    this.hkUniforms.hkMarkBlood.value.fromArray(marks.blood);
    this.hkUniforms.hkMarkSkin.value.fromArray(marks.skin);
    this.hkUniforms.hkMarkLip.value.fromArray(marks.lip);
    this.hkUniforms.hkMarkLipLight.value.fromArray(marks.lipLight);
    // Regional colour: each layer's paint from its own model (measured for lips),
    // blended in by the atlas's soft-edged masks.
    paintStopTable(this.layers, { ...a, signals: a.signals ?? {} }, this.stopTable);
    const stops = this.hkUniforms.hkLayerStops.value;
    const half = stops.image.data as Uint16Array;
    for (let i = 0; i < half.length; i++)
      half[i] = DataUtils.toHalfFloat(this.stopTable[i] as number);
    stops.needsUpdate = true;
  }

  override onBeforeCompile: MeshPhysicalMaterial["onBeforeCompile"] = (shader) => {
    Object.assign(shader.uniforms, this.hkUniforms);
    // The skin is the body's, whose geometry carries the hip fold's slots.
    if (this.dualBones) patchDualSkinning(shader, this.dualBones, true);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec2 vHkUv;\nattribute float ${UV_SCALE_ATTRIBUTE};\nvarying float vHkUvScale;\nattribute float ${SCALP_ATTRIBUTE};\nvarying float vHkScalp;`,
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>\n\tvHkUv = uv;\n\tvHkUvScale = ${UV_SCALE_ATTRIBUTE};\n\tvHkCurvature = ${CURVATURE_ATTRIBUTE};\n\tvHkScalp = ${SCALP_ATTRIBUTE};`,
      )
      .replace(
        "#include <common>",
        `#include <common>\nattribute float ${CURVATURE_ATTRIBUTE};\nvarying float vHkCurvature;\nvarying vec3 vHkFlow;`,
      )
      // The hair flow: the bind pose's downward direction, skinned like a normal.
      .replace(
        "#include <skinnormal_vertex>",
        "#include <skinnormal_vertex>\n\tvec3 hkFlow = vec3( 0.0, - 1.0, 0.0 );\n\t#ifdef USE_SKINNING\n\t\thkFlow = ( skinMatrix * vec4( hkFlow, 0.0 ) ).xyz;\n\t#endif\n\tvHkFlow = normalize( ( modelViewMatrix * vec4( hkFlow, 0.0 ) ).xyz );",
      );
    for (const chunk of [
      "color_fragment",
      "roughnessmap_fragment",
      "normal_fragment_maps",
      "lights_physical_fragment",
    ])
      if (!shader.fragmentShader.includes(`#include <${chunk}>`))
        throw new Error(`SkinMaterial: three's ${chunk} chunk moved`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${layerFunctions(this.layers.length)}\n${SCATTER_FUNCTIONS}\n${bodyArtLayerDefines(this.layers)}${BODY_ART_FUNCTIONS}\nvarying float vHkScalp;\nuniform vec3 hkScalpColour;\nuniform float hkScalpStrength;`,
      )
      .replace(
        "#include <color_fragment>",
        // Hair lies over the skin's ink, so strands follow the body art.
        `#include <color_fragment>\n\tdiffuseColor.rgb = hkApplyLayers( diffuseColor.rgb, vHkUv );\n${BODY_ART_COLOUR}\n\tdiffuseColor.rgb = hkApplyStrands( diffuseColor.rgb, vHkUv );\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb * ${glslFloat(SCALP_SHADE)}, hkScalpColour, ${glslFloat(SCALP_HAIR_SHARE)} ), clamp( vHkScalp, 0.0, 1.0 ) * hkScalpStrength );`,
      )
      // Surface layers: roughness here, specular once the material is set up.
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\n\tvec2 hkSurface = hkSurfaceChange( vHkUv );\n\troughnessFactor = clamp( roughnessFactor + hkSurface.x - ${glslFloat(SCAR_SMOOTHNESS)} * hkMarkSurface.x, 0.03, 1.0 );`,
      )
      // Detail layers: relief on top of the pore map.
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\n\tnormal = hkPerturbNormal( normal, hkDetailHeight( vHkUv ) + ${glslFloat(SCAR_RAISE)} * hkMarkSurface.y, - vViewPosition, faceDirection );`,
      )
      .replace(
        "#include <lights_physical_fragment>",
        "#include <lights_physical_fragment>\n\tmaterial.specularColor *= max( 0.0, 1.0 + hkSurface.y );\n\tmaterial.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );",
      );
    // Includes are resolved after this hook, so inline the physical lighting chunk with
    // its direct diffuse term replaced. Fail loudly if three changes that line.
    const lighting = ShaderChunk.lights_physical_pars_fragment;
    if (!lighting.includes(DIRECT_DIFFUSE))
      throw new Error("SkinMaterial: three's direct diffuse line changed");
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_pars_fragment>",
      lighting.replace(DIRECT_DIFFUSE, SUBSURFACE_DIFFUSE),
    );
    // The body's cavities (mouth, nostrils, ear canals, eye sockets), by pose.
    patchOcclusion(shader, this.occlusionKeys, {
      floor: BODY_OCCLUSION_FLOOR,
      power: BODY_OCCLUSION_POWER,
      body: true,
    });
  };

  override customProgramCacheKey(): string {
    // The shader depends on the layer count only; the layers' colour is in the stop table.
    const art = this.hkUniforms.hkBodyArt.value ? `-art${this.decalLayers}` : "";
    return `humanoid-kit-skin-11-${this.layers.length}${this.dualBones ? `-${DUAL_SKINNING_KEY}-fold` : ""}${art}`;
  }
}
