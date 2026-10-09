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
import { type AtlasPlan, OWNER_GRID, planAtlas } from "../surface/atlasPlan.ts";
import {
  CREASE_SHARPNESS,
  paintStopTable,
  type SkinLayer,
  type SkinPaintInput,
  STOP_COUNT,
  STOP_TABLE_WIDTH,
} from "../surface/layers.ts";
import { SKIN_LAYERS } from "../surface/regions/index.ts";
import { SKIN_SCATTER, WAVELENGTH_RATIO } from "../surface/scatter.ts";
import { SCATTER_TABLE } from "../surface/scatterTable.ts";
import { luminance, MELANIN_ANCHORS, type Rgb, skinAlbedo } from "../surface/skinTone.ts";
import { DUAL_SKINNING_KEY, type DualBones, patchDualSkinning } from "./dualSkinning.ts";
import { emptyLayerAtlas, emptyOwners, type SkinLayerAtlas } from "./layerAtlas.ts";
import { BODY_OCCLUSION_FLOOR, BODY_OCCLUSION_POWER, patchOcclusion } from "./occlusion.ts";

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

/** A GLSL float literal. */
const glslFloat = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** Name of the per-vertex attribute holding metres of skin per UV unit. */
export const UV_SCALE_ATTRIBUTE = "hkUvScale";

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
// Per layer, the atlas channels of its mask (x) and coordinate (y, -1: none), four to a page,
// and, for a layer that shares its channels, its owner map (z, -1: none) and its id in it (w).
uniform vec4 hkChannel[${Math.max(1, count)}];
vec4 hkPage( float c, vec2 uv ) { return texture( hkLayerAtlas, vec3( uv, floor( c * 0.25 ) ) ); }
float hkChannelOf( vec4 page, float c ) { return page[ int( c - 4.0 * floor( c * 0.25 ) + 0.5 ) ]; }
vec2 hkFields( int l, vec2 uv ) {
	vec4 ch = hkChannel[ l ];
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
vec3 hkApplyLayers( vec3 c, vec2 uv ) {
	for ( int l = 0; l < ${count}; l ++ ) {
		vec4 head = hkHeader( l );
		int kind = hkKind( head );
		if ( kind > 1 ) continue;
		vec2 f = hkFields( l, uv );
		float u = ( 1.5 + clamp( f.y, 0.0, 1.0 ) * ${glslFloat(STOP_COUNT - 1)} ) / ${glslFloat(STOP_TABLE_WIDTH)};
		vec3 stop = texture( hkLayerStops, vec2( u, ( float( l ) + 0.5 ) / ${glslFloat(count)} ) ).rgb;
		vec3 target = kind == 1 ? c * stop : stop;
		c = mix( c, target, f.x * head.x );
	}
	return c;
}
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
// The detail layers' relief at this pixel, metres. Relief finer than a pixel
// fades out rather than aliasing.
float hkDetailHeight( vec2 uv ) {
	float H = 0.0;
	for ( int l = 0; l < ${count}; l ++ ) {
		vec4 head = hkHeader( l );
		int kind = hkKind( head );
		if ( kind != 2 && kind != 3 ) continue;
		// A layer at no strength (a joint that is not bent) adds nothing: skip its field fetch.
		if ( head.x <= 0.0 ) continue;
		vec2 f = hkFields( l, uv );
		float a = f.x * head.x;
		if ( kind == 2 ) {
			vec2 p = uv * vHkUvScale / head.w;
			float fade = 1.0 - smoothstep( 0.25, 0.75, length( fwidth( p ) ) );
			H += a * head.z * fade * hkBumps( p );
		} else {
			float phase = f.y * head.w;
			float fade = 1.0 - smoothstep( 0.25, 0.75, fwidth( phase ) );
			H -= a * head.z * fade * pow( 0.5 * ( 1.0 - cos( 6.28318530718 * phase ) ), ${glslFloat(CREASE_SHARPNESS)} );
		}
	}
	return H;
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
    /** Per layer, its atlas channels, owner map and id in it (the atlas's plan). */
    hkChannel: { value: Vector4[] };
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
      // A GLSL array has at least one element, so a stack with no layers still gets one.
      hkChannel: { value: Array.from({ length: Math.max(1, layers.length) }, () => new Vector4()) },
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
    if (this.dualBones) patchDualSkinning(shader, this.dualBones);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec2 vHkUv;\nattribute float ${UV_SCALE_ATTRIBUTE};\nvarying float vHkUvScale;`,
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>\n\tvHkUv = uv;\n\tvHkUvScale = ${UV_SCALE_ATTRIBUTE};\n\tvHkCurvature = ${CURVATURE_ATTRIBUTE};`,
      )
      .replace(
        "#include <common>",
        `#include <common>\nattribute float ${CURVATURE_ATTRIBUTE};\nvarying float vHkCurvature;`,
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
        `#include <common>\n${layerFunctions(this.layers.length)}\n${SCATTER_FUNCTIONS}`,
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n\tdiffuseColor.rgb = hkApplyLayers( diffuseColor.rgb, vHkUv );",
      )
      // Surface layers: roughness here, specular once the material is set up.
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\n\tvec2 hkSurface = hkSurfaceChange( vHkUv );\n\troughnessFactor = clamp( roughnessFactor + hkSurface.x, 0.03, 1.0 );",
      )
      // Detail layers: relief on top of the pore map.
      .replace(
        "#include <normal_fragment_maps>",
        "#include <normal_fragment_maps>\n\tnormal = hkPerturbNormal( normal, hkDetailHeight( vHkUv ), - vViewPosition, faceDirection );",
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
    return `humanoid-kit-skin-8-${this.layers.length}${this.dualBones ? `-${DUAL_SKINNING_KEY}` : ""}`;
  }
}
