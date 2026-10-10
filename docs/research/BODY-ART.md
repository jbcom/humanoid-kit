# Body art: tattoos, piercings, scars, birthmarks and vitiligo

Sources and choices for the body-art layers (`src/bodyArt/`; design in
`docs/ARCHITECTURE.md`, "Body art"). As in `SKIN-STATES.md` Part C, every
magnitude is either measured, with its source, or marked **CHOICE**.

## Part A: what is known

### A1. Where tattoo ink lies, and why that changes its colour

- Tattoo pigment is free granules and pigment inside phagocytes in the
  superficial and middle dermis, under an epidermis that is otherwise
  normal (reflectance confocal microscopy with matching histology; Skin Res
  Technol 2023, 29:e13318, PMC10316469). So ink is seen through the whole
  epidermis and its melanin, on the way in and on the way out.
- Most pigment lies in the papillary dermis and rarely reaches the reticular;
  it lies deepest on the forearm and shallowest on the deltoid and chest, and
  shallower in older tattoos (42 tattoos, H&E histology; Olszewska et al.,
  Histol Histopathol 2023, 38:503, doi:10.14670/HH-18-559; depths in
  micrometres are only in a bar chart, not quoted here).
- No colour measurement of tattooed against untattooed skin, at any tone, was
  found, nor any measurement of black ink's blue cast.
- Visible light reaches about 2 mm into skin, so only ink shallower than that
  shows, and the skin's own absorbers (melanin, haemoglobin) and the dermis's
  scattering shape how it looks (J Biomed Opt 8(1), medical tattooing of
  nevi).
- Consequences the model keeps:
  - the same ink reads darker on deeper skin, by the epidermis's melanin
    transmittance, squared;
  - a pigment in the dermis reads bluer than it is, because the dermis above
    it scatters short wavelengths back before they reach the ink (the Tyndall
    effect). It is the same reason dermal melanin, a Mongolian spot, is
    blue-grey and not brown;
  - the dermis spreads the light a little, so the edges of a line are soft.

### A2. Vitiligo

- Vitiligo is the loss of the epidermis's melanocytes, so a patch is the
  skin with its melanin taken out: haemoglobin and the dermis remain.
- The patch is lighter (L\* higher) and less yellow (b\* lower) than both the
  skin around it and the skin 5 cm away (chromameter, 25 patients; Brazzelli
  et al. 2008).
- How much melanin a patch keeps: mexameter melanin index, healthy skin
  against patch, in 17 patients with stable non-segmental vitiligo (Krotkova
  et al., CosmoDerma 2025, 5:105, doi:10.25259/CSDM_116_2025, Table 1):
  cheeks 10.5 / 1.0, forehead 15.1 / 2.3, chest 6.7 / 1.5, back 13.2 / 2.1,
  forearms 20.0 / 3.1, knees 21.5 / 5.5, backs of the feet 22.9 / 3.8. A
  patch keeps about a sixth (0.10 to 0.26) of its skin's melanin index.
- Colour difference between patch and the skin around it: ΔE\*ab 6.8 to 29.5
  over 16 lesions, mostly 9 to 13, before treatment (digital colorimetry, 11
  Japanese patients; Toriyama et al., J Dermatol 2021, PMC8453891, Table 2).
- The vitiligo-to-normal remittance ratio is the standard melanin-free baseline
  of skin optics (Kollias & Baqer, J Invest Dermatol 1985, 85:38); no
  tabulated spectrum is open.
- The contrast is larger on deeper skin, where there is more melanin to lose.
  That is also why people with Fitzpatrick types V and VI report the largest
  burden (VALIANT survey).

### A3. Scars

- Scars differ from the skin around them in colour (erythema, which is a* and
  blood, and pigmentation). Scar-to-normal ratios separate them best (DSM II
  erythema and melanin ratios; Lee et al., Burns 2020).
- A hypertrophic scar differs from normal skin in every colour parameter
  except chroma.
- Keloids against forearm skin (DermaSpectrometer, 33 keloids in 30 Japanese
  patients; Aoki et al., J Nippon Med Sch 2016, 83:142, Table 2): erythema
  index 18.29 against 9.76 (ratio 1.96), melanin index 42.70 against 33.30
  (ratio 1.32).
- How far scars differ from the skin round them: total colour difference
  4.4, 9.6, 17.8 and 29.1 for scars judged a perfect, slight, obvious and gross
  mismatch (207 scars; Cheon, Lee & Rah, J Craniofac Surg 2010, 21:679).
  Lightness and redness separate them; yellowness does not.
- No scar colour by skin type was found.
- A mature scar has no hair follicles or sweat glands, so it lacks pores and
  is smoother than the skin around it.

### A4. Birthmarks

- Café-au-lait macule: more epidermal melanin, so a uniform light-brown patch
  darker than the skin.
- Congenital melanocytic naevus: melanocytes in the epidermis and dermis, so
  dark brown.
- Port-wine stain: dilated dermal capillaries, so more haemoglobin, pink to
  purple.
