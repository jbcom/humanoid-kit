/**
 * A garment's look on one figure: its own colour and finish over the pack's
 * material, without a second copy of the mesh (docs/ARCHITECTURE.md, "Garments
 * a consumer brings"). Pure; the renderer applies the result to the garment's
 * material.
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

/** How much of its chroma fully worn cloth loses (CHOICE). */
const WEAR_FADE = 0.55;
/** How far fully worn cloth moves toward the dust (CHOICE). */
const WEAR_DUST = 0.3;
/** How much of the way to fully rough fully worn cloth goes (CHOICE). */
const WEAR_ROUGHEN = 0.5;

export interface GarmentFinish {
  color: Rgb;
  roughness: number;
}

/** The colour and roughness a garment's material takes for `look`. */
export function garmentFinish(
  base: Readonly<{ color: Readonly<Rgb>; roughness: number }>,
  look: GarmentLook | undefined,
): GarmentFinish {
  const color: Rgb = [base.color[0], base.color[1], base.color[2]];
  let roughness = base.roughness;
  if (!look) return { color, roughness };
  if (look.tint)
    for (let i = 0; i < 3; i++) color[i] = (color[i] as number) * (look.tint[i] as number);
  const wear = look.wear ?? 0;
  if (wear > 0) {
    // Rec. 709 luminance of the linear colour: the grey it fades toward.
    const y = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
    const fade = WEAR_FADE * wear;
    const dust = WEAR_DUST * wear;
    for (let i = 0; i < 3; i++) {
      const faded = (color[i] as number) + (y - (color[i] as number)) * fade;
      color[i] = faded + ((GARMENT_DUST[i] as number) - faded) * dust;
    }
    roughness += (1 - roughness) * WEAR_ROUGHEN * wear;
  }
  if (look.roughness !== undefined) roughness = look.roughness;
  return { color, roughness };
}
