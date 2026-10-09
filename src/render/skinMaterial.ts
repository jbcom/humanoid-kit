/**
 * A physically based skin material for humanoid-kit figures.
 *
 * It extends three's MeshPhysicalMaterial with:
 * - subsurface scattering derived from the colour itself, so any colour (skin,
 *   fur, scales, fantasy) scatters plausibly with no per-colour tuning: each
 *   channel's scatter distance follows from its albedo (Chiang, Kutz & Burley
 *   2016; Christensen & Burley 2015), and how much light it carries round a
 *   curve follows from that distance and the surface's curvature through an
 *   energy-conserving wrap fitted to Penner-style pre-integration
 *   (docs/research/ALGORITHMIC-APPEARANCE.md §2);
 * - regional colour from the figure's skin masks (lips, flush, areola), carried
 *   as a vertex attribute so they follow every shape change;
 * - a fine tiling pore normal map and a low sheen for vellus hair.
 */
import {
  Color,
  DataTexture,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  RepeatWrapping,
  RGBAFormat,
  ShaderChunk,
  Vector2,
  Vector3,
} from "three";
import { SKIN_SCATTER, WAVELENGTH_RATIO } from "../surface/scatter.ts";
import {
  luminance,
  MELANIN_ANCHORS,
  type Rgb,
  type SkinTone,
  skinAlbedo,
} from "../surface/skinTone.ts";

export interface SkinAppearance {
  tone: SkinTone;
  /** 0..1: how much the cheeks, nose and ears flush. */
  flush: number;
  /** 0..1: lip colour depth relative to the surrounding skin. */
  lips: number;
  /** 0..1: areola and nipple colour depth. */
  areola: number;
}

export const DEFAULT_SKIN_APPEARANCE: Readonly<SkinAppearance> = {
  tone: { melanin: 0.35, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0.45,
  lips: 0.55,
  areola: 0.5,
};

/** Name of the vertex attribute carrying the three skin mask channels. */
export const SKIN_MASK_ATTRIBUTE = "hkSkinMask";

const DIRECT_DIFFUSE =
  "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );";

/** Name of the per-vertex curvature attribute (mean curvature magnitude, m⁻¹). */
export const CURVATURE_ATTRIBUTE = "hkCurvature";

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
// Energy-conserving wrap fitted to pre-integration of Burley's profile over a sphere.
vec3 hkWrapFromScatter( vec3 d, float curvature ) {
	vec3 y = pow( max( d * curvature, vec3( 0.0 ) ), vec3( 1.2997 ) );
	return 2.0246 * y / ( 1.0 + 1.3543 * y );
}
`;

const SUBSURFACE_DIFFUSE = `
	// humanoid-kit: scatter carries light round curves (McAuley's energy-conserving wrap).
	float hkNdotL = dot( geometryNormal, directLight.direction );
	vec3 hkW = hkWrapFromScatter( hkScatterDistance( material.diffuseContribution ), vHkCurvature );
	vec3 hkWrapped = max( vec3( hkNdotL ) + hkW, vec3( 0.0 ) ) / ( ( 1.0 + hkW ) * ( 1.0 + hkW ) );
	reflectedLight.directDiffuse += hkWrapped * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
`;

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

const mul = (a: Rgb, k: Rgb): Rgb => [a[0] * k[0], a[1] * k[1], a[2] * k[2]];

export class SkinMaterial extends MeshPhysicalMaterial {
  readonly hkUniforms = {
    /** Scattering mean free path, metres; 0 disables scatter. */
    hkScatterMfp: { value: SKIN_SCATTER.mfp as number },
    /** How much further red scatters than blue (spectral slope). */
    hkScatterSlope: { value: SKIN_SCATTER.slope as number },
    /** 0 = pigment mixed through the medium; 1 = all pigment above an unpigmented layer. */
    hkPigmentDepth: { value: SKIN_SCATTER.pigmentDepth as number },
    /** The unpigmented layer's albedo (linear), used when pigment depth > 0. */
    hkSubstrate: { value: new Vector3(...(MELANIN_ANCHORS[0] as Rgb)) },
    hkMaskStrength: { value: new Vector3(0.55, 0.45, 0) },
    hkLipColor: { value: new Color() },
    hkFlushTint: { value: new Color(1.1, 0.84, 0.84) },
    hkAreolaColor: { value: new Color() },
  };

  constructor() {
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
    const lip = mul(albedo, [0.74 - 0.2 * a.lips, 0.42 - 0.12 * a.lips, 0.44 - 0.1 * a.lips]);
    this.hkUniforms.hkLipColor.value.setRGB(lip[0], lip[1], lip[2], LinearSRGBColorSpace);
    const areola = mul(albedo, [
      0.62 - 0.22 * a.areola,
      0.44 - 0.18 * a.areola,
      0.42 - 0.16 * a.areola,
    ]);
    this.hkUniforms.hkAreolaColor.value.setRGB(
      areola[0],
      areola[1],
      areola[2],
      LinearSRGBColorSpace,
    );
    this.hkUniforms.hkMaskStrength.value.set(0.35 + 0.55 * a.lips, a.flush, 0.4 + 0.55 * a.areola);
  }

  override onBeforeCompile: MeshPhysicalMaterial["onBeforeCompile"] = (shader) => {
    Object.assign(shader.uniforms, this.hkUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute vec3 ${SKIN_MASK_ATTRIBUTE};\nvarying vec3 vHkSkinMask;`,
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>\n\tvHkSkinMask = ${SKIN_MASK_ATTRIBUTE};\n\tvHkCurvature = ${CURVATURE_ATTRIBUTE};`,
      )
      .replace(
        "#include <common>",
        `#include <common>\nattribute float ${CURVATURE_ATTRIBUTE};\nvarying float vHkCurvature;`,
      );
    if (!shader.fragmentShader.includes("#include <color_fragment>"))
      throw new Error("SkinMaterial: three's color_fragment chunk moved");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vHkSkinMask;\nuniform vec3 hkMaskStrength;\nuniform vec3 hkLipColor;\nuniform vec3 hkFlushTint;\nuniform vec3 hkAreolaColor;\n${SCATTER_FUNCTIONS}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
	vec3 hkM = vHkSkinMask * hkMaskStrength;
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * hkFlushTint, hkM.y );
	diffuseColor.rgb = mix( diffuseColor.rgb, hkLipColor, hkM.x );
	diffuseColor.rgb = mix( diffuseColor.rgb, hkAreolaColor, hkM.z );`,
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
  };

  override customProgramCacheKey(): string {
    return "humanoid-kit-skin-2";
  }
}
