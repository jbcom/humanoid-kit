/**
 * A physically based skin material for humanoid-kit figures.
 *
 * It extends three's MeshPhysicalMaterial with:
 * - subsurface scattering, approximated by a per-channel wrapped diffuse term
 *   (red light travels furthest under skin, so terminators glow warm instead of
 *   cutting to grey);
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
import { type Rgb, type SkinTone, skinAlbedo } from "../surface/skinTone.ts";

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

const SUBSURFACE_DIFFUSE = `
	// humanoid-kit skin: per-channel wrapped diffuse approximates subsurface scattering.
	float hkNdotL = dot( geometryNormal, directLight.direction );
	vec3 hkWrapped = clamp( ( vec3( hkNdotL ) + hkScatter ) / ( 1.0 + hkScatter ), 0.0, 1.0 );
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
    hkScatter: { value: new Vector3(0.42, 0.2, 0.12) },
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
    const m = Math.min(1, Math.max(0, a.tone.melanin));
    // Melanin absorbs in the epidermis, so less light bleeds red through shadow
    // edges on deeper skin; a fixed red-heavy wrap turns deep terminators orange.
    this.hkUniforms.hkScatter.value.set(0.42 - 0.1 * m, 0.2 - 0.04 * m, 0.12 - 0.045 * m);
    // Vellus sheen takes the skin's own hue. A near-white sheen over deep skin is
    // the optical signature of dry, "ashy" skin, so it is tinted and reduced.
    const peak = Math.max(albedo[0], albedo[1], albedo[2], 1e-6);
    this.sheenColor.setRGB(
      0.75 * (albedo[0] / peak) + 0.25,
      0.75 * (albedo[1] / peak) + 0.25,
      0.75 * (albedo[2] / peak) + 0.25,
      LinearSRGBColorSpace,
    );
    this.sheen = 0.25 - 0.13 * m;
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
        `#include <color_vertex>\n\tvHkSkinMask = ${SKIN_MASK_ATTRIBUTE};`,
      );
    if (!shader.fragmentShader.includes("#include <color_fragment>"))
      throw new Error("SkinMaterial: three's color_fragment chunk moved");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vHkSkinMask;\nuniform vec3 hkScatter;\nuniform vec3 hkMaskStrength;\nuniform vec3 hkLipColor;\nuniform vec3 hkFlushTint;\nuniform vec3 hkAreolaColor;",
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
    return "humanoid-kit-skin-1";
  }
}
