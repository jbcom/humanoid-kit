/**
 * A garment's look on one figure: its own colour and finish over the pack's
 * material, without a second copy of the mesh (docs/ARCHITECTURE.md, "Garments
 * a consumer brings"). Pure; the renderer applies `garmentFinish` to the
 * garment's material and runs `wornAlbedo` per texel in its shader.
 */
import type { Rgb } from "../surface/skinTone.ts";

/** How one figure wears one garment. Every field is optional; none means the pack's material. */
export interface GarmentLook {
  /** Linear RGB multiplied into the pack's colour and texture, each ≥ 0. */
  tint?: Rgb;
  /** Overrides the material's roughness, in [0, 1]. */
  roughness?: number;
  /** How field-worn the garment is, in [0, 1]: faded, dusty and rougher. */
  wear?: number;
}

/**
 * The linear colour worn cloth fades toward: road dust over undyed wool
 * (CHOICE, a light warm grey-brown).
 */
export const GARMENT_DUST: Readonly<Rgb> = [0.42, 0.38, 0.32];

/**
 * How much of its chroma fully worn cloth loses (CHOICE). Faded indigo kersey
 * goes lighter and greyer but stays blue, so wear keeps the dye's hue: at 0.55
 * fade and 0.3 dust, fully worn navy came out warm grey-brown.
 */
const WEAR_FADE = 0.4;
/** How far fully worn cloth moves toward the dust (CHOICE, with `WEAR_FADE`). */
const WEAR_DUST = 0.2;
/** How much of the way to fully rough fully worn cloth goes (CHOICE). */
const WEAR_ROUGHEN = 0.5;

/** What a garment's material takes for a look. */
export interface GarmentFinish {
  /** The material's colour: the pack's, times the tint. Wear does not change it. */
  color: Rgb;
  roughness: number;
  /** How much of its chroma the cloth's albedo loses, in [0, 1]. */
  fade: number;
  /** How far the cloth's albedo moves toward `GARMENT_DUST`, in [0, 1]. */
  dust: number;
}

/**
 * The finish a garment's material takes for `look`. The tint multiplies the
 * colour, but wear acts on the albedo (texture × colour, `wornAlbedo`). A
 * multiplier pulled toward the dust can only darken the cloth, so worn
 * navy would draw darker than new navy.
 */
export function garmentFinish(
  base: Readonly<{ color: Readonly<Rgb>; roughness: number }>,
  look: GarmentLook | undefined,
): GarmentFinish {
  const color: Rgb = [base.color[0], base.color[1], base.color[2]];
  let roughness = base.roughness;
  const wear = look?.wear ?? 0;
  if (look?.tint)
    for (let i = 0; i < 3; i++) color[i] = (color[i] as number) * (look.tint[i] as number);
  roughness += (1 - roughness) * WEAR_ROUGHEN * wear;
  if (look?.roughness !== undefined) roughness = look.roughness;
  return { color, roughness, fade: WEAR_FADE * wear, dust: WEAR_DUST * wear };
}

/**
 * A texel's albedo (texture × the finish's colour) worn by `finish`: faded
 * toward its own Rec. 709 luminance, then moved toward the dust. The garment
 * shader runs the same arithmetic (`applyGarmentWear`).
 */
export function wornAlbedo(albedo: Readonly<Rgb>, finish: Readonly<GarmentFinish>): Rgb {
  const y = 0.2126 * albedo[0] + 0.7152 * albedo[1] + 0.0722 * albedo[2];
  const out: Rgb = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const a = albedo[i] as number;
    const faded = a + (y - a) * finish.fade;
    out[i] = faded + ((GARMENT_DUST[i] as number) - faded) * finish.dust;
  }
  return out;
}
