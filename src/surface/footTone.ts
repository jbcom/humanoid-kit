/**
 * The colour of the foot's own skin that is not the sole's: callus. The sole's
 * colour is the palm's (`palmAlbedo`, one owner for the palmoplantar colour:
 * src/surface/regions/hands/index.ts); callus is that colour with the thickened
 * keratin on it (docs/research/SKIN-STATES.md C6).
 */
import { type Lab, labFromLinear, linearFromLab } from "./cielab.ts";
import { palmAlbedo } from "./handTone.ts";
import { type Rgb, SKIN_F0, type SkinTone } from "./skinTone.ts";

/**
 * How callus differs from the sole it grows on, in CIELAB (L\*, a\*, b\*): paler
 * and yellower, with less red (thick keratin passes less of the blood's colour
 * and scatters more). A CHOICE: no colorimetry of callus was found (C6).
 */
export const CALLUS_LAB_SHIFT: Readonly<Lab> = [7, -2.5, 6];

/** A colour that is not skin has no keratin colour to change: callus is its sole lightened and yellowed by these factors (a CHOICE). */
const CALLUS_OVERRIDE: Readonly<Rgb> = [1.1, 1.06, 0.9];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The colour of callus on the sole of a figure of this tone: its sole's, shifted by `CALLUS_LAB_SHIFT` (measured as a spectrophotometer reads it, surface reflection included). */
export function callusAlbedo(tone: SkinTone): Rgb {
  const sole = palmAlbedo(tone);
  if (tone.override) return sole.map((c, i) => clamp01(c * (CALLUS_OVERRIDE[i] as number))) as Rgb;
  const [L, a, b] = labFromLinear(sole.map((c) => c + SKIN_F0) as Rgb);
  const shifted = linearFromLab([
    L + CALLUS_LAB_SHIFT[0],
    a + CALLUS_LAB_SHIFT[1],
    b + CALLUS_LAB_SHIFT[2],
  ]);
  return shifted.map((c) => clamp01(c - SKIN_F0)) as Rgb;
}