- Dermal melanocytosis (Mongolian spot): melanocytes deep in the dermis, so
  blue-grey (A1's optics). Most common on the lower back and buttocks of
  infants of East Asian, African and Indigenous American ancestry.
- No colour measurement of café-au-lait macules, of port-wine stains against
  normal skin, or of dermal melanocytosis against normal skin was found; their
  colours come from what lies in the skin (above), through the skin model.

## Part C: what the layers use

### C1. Ink (`src/bodyArt/ink.ts`, `src/render/bodyArtDecals.ts`)

| Quantity | Value | Source or choice |
| --- | --- | --- |
| Ink seen through the epidermis | skin albedo ÷ melanin-free albedo, per channel | Model: ink under a normal epidermis (A1), with the skin model's measured melanin; nothing fitted to tattoos |
| Melanin-free albedo | the lightest measured skin's chromaticity, red at `MELANIN_FREE_RED_REFLECTANCE` (0.62) | CHOICE: extrapolating the melanin axis turns it violet (b\* < 0), which vitiligo is not (A2: lesions keep b\* > 0) |
| `INK_DEPTH` | 0.2 mm | CHOICE at the top of the papillary dermis (A1); no depth in micrometres was read. 0.3 mm read greyish on the contact sheets (black on the fairest skin L\* 36) |
| Dermal veil | 1 − exp(−depth / ℓ) per channel, ℓ the skin's scatter length (1.14 mm at 550 nm, spectral slope 1.4) | Skin model (`SKIN_SCATTER`); the blue cast follows from it, not tuned |
| `INK_SPREAD` | 0.2 mm | CHOICE: light diffusing back from the ink spreads about as far as it travels. The shader never samples a tattoo's image finer than a disc this far round |
| `TATTOO_IMAGE_MAX` | 1024 texels a side | CHOICE: 1024 across a 40 cm back piece is 0.4 mm a texel, about the ink's spread across, so tattoos up to that size lose nothing the skin would show |
| `DECAL_MARGIN` | 8 mm | CHOICE: more than one UV texel at 1024² wherever skin is drawn (2.3 mm at most on a forearm, measured), so every texel under a decal has its four neighbours in it |
| `DECAL_LAYERS_MAX` | 2 | CHOICE: a third decal (tattoo or naevus) overlapping two goes on the top layer, over the one there |
| `TATTOO_ANISOTROPY` | 8 (or the GPU's limit) | CHOICE: a tattoo seen edge-on round a limb keeps its detail along the limb |
| Projection reach | 50% of the decal's longer side (≥ 1 cm), fading out over its last 40% | CHOICE: 30% with a hard end cut cheek and arm decals in straight lines on the sheets |
| Projection facing | full from cosine 0.35, nothing below 0.05 | CHOICE, faded for the same reason |
| The nail plate | no ink or mark acts on it (the nail-gloss layer's mask) | It is not skin: vitiligo turned the sheets' nail beds white |

No tattoo colour was found measured, so the result is checked only for
direction: the same ink is darker on every deeper tone, and reads cooler (b\*
lower) than the skin round it. Fresh black ink on the fairest skin is L\* 30,
b\* about 2. The body-art texture's texels are 1.2–2.3 mm on a forearm at
1024² (measured), which pixelated line work baked as colour on the sheets. The
tattoos are therefore decals sampled from their own images at the screen's
detail (ARCHITECTURE, "Tattoos, as built").

### C2. Marks (`src/bodyArt/marks.ts`, `src/bodyArt/markShape.ts`, `src/bodyArt/vitiligo.ts`)

Marks change what is in the skin (melanin, haemoglobin) through the skin
model, never its colour directly, so each reads at every tone. Melanin moves
in absolute density, not as a share of the skin's own: a vitiligo patch loses
its melanocytes and a naevus is a nest of them, whatever the skin round them.

| Quantity | Value | Source or choice |
| --- | --- | --- |
| Vitiligo's residual melanin | 0.15 × the density of skin at melanin 0.15 | Krotkova 2025: patches keep 0.10–0.26 of the skin's melanin index and read 1–5 units on any skin (absolute); the cohort's tone is a CHOICE (fair European) |
| Vitiligo on the lips | the lip of skin carrying the residual melanin (`lipAlbedo` at that tone), mixed with the depigmented skin as the lips' layer mixes in | Lips take their colour from the skin's lightness and the blood beneath (`lipAlbedo`), so a depigmented lip pales to pink. Scaling the lip by the skin's ratio turned the sheets' deep lips lavender |
| Below the lightest measured skin | each channel's log moves with density toward the melanin-free albedo (C1) | Beer–Lambert; continuous with the measured axis |
| Check | patch L\* ≈ 70 at every tone; ΔE\*ab 8.5 (melanin 0.1) to 12.4 (0.2), and larger on deeper skin; b\* below the skin's at fair to medium tones | Toriyama 2021 (ΔE\* mostly 9–13); Brazzelli 2008 (L\* up, b\* down) |
| Melanin added at full (`markMelaninSpan`) | the measured axis's density span, lightest to deepest | CHOICE of scale |
| Café-au-lait, naevus | 0.12 and 0.55 of that span | CHOICES: light brown (fair skin L\* 65 → 56, b\* 13 → 19) and dark brown (deepest skin L\* 22 → 11, not black) |
| A naevus's shape | a round dot its size across (3–5 mm typical), edge 0.3 mm, raised as a dome (1 − r²)² to 0.5 mm, drawn exactly as a decal | CHOICES: acquired naevi are round, well defined and a few millimetres across, a compound naevus slightly raised (A4). Baked into the 1 mm texels round a brow, the sheets' naevus read as a small dark rectangle |
| Melanin added, its colour | the skin on the measured axis with that much more density, from a table of 16 steps at squares, within ΔE\*ab 0.5 of it | Measured axis (warms as it deepens on fair and light skin). One ratio raised to a power cut straight across to the deepest skin and turned the sheets' café-au-lait grey-taupe |
| Port-wine stain | 4 steps of the measured haemoglobin axis | CHOICE (fair skin a\* 11 → 32) |
| Fresh or raised scar's redness | log(red ÷ green) 1.96 × the skin's, at melanin 0.2 | Aoki 2016: keloid erythema index 1.96 × the forearm's; the cohort's tone a CHOICE |
| Raised scar's melanin | + 0.32 × the density of skin at melanin 0.2 | Aoki 2016: keloid melanin index 1.32 × |
| Mature flat scar | 0.35 of the way to vitiligo's residual | CHOICE: paler than its skin |
| Scar smoothness, raise | roughness −0.15; 1.5 mm at `raised` 1 | CHOICES |
| Dermal melanocytosis | ink of [0.06, 0.04, 0.03] (linear) at 0.75 coverage, through C1's optics | CHOICE; its blue-grey follows from the dermal veil |
| Patch outlines (`markShape`) | an ellipsoid, its smaller half-size deep, thresholded by three octaves of seeded value noise in the frame's own 3D space: vitiligo ±30% in cells 0.45 of its half-size, café-au-lait ±16% (0.7), port-wine ±32% (0.4) | CHOICES after A2–A4. Measured in 3D, a patch is the same either side of a UV seam and ends where the skin curves away by its own depth; the planar projection's reach cut the sheets' café-au-lait and port-wine in straight lines, and its polar outline read as the UV island's shape round the mouth |
| Patch edges | the noise field over its gradient (a distance, metres) through a smoothstep of half-width 0.9 mm (vitiligo), 1.1 mm (café-au-lait, port-wine), each ±35% along the outline; dermal pigment 30% of its half-size | CHOICE for a soft 1–3 mm border; the unit tests hold the mean width across the edge to 1–3 mm |
| Vitiligo's flecks | a finer noise (2.5 mm cells) above 0.45 (its top 5% or so), within half the patch's half-size outside its edge | CHOICE: confetti depigmentation round a border (A2) |
| Scar outlines | radius harmonics 2–5, edge 0.25 mm, wandering 15% of the half-width | CHOICES after A3 |
| Vitiligo's sites | round the eyes and mouth (15% each), backs of the hands (30%), wrists, elbows, knees, tops of the feet (10% each); mirrored left to right | CHOICE following where non-segmental vitiligo is reported |
| Vitiligo's extent | 2 to 14 mirrored pairs, 1.5 to 6 cm across, scaled by site: round the eyes and mouth 0.4, wrists and the backs of the hands 0.7, feet 0.8, elbows and knees 1 | CHOICE: a full-size patch round the mouth read as a mask on the sheets |

### C3. Piercings (`src/bodyArt/jewellery.ts`, `src/bodyArt/sites.ts`)

| Quantity | Value | Source or choice |
| --- | --- | --- |
| Sites | the vertex the feature's MakeHuman target moves most; the septum the midline nose vertex nearest the point between the nostrils | The targets (frozen base mesh) |
| Channel through the tissue | into the skin (lobe, helix, nostril, lip), across (septum), vertically under the skin (brow, navel) | Piercing anatomy |
| Tissue depth | lobe 4 mm, helix 2, nostril 3, columella 7 across, brow 8, lip 6, navel 8 | CHOICES |
| Default sizes | stud 3 mm, ring 10 mm across, barbell 14 mm | CHOICES (common retail sizes) |
| Ring wire, barbell balls and bar | 8% of the ring (≥ 0.8 mm); balls 22% of the bar (≥ 2.5 mm); bar 1.2 mm | CHOICES |
| Metal reflectance (linear) | steel 0.56/0.57/0.58, silver 0.95/0.93/0.88, gold 1.00/0.71/0.29, titanium 0.54/0.50/0.45 | Measured optical constants (Hoffman, SIGGRAPH 2015 course notes, after Gulbrandsen 2014) |
| Rose gold | 0.97/0.68/0.42 | CHOICE between gold and copper (0.95/0.64/0.54) |
| Roughness | 0.18 | CHOICE: polished |
