# humanoid-kit: hair colour research (sources and what is measured)

Date: 2026-10-09. The model is `src/surface/hairTone.ts`. This note says where
each number comes from, and what could not be verified.

## The model

Hair colour is two pigments plus the fraction of unpigmented (grey) fibres.

1. **Pigment spectra** (absorption per channel, red, green, blue, at unit
   concentration): eumelanin 0.419, 0.697, 1.37 and pheomelanin 0.187, 0.4,
   1.05. These are the values pbrt-v4 uses in `HairBxDF::SigmaAFromConcentration`
   (`src/pbrt/bxdfs.cpp`, Apache-2.0, read from the repository on 2026-10-09),
   which takes them from d'Eon, Marschner and Hanika, "An Energy-Conserving Hair
   Reflectance Model", EGSR 2011 (the paper itself was not read; the values are
   pbrt's).
2. **Concentration.** Full pigment is 8, pbrt's black hair (σ = 3.35, 5.58,
   10.96 is 8 × eumelanin, from the figure caption in pbrt 4e §9.9.4). The same
   section's brown hair is σ = 0.84, 1.39, 2.74, which is 2 × eumelanin. Taking
   concentration as 8 × (pigment value)² puts a value of 1 at black and 0.5 at
   brown.
3. **Multiple scattering.** What is seen of a head of hair is not one fibre's
   absorption. Chiang, Bitterli, Tappan and Burley, "A Practical and
   Controllable Hair and Fur Model for Production Path Tracing" (CGF 35(2),
   2016), fit the absorption that gives a chosen multiple-scattering albedo α
   over a dense block of fibres as σ = (ln α / D(β))², with D a fifth-order
   polynomial of the azimuthal roughness (5.969, −0.215, 2.532, −10.73,
   5.574, 0.245; the form is confirmed against pbrt-v4's
   `HairBxDF::SigmaAFromReflectance`, not against the paper PDF, which was not
   read). Inverting it gives α = exp(−D·√σ): the square root is what flattens
   how fast colour falls as pigment rises. The model keeps that form,
   `albedo = W · exp(−g · √σ)`, per channel.
4. **Grey.** A grey fraction *g* of fibres has no pigment: the colour is
   `(1 − g) · pigmented + g · W` in linear light.

Two constants are this package's, not the literature's:

- `g` (`PATH_GAIN`, 2.2) is fitted to measured tresses (below). Chiang's D is
  about 5.9 at β = 0.3; the two differ because pbrt's concentration units and
  Chiang's σ are not the same scale (the pbrt brown and Chiang's inversion do
  not agree on a single albedo, so no constant is borrowed from one into the
  other).
- `W` (`UNPIGMENTED_ALBEDO`, 0.55, L* ≈ 80) is a modelled stand-in for white
  hair. No source reached here measures white hair.

## Measured anchors

Single untreated tresses, CIELAB (D65, d/8 or 10°, specular included, so the
tests add 0.02 of gloss to the albedo before comparing):

| Hair | L* | a* | b* | Source |
| --- | --- | --- | --- | --- |
| black | 17.3 | 1.8 | 1.6 | Journal of Cosmetic Science (Society of Cosmetic Chemists), library.scconline.org v046n04 |
| black | 18 to 21 | about 0 | −1 to −0.6 | same journal, v051n05 (the table is garbled in the source; approximate) |
| dark brown | 20.8 to 23.4 | 3.7 to 4.0 | 3.2 to 5.5 | same journal, v051n05, three tresses |
| light brown | 32.6 | 6.9 | 14.4 | same journal, v046n04 |

With `g` = 2.2 each is reached within about 2.5 ΔE by some pigment values
(`tests/hairTone.test.ts` allows 3.5, single tresses being the evidence). The
page text of these papers was seen through search summaries, not read in full.

## Not measured

- Blond, red and white hair. No CIELAB values for them were found in open
  text. Vaughn, van Oorschot and Baindur-Hudson, "Hair color measurement and
  variation" (Am. J. Phys. Anthropol. 137(1), 2008) clusters 132
  European-ancestry people by hair colour, mostly along b\*, but the cluster
  centres are behind the full text.
- Red hair's chroma. With pbrt's pheomelanin spectrum the model's a* tops out
  near 8 at a lightness of about 25, where real red hair is more saturated.
  Pheomelanin (the red-gold pigment) has too small an absorption contrast
  between green and red here; `override` is the way to a saturated copper.
- How a bundle's colour changes with length and thickness: one value per head.

## Why one albedo and a strand map

Each packed style carries a strand map: the atlas's luminance, normalised so its
mean is `HAIR_STRAND_MEAN`, with its alpha untouched. The recipe's colour
multiplies it (`hairTint`). Multiplying the original, coloured atlas by a tint
cannot make dark hair blond, and would carry the atlas's own hue into every
colour; a normalised map keeps only the strand-scale structure and takes colour
from the model.
