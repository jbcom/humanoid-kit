/**
 * Hair albedo from the two pigments that colour human hair.
 *
 * Eumelanin (brown to black) sets the lightness from black to blond, and
 * pheomelanin (red to yellow) warms it; hair with neither is unpigmented
 * keratin, which reads white. Each pigment absorbs light per channel in fixed
 * proportions (`EUMELANIN_ABSORPTION`, `PHEOMELANIN_ABSORPTION`, the pigment
 * spectra of d'Eon et al. 2011 as pbrt-v4 ships them), so one number per pigment
 * moves colour along the axes real hair varies on, the way `skinAlbedo` moves
 * along melanin and haemoglobin.
 *
 * What the eye sees of a head of hair is not one fibre's absorption: light
 * scatters between fibres before it leaves, which flattens how fast colour
 * falls with absorption. Chiang et al. 2016 fit that for production hair
 * rendering as albedo = exp(−g·σ^½), with σ the absorption coefficient; this
 * model keeps that form for the forward direction, so doubling a pigment does
 * not halve the light, but fits its exponent as well as its gain
 * (`PATH_EXPONENT` 0.7, `PATH_GAIN` 2.7) to measured tresses (black L* 17.3
 * a* 1.8 b* 1.6, dark brown 22 / 4 / 4.5, light brown 32.6 / 6.9 / 14.4, within
 * about 3 ΔE). The three tresses fit exponents of 0.5 to 0.7 equally well; only
 * the upper end lets pheomelanin reach a red (a* about 11 rather than 7), so it
 * is the one used. `UNPIGMENTED_ALBEDO` is a modelled stand-in for white hair,
 * which no source here measures. Blond, red and white are therefore modelled,
 * not measured, and red hair's chroma is still limited by the pheomelanin
 * spectrum (docs/research/HAIR-COLOUR.md). A colour outside natural hair (blue,
 * green, a bright dye) is an explicit override instead, as for skin.
 */
import type { Rgb } from "./skinTone.ts";

/** What a figure's hair is coloured by. All of it is optional detail of the recipe's `hair`. */
export interface HairColour {
  /** 0 = none (white or blond), 1 = black hair. */
  eumelanin: number;
  /** 0 = none, 1 = the most red-gold. */
  pheomelanin: number;
  /** 0..1: the fraction of fibres with no pigment (grey and white hair). */
  grey: number;
  /** A linear-RGB albedo replacing the natural model (dyed or non-human hair), or null. */
  override: Rgb | null;
}

/**
 * Per-channel absorption (red, green, blue) at unit concentration, in the
 * units pbrt-v4's `HairBxDF::SigmaAFromConcentration` uses (d'Eon, Marschner and
 * Hanika 2011). Eumelanin absorbs blue most and red least, so it is brown;
 * pheomelanin absorbs less overall and is yellower.
 */
export const EUMELANIN_ABSORPTION: Readonly<Rgb> = [0.419, 0.697, 1.37];
export const PHEOMELANIN_ABSORPTION: Readonly<Rgb> = [0.187, 0.4, 1.05];

/**
 * Concentration at full pigment: pbrt-v4's own black hair (eumelanin 8,
 * σ = 3.35, 5.58, 10.96). Concentration follows the pigment value squared, which
 * puts a value of 0.5 at 2, the brown hair of the same demonstration.
 */
const CONCENTRATION_AT_FULL = 8;

/**
 * Multiple scattering's flattening of absorption, albedo = W · exp(−gain · σ^exponent)
 * (Chiang et al. 2016's form, with their exponent ½ fitted rather than assumed),
 * both fitted to measured tresses.
 */
export const PATH_GAIN = 2.7;
export const PATH_EXPONENT = 0.7;
/** Albedo of hair with no pigment, a modelled stand-in for white hair (unmeasured). */
export const UNPIGMENTED_ALBEDO = 0.55;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The diffuse albedo (linear RGB) of hair of this colour. */
export function hairAlbedo(colour: HairColour): Rgb {
  if (colour.override) return [...colour.override] as Rgb;
  const eu = clamp01(colour.eumelanin) ** 2 * CONCENTRATION_AT_FULL;
  const ph = clamp01(colour.pheomelanin) ** 2 * CONCENTRATION_AT_FULL;
  const grey = clamp01(colour.grey);
  return [0, 1, 2].map((k) => {
    const sigma =
      eu * (EUMELANIN_ABSORPTION[k] as number) + ph * (PHEOMELANIN_ABSORPTION[k] as number);
    const pigmented = UNPIGMENTED_ALBEDO * Math.exp(-PATH_GAIN * sigma ** PATH_EXPONENT);
    // Grey fibres are unpigmented; the head's colour is the mix of the two kinds.
    return (1 - grey) * pigmented + grey * UNPIGMENTED_ALBEDO;
  }) as Rgb;
}

/**
 * The mean of a packed strand map's colour, as linear value. The packer
 * normalises every style's texture to it, so the hair's colour is the albedo and
 * the texture only carries strand-scale structure: `hairTint` is what the
 * material multiplies the map by.
 */
export const HAIR_STRAND_MEAN = 0.4;

/** The material colour that makes a strand map (mean `HAIR_STRAND_MEAN`) render as this hair's albedo. */
export function hairTint(colour: HairColour): Rgb {
  return hairAlbedo(colour).map((c) => c / HAIR_STRAND_MEAN) as Rgb;
}

const natural = (eumelanin: number, pheomelanin: number, grey = 0): Readonly<HairColour> => ({
  eumelanin,
  pheomelanin,
  grey,
  override: null,
});

/**
 * Named natural colours, as pigment values. Black, dark brown and light brown
 * sit on the measured tresses; the rest are modelled.
 */
export const HAIR_COLOURS: Readonly<Record<string, Readonly<HairColour>>> = {
  black: natural(0.9, 0),
  "dark-brown": natural(0.62, 0.05),
  brown: natural(0.5, 0.15),
  "light-brown": natural(0.42, 0.05),
  auburn: natural(0.3, 0.5),
  red: natural(0.1, 0.55),
  ginger: natural(0.02, 0.45),
  blonde: natural(0.22, 0.2),
  "light-blonde": natural(0.14, 0.12),
  platinum: natural(0.08, 0.03),
  grey: natural(0.62, 0.05, 0.6),
  white: natural(0, 0),
};

export const DEFAULT_HAIR_COLOUR: Readonly<HairColour> = HAIR_COLOURS.brown as HairColour;
