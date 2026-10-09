# Rendering skin across the whole human range

Research notes for `src/surface/skinTone.ts` (melanin → albedo) and
`src/render/skinMaterial.ts` (the MeshPhysicalMaterial-based skin shader). The
aim is skin that is correct from the lightest to the deepest complexion. The
current settings are tuned for light skin.

Numbers in this document are quoted from the sources listed at the end, or are
computed from openly licensed measurement data with the method given in §2.3.
Anything that is a recommendation rather than a measurement is labelled as one.

---

## 1. Summary

1. **The current melanin anchors are display swatches, not reflectances, and
   they cover too wide a range.** The lightest anchor (`#f3d9c8`, CIELAB
   L\* 88.4) is about 20 L\* lighter than the lightest facial skin in a
   2,113-subject spectrophotometric archive. The deepest anchor (`#3a2216`,
   L\* 16.0) is about 15 L\* darker than the archive's deep end. The mid-to-deep
   anchors are also too saturated: they have b\* 25–28, where measured skin has
   10–19. §2.4 gives a replacement anchor set of 10 measured albedos.
2. **Specular F0 is too high.** `SkinMaterial` never sets `ior`, so it inherits
   three's default of 1.5, which gives F0 = 0.04. Skin's refractive index is
   about 1.38–1.4, which gives F0 ≈ 0.026–0.028. The specular lobe should stay
   the same at every melanin level. Deep skin reads as glossier because less
   diffuse light competes with the same specular, not because the surface
   reflects more.
3. **Subsurface scattering should weaken and shorten as melanin rises.** The
   current fixed red-heavy wrap (`hkScatter = 0.42, 0.20, 0.12`) is the
   "translucency equals skin" assumption that graphics research has been
   criticised for. On deep albedos it pushes the terminator toward saturated
   orange.
4. **The near-white sheen is a source of ashy rendering on deep skin.** The
   same physical signal, a lighter whitish surface reflection on a dark base, is
   what dermatology measures as *ashiness*: a dry-skin condition, not healthy
   skin.
5. **The tone mapper treats depth unevenly.** Under three's `NeutralToneMapping`
   (the tone mapper the playground and editor use), the colour error grows with
   melanin: ΔE 4.8 at the lightest anchor and 13.1 at the deepest for a key-lit
   diffuse pixel. `AgXToneMapping` keeps the error between 3.4 and 6.6 across
   the whole range (§5.2).

---

## 2. Measured skin colour across the full range

### 2.1 Classification scales

**Fitzpatrick skin type** is a self-reported sunburn/tanning scale (I "Very white /
Always burn" through VI "Black / Never burn", as tabulated by Weyrich et al.
2006). It is not a colour measurement. An IEEE study cited by the Monk scale's
Wikipedia article found it "poorly predictive of skin tone".

**ITA° (Individual Typology Angle)** is computed from measured CIELAB:

```text
ITA° = arctan((L* − 50) / b*) × 180/π
```

Del Bino, Duval & Bernerd (2018) give the six classes as
"very light > 55° > light > 41° > intermediate > 28° > tan > 10° > brown > −30° > dark".
The skinoptics documentation and the *True to Tone* paper (Schneider et al.
2026) give the same thresholds.

**Monk Skin Tone (MST) scale.** This is 10 swatches published by Google and
Ellis Monk. Per Wikipedia, "Its ten tones are licensed under the Creative
Commons Attribution 4.0 International license". The sRGB values are the ones
Wikipedia's table cites to Google's *MST Swatches* page:

| MST | sRGB hex | linear sRGB | L\* | a\* | b\* | ITA° |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `#f6ede4` | 0.922, 0.847, 0.776 | 94.2 | 1.5 | 5.4 | 83.0 |
| 2 | `#f3e7db` | 0.896, 0.799, 0.708 | 92.3 | 2.1 | 7.3 | 80.2 |
| 3 | `#f7ead0` | 0.930, 0.823, 0.631 | 93.1 | 0.2 | 14.2 | 71.7 |
| 4 | `#eadaba` | 0.823, 0.701, 0.491 | 87.6 | 0.5 | 17.8 | 64.7 |
| 5 | `#d7bd96` | 0.680, 0.509, 0.305 | 77.9 | 3.5 | 23.1 | 50.3 |
| 6 | `#a07e56` | 0.352, 0.209, 0.093 | 55.1 | 7.8 | 26.7 | 10.9 |
| 7 | `#825c43` | 0.223, 0.107, 0.056 | 42.5 | 12.3 | 20.5 | −20.1 |
| 8 | `#604134` | 0.117, 0.053, 0.034 | 30.7 | 11.7 | 13.3 | −55.4 |
| 9 | `#3a312a` | 0.042, 0.031, 0.023 | 21.1 | 2.7 | 6.0 | −78.3 |
| 10 | `#292420` | 0.022, 0.018, 0.014 | 14.6 | 1.5 | 3.5 | −84.3 |

The CIELAB values were computed here using sRGB with a D65 white point.

**Do not use the MST swatches as albedo.** They are a perceptual annotation
scale (the published artwork is "orbs", which carry their own shading). Four of
the ten swatches are lighter than any skin in the measurement archive below
(L\* 87.6–94.2, where the measured facial maximum is 74.0). MST 9–10 (L\* 21.1
and 14.6) are darker than the archive's deepest facial reading (22.7). MST
remains the right vocabulary for *coverage testing*: render a figure at each MST
level and check that every level is reachable.

### 2.2 Datasets considered

| Source | What it gives | Covers deep skin? |
| --- | --- | --- |
| **ISSA** (Yan et al., *Scientific Data* 2025) | "15,256 records of both spectral and colorimetric data derived from 2,113 subjects", 400–700 nm spectra plus CIELAB, multiple body sites. CC BY 4.0 on figshare. | **Yes.** It includes an African dataset (941 records, median facial L\* 38.9). |
| Xiao et al. 2017, *Skin Res Technol* | Caucasian, Chinese, Kurdish and Thai skin at forehead, cheek, inner arm and back of hand. "Facial redness (a\*) is invariant across the four ethnic groups." | No: there are no African subjects. Its data is folded into ISSA. |
| Weyrich et al. 2006 (SIGGRAPH) | 149 faces with an analytic BRDF, albedo maps and translucency. | Weakly. Type V has 13 male and 2 female subjects, type VI has 4 male and 1 female. |
| Wright, C. Y. et al. 2018, *Skin Res Technol* letter (South Africa) | ITA for 49 participants, with a mean of −17° and a range of −40° to 16°. | Yes, but it reports ITA only, with no L\* or b\*. |
| physicallybased.info "Skin I–VI" | Practitioner render presets, linear: I `[0.847, 0.638, 0.552]` … VI `[0.09, 0.05, 0.02]`, IOR 1.4, roughness 0.5, subsurface radius per type. | Yes, but these are not a measurement. They are compiled from the optics literature. |

ISSA is the only open dataset found that has measured CIELAB *and* spectra
across the whole range, so the anchors below come from it.

### 2.3 Method used to derive the anchors (reproducible)

1. Download `ISSA_17_Jan_2025_Yan_Lu.xlsx` from figshare
   (doi:10.6084/m9.figshare.28228571.v4, CC BY 4.0).
2. Keep the facial sites: forehead (location code 6) and cheek (code 2). That
   leaves 4,603 records, with L\* from 22.7 to 74.0 and ITA from −78.5° to
   66.4°.
3. Compute ITA from the dataset's own L\* and b\*. Take the **median** L\*a\*b\*
   and XYZ of all records within ±4° of ten target angles: 62, 50, 38, 25, 12,
   0, −15, −30, −45 and −60°. These span the very-light to dark ITA classes in
   roughly equal L\* steps of 2.5–5.
4. Convert the dataset's XYZ (D65) to linear sRGB with the IEC 61966-2-1
   matrix.
5. **Remove the surface specular.** ISSA states that "the specular component of
   the light reflected from the sample was included in the measurements"
   (specular-included, SCI, d/8° geometry). In that geometry the detector sees
   the sphere wall mirrored at about 8°, which adds roughly F0 of the skin
   surface to every channel. With Weyrich's η ≈ 1.38 and Donner and Jensen's
   1.4, F0 = ((η−1)/(η+1))² ≈ 0.026–0.028. **0.028** is subtracted from each
   linear channel, so the anchor is the diffuse albedo the shader's base colour
   should carry. The renderer adds the specular back through its own Fresnel
   term. This matters most at the deep end: 0.028 is a third of the deepest
   anchor's red channel.

Limitations:

- **Contact measurements read low.** Small-aperture contact spectrophotometers
  under-read translucent tissue, because light diffuses laterally out of the
  aperture ("edge loss"; see the HAL paper in the sources). ISSA reports
  "mean colour differences between the two measurement apertures were 2.48 and
  3.04" ΔE\*ab. The light anchors may therefore be a few percent too dark,
  especially in red, where skin is most translucent. Validate them against
  calibrated photographs.
- **The light end is thin.** Only 16 facial records fall in the ITA 62° bin.

### 2.4 Recommended melanin anchors (diffuse albedo, linear sRGB)

`melanin` t is evenly spaced over the 10 anchors. L\*, a\* and b\* are the
dataset medians, before the specular is removed. The linear values are after
removing F0. EV is log₂(Y / 0.18), the anchor's natural exposure offset from
middle grey.

| # | melanin t | ITA bin | n | L\* | a\* | b\* | **diffuse linear sRGB** | Y | EV vs 18% | sRGB hex | ≈ MST (by L\*) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.000 | 62° | 16 | 68.2 | 10.2 | 10.2 | **[0.498, 0.322, 0.271]** | 0.355 | +0.98 | `#bb9a8e` | 5 |
| 1 | 0.111 | 50° | 352 | 65.7 | 10.7 | 13.4 | **[0.468, 0.286, 0.215]** | 0.320 | +0.83 | `#b69280` | 6 |
| 2 | 0.222 | 38° | 741 | 62.2 | 11.4 | 15.7 | **[0.429, 0.246, 0.170]** | 0.279 | +0.63 | `#af8872` | 6 |
| 3 | 0.333 | 25° | 762 | 58.3 | 11.2 | 17.9 | **[0.376, 0.204, 0.128]** | 0.235 | +0.38 | `#a57d64` | 6 |
| 4 | 0.444 | 12° | 470 | 54.0 | 11.7 | 18.9 | **[0.322, 0.163, 0.093]** | 0.192 | +0.09 | `#9a7056` | 6 |
| 5 | 0.556 | 0° | 227 | 50.3 | 11.7 | 19.0 | **[0.274, 0.132, 0.068]** | 0.158 | −0.19 | `#8f664a` | 6 |
| 6 | 0.667 | −15° | 106 | 45.3 | 11.1 | 18.1 | **[0.213, 0.098, 0.048]** | 0.119 | −0.60 | `#7f583e` | 7 |
| 7 | 0.778 | −30° | 71 | 40.8 | 11.0 | 16.0 | **[0.166, 0.073, 0.035]** | 0.090 | −1.01 | `#714c34` | 7 |
| 8 | 0.889 | −45° | 58 | 37.2 | 10.2 | 13.0 | **[0.128, 0.054, 0.028]** | 0.068 | −1.40 | `#64422f` | 7 |
| 9 | 1.000 | −60° | 38 | 33.6 | 8.7 | 9.6 | **[0.092, 0.040, 0.024]** | 0.050 | −1.84 | `#56392b` | 8 |

**Update (2026-10-08): the deep end.** The −60° bin median left the deepest
measured people beyond the slider's end (the darkest decile of ITA ≤ −52.5°
has L\* 28.2; the darkest single reading 22.7). An eleventh anchor, the
median of the −75° bin (cheek and forehead, 36 readings, about the 1st
percentile of all facial readings), is now melanin 1:
**[0.061, 0.028, 0.019]**, L\* 30.1. The same processing reproduces the −60°
anchor above to within 0.001. The eleven anchors are evenly spaced, t = i/10.

Source: ISSA (Yan et al. 2025, CC BY 4.0), facial sites, with the processing in
§2.3. The light bins are mostly Caucasian, Chinese, Japanese and Thai subjects.
The −15° to −60° bins are mostly the African dataset (for example, all 38
records in the −60° bin are African).

Patterns in the measurements that the model should reproduce:

- **Lightness spans about 2.8 stops.** Diffuse Y runs from 0.355 to 0.050, an
  EV difference of +0.98 to −1.84. This matches Ansel Adams' zone placements
  (§4): dark skin at Zone V, average light skin at VI, very light skin at VII.
- **Chroma peaks in the middle and falls at both ends.** b\* rises from 10 to
  19 and falls back to 10. Deep skin is *less* yellow-orange than mid-brown
  skin. The current anchors keep b\* at 20–28 into the deep end, which renders
  deep skin as a saturated rust colour.
- **Facial redness is nearly constant.** a\* stays between 8.7 and 11.7 across
  the whole range. Xiao et al. report the same: "Facial redness (a\*) is
  invariant across the four ethnic groups". Inner arm skin is less red, with
  a\* 4.8–10.0 (for example 5.5 at the 50° bin), so body skin away from the
  face could carry a slightly lower haemoglobin default.

### 2.5 Current anchors compared with the measurements

| current anchor | L\* | a\* | b\* | ITA° | issue |
| --- | --- | --- | --- | --- | --- |
| `#f3d9c8` | 88.4 | 6.3 | 11.7 | 73.1 | L\* +14 above the measured facial maximum (74.0) |
| `#e8c1a6` | 80.8 | 10.0 | 18.8 | 58.6 | lighter than any facial bin |
| `#d4a07e` | 69.9 | 14.9 | 25.2 | 38.3 | b\* about 10 too high for its ITA (measured: 15.7) |
| `#b47e5a` | 57.4 | 16.7 | 27.9 | 14.9 | a\* +5, b\* +9 |
| `#8d5a3b` | 43.2 | 17.6 | 26.4 | −14.4 | a\* +6.5, b\* +8 |
| `#5f3a24` | 28.3 | 13.9 | 20.4 | −46.8 | L\* 9 below the measured −45° bin; b\* +7 |
| `#3a2216` | 16.0 | 10.0 | 12.8 | −69.3 | L\* 15 below the deep end of the data |

The physicallybased.info presets have the same light-end bias. "Skin I"
`[0.847, 0.638, 0.552]` is brighter than any ISSA facial median, even allowing
for edge loss.

> **Default shift.** `DEFAULT_SKIN_TONE.melanin = 0.35` currently lands near
> L\* ≈ 68.6. On the new anchors, 0.35 lands near L\* ≈ 57.7, the ITA "tan"
> class. If the default should still be a light-intermediate complexion, the
> number needs to change too.

### 2.6 Calibrating haemoglobin and undertone

Measured spread within each lightness band (ISSA, facial sites, 10th–90th
percentile):

| L\* band | a\* p10–p90 | b\* p10–p90 |
| --- | --- | --- |
| 30–36 | 6.6 – 10.2 | 7.1 – 12.2 |
| 42–48 | 9.1 – 13.3 | 15.8 – 19.8 |
| 54–60 | 9.1 – 15.7 | 13.9 – 20.5 |
| 66–72 | 7.0 – 12.0 | 11.7 – 16.9 |

How the current `skinAlbedo` modifiers compare (computed here):

- **Haemoglobin** (0 → 1) moves a\* by 5.8 at a mid anchor. That matches the
  measured range. At the deepest anchor it moves a\* by 2.0, where the measured
  range is about 3.6. The existing fade, `1 − 0.6·melanin`, is directionally
  right: Donner and Jensen note that "the effects of higher blood concentration
  are less apparent in darker skin, as melanin absorption dominates". It fades
  slightly too much; `1 − 0.4·melanin` would match the data better.
- **Undertone is asymmetric.** At a mid anchor, −1 (cool) moves b\* by only
  −0.6, while +1 (warm) moves it by +2.4. The measured spread is about ±2.5–3.3
  b\* around the median at every lightness. *Recommendation:* make undertone a
  symmetric ±3 b\* shift, applied as a CIELAB-calibrated linear tint so the
  lightness stays fixed.

---

## 3. Specular, roughness and subsurface scattering as melanin varies

### 3.1 Specular reflection does not depend on melanin

- Fresnel reflection happens at the oil and stratum corneum surface, above the
  melanin. Weyrich et al. use "η ≈ 1.38", and Donner and Jensen assume "constant
  index of refraction of 1.4 throughout the skin". Both give F0 ≈ 0.026–0.028.
  three's `MeshPhysicalMaterial` defaults to `ior = 1.5` (F0 = 0.04).
  `SkinMaterial` never overrides it, so its specular is about 45% too strong at
  normal incidence for *every* skin tone.
- Donner and Jensen (2006, Fig. 7 caption): "Note that darker skin appears
  wetter because more of the light transmitted into the skin is absorbed, even if
  surface reflectance is the same compared to lighter skin." **The specular stays
  the same; the diffuse drops.** With F0 = 0.028 on the deepest anchor's
  diffuse Y = 0.050, the specular is about 36% of the normal-incidence
  reflectance. On the lightest anchor (Y = 0.355) it is about 7%.
- Kim et al. (SIGGRAPH Talks 2022), as summarised by 3DVF: "when trying to
  create a realistic dark skin, the specular component will typically be more
  important than subsurface scattering."
- **Roughness.** Weyrich fit a Torrance–Sparrow (Beckmann) lobe per face region.
  The axes of their per-region plot (Fig. 15) span roughness m ≈ 0.23–0.31 and
  specular scale ρs ≈ 0.18–0.32. The nose has the lowest m ("it lacks small facial
  wrinkles"), and the nose and forehead have the highest ρs ("areas of high sebum
  secretion"). Donner and Jensen: "values for σ in the range 0.2 − 0.4 give good
  results for skin, and we use σ = 0.35". Taking three's GGX α = roughness² and
  α ≈ Beckmann m, m ≈ 0.27 gives roughness ≈ 0.52. **The current 0.52 is
  well-founded**, and a lower roughness of about 0.45–0.48 is justified on the
  nose and forehead.
- Weyrich also found "skin type is the only reliable predictor for BRDF
  parameters" (a direct correlation of 0.766). The paper text does not state
  the direction, and type V–VI had only 20 subjects. Do **not** link specular
  strength to melanin. Expose it as a separate *oiliness* control, as Donner and
  Jensen do with ρs.

### 3.2 Subsurface scattering weakens as melanin rises

- Melanin sits in the epidermis. Jacques (OMLC 1998) gives the melanosome volume
  fraction as "light-skinned adults f.mel = 1.3-6.3%", "moderately pigmented
  adults f.mel = 11-16%" and "darkly pigmented adults f.mel = 18-43%". Its
  absorption is "mua.mel = (6.6 x 10^11)(nm^(-3.33)) [cm-1]", so it absorbs blue
  much more strongly than red. Light that scatters through the dermis crosses
  this filter twice, so the light coming back out is darker and redder.
- Weyrich: "Subjects with skin type V and VI have higher absorption and lower
  scattering coefficients than subjects with skin type II or III." The light
  that emerges travels a shorter visible distance.
- Kim et al. 2022: "translucency is only the dominant visual feature of young,
  white Europeans and fair-skinned East Asians". They found "19 graphics
  publications … that solely present renderings of white humans as evidence that
  subsurface scattering algorithms can faithfully depict 'skin'", and "In at
  least 4 instances, this bias is then reflected in commercial software". The
  *True to Tone* paper attributes "over-lightening and misrepresentation of
  darker skin tones" to SSS parameters tuned for lighter skin.
- Practitioner numbers: physicallybased.info gives subsurface radius
  `[0.482, 0.169, 0.109]` for Skin I–III and `[0.367, 0.137, 0.068]` for Skin
  IV–VI. That is a reduction of 24% in red, 19% in green and 38% in blue.

**Recommended per-melanin scatter for the wrapped-diffuse term.** This is
derived from the radius ratios above, not measured directly:

```glsl
hkScatter(m) = mix( (0.42, 0.20, 0.12),   // light skin (current values)
                    (0.32, 0.16, 0.075),  // deep skin: ×(0.76, 0.81, 0.62)
                    m )
```

The wrapped term already multiplies `BRDF_Lambert(albedo)`, so its absolute
strength falls with albedo on its own. What this change removes is the extra
*channel spread* of the wrap. On a deep albedo whose R/G ratio is already 2.3,
that spread is what produces the over-red, orange terminator.

---

## 4. Photography and cinematography practice

### 4.1 The history of light-skin bias

- **Shirley cards.** Kodak's lab calibration references from the 1940s to the
  1990s featured a single white model. A photo-lab worker told NPR (via *Mic*):
  "If Shirley looked good, everything else was OK." Lorna Roth (2009) describes
  "a light-skin bias embedded in colour film stock emulsions and digital camera
  design". *Mic*, citing *Vox*, reports that things shifted only "when
  companies complained to Kodak that they couldn't tell different-colored wood
  products apart". According to Wikipedia's summary of Roth, "In 1995, Kodak
  designed a multiracial norm reference card".
- **Face-priority auto-exposure.** Google's Real Tone, launched with Pixel 6 in
  2021, retuned face detection, auto white balance and auto-exposure "to balance
  brightness and ensure your skin looks like you – not unnaturally brighter or
  darker". It also added an algorithm for stray light, because "Stray light
  shining in an image can make darker skin tones look washed out".
- **Rendering pipelines.** *True to Tone* (2026) measured the ITA error of
  photo-to-avatar pipelines by ITA class, with medians "I - 12.12; II - 14.45;
  III - 17.35; IV - 22.62; V - 31.15; VI - 49.43". With naive cheek sampling,
  "the error for ITA VI was almost 4 times that for ITA I".

### 4.2 Practitioner rules

- **Exposure follows the scene, not each face.** Adams' zone scale (via
  Wikipedia) places "dark skin" at Zone V ("Middle gray"), "Average light skin"
  at VI and "Very light skin" at VII. These are different zones one stop apart.
  The ISSA anchors span the same range (EV +0.98 to −1.84). Normalising every
  face to one target is what made 1990s sitcom footage look flat. Berkofsky:
  "The conventional way of doing things was that if you put the skin tones
  around 70 IRE, it's going to look right… If you've got black skin, [dialing
  it] up to 50 or 70 is just going to make the rest of the image look weird."
- **Model deep skin as reflective and shape it with large sources.** Berkofsky
  (*Insecure*, via PetaPixel): "The way I approach dark skin tone technically is
  all about the skin [being] reflective". "The amount or intensity of light is
  not so important, but instead the surface area of the light." Bradford
  Young's work is described as "not overexposed, but rather, subtly reflective,
  embracing darkness" (CBC).
- **Control the background, not the faces.** Berkofsky: "The trick is keeping
  [light] off the walls. If you keep it off the walls, you can expose for the
  faces and it still has a cinematic look."
- **No colour-cast formula.** Berkofsky rejects the film-school rule to "throw
  green light or amber light at them" and says no universal recipe exists.

### 4.3 Rules for a neutral studio preset (a)

`src/react/StudioStage.tsx` today uses a warm key (`#fff6ef`, 2.4), a **cool**
fill (`#dfe9ff`, 0.55; a key-to-fill ratio of about 4.4:1, roughly 2.1 stops),
a **cool** hemisphere (`#e4ecf4` sky, 0.22), a white rim (1.6) and a studio
environment at 0.22. Recommendations:

1. **Make the fill and ambient neutral or the same colour temperature as the
   key.** A blue fill on a low-albedo warm surface pulls the shadow side toward
   grey, which reads as ashy. A cool rim or kicker for separation is fine.
2. **Light key-side skin with a large source.** Use a soft key with real area
   (a rect-area light, or a bright softbox in the environment map) so deep skin
   shows a broad, shaped specular. Today the specular comes almost entirely
   from point-like directional lights and a dim environment.
3. **Key-to-fill between 2:1 and 4:1** (1–2 stops). The deepest anchor's
   shadow side must stay above the tone curve's toe (see §5.2).
4. **The same rig for every figure in a group.** Do not re-light per figure.
5. **Keep light off the background.** Expose for faces and let the walls fall.

### 4.4 An exposure-metering signal a figure can publish (b)

A figure should help the host meter correctly without hiding real differences
in lightness. Proposed fields (a recommendation):

- `skinReflectance`: the anchor's diffuse Y (0.050–0.355), and
  `skinZoneEV = log2(Y / 0.18)` (+0.98 … −1.84). This is the figure's
  *intended* offset from middle grey.
- `meterRegion`: the face's bounding sphere (forehead and cheeks), for
  spot-metering. ISSA's anchors are facial measurements, so this is where the
  numbers apply.
- **How a host should use it:** set scene exposure from an 18% grey reference.
  Then check that each face's metered luminance is about `skinZoneEV` relative
  to grey (±⅓ EV). That is a test of the lighting. If a deep-skinned face meters
  far below its target, add light or source area, as Berkofsky does. Do not
  raise the global exposure. For a group, meter the deepest face's key side and
  make sure it sits above the toe. Never pull every face to the same luminance.

---

## 5. Real-time rendering failure modes for deep skin, and fixes

### 5.1 Ashy or grey cast

- **Cause: a near-white sheen.** `sheen 0.25`, `sheenColor (0.9, 0.82, 0.78)`,
  `sheenRoughness 0.8`. On a deep albedo, a grazing near-white lobe lifts the
  silhouette toward grey. Uhoda et al. (2003) measured ashy skin on 37 Black
  African women: "Ashy skin was lighter but not erythematous", and it
  "corresponds to a peculiar type of xerosis with reduction in Fresnel
  reflection by the stratum corneum". A whitish surface layer over deep skin is
  the *diagnostic look of dry skin*.
  **Fix:** tint the sheen from the albedo, for example
  `sheenColor = mix(albedo / max(albedo), vec3(1), 0.25)`, and scale sheen
  intensity as `0.25 → 0.12` with melanin. If dry skin is wanted on purpose,
  expose a separate `dryness` control.
- **Cause: cool ambient or fill.** See §4.3.1. **Fix:** a neutral fill.
- **Cause: excess specular.** F0 of 0.04 instead of 0.028 inflates the white
  surface layer. In a white-furnace test (rendered = albedo·(1−F0) + F0, not
  tone-mapped) the specular floor alone shifts the deepest anchor by ΔE 8.4
  (L\* 26.7 → 33.2, chroma 17.6 → 12.4). **Fix:** `ior = 1.4`, so the floor is
  only as large as real skin's.
- **Cause: albedos taken from photographs.** *True to Tone* shows that sampling
  a lit cheek misreads deep skin as "lower illumination applied to lighter
  skin". **Fix:** take albedo from the measured anchors, never from a lit
  render.

### 5.2 Crushed or over-saturated shadows from tone mapping

Khronos PBR Neutral, which three ships as `NeutralToneMapping`, subtracts an
offset of `x − 6.25x²` (for x < 0.08), where x is the darkest channel. Its
specification guarantees that base colours are reproduced only "where
0.08 ≤ R ≤ 0.8, 0.08 ≤ G ≤ 0.8, and 0.08 ≤ B ≤ 0.8". The deep anchors' blue
channel is 0.024–0.048, below that range. These are computed results for a
diffuse pixel, CIE ΔE\*ab against the untone-mapped value, at exposure 0.95 as
in the playground:

| anchor | lit by key (×1.0): Neutral | ACES (three) | AgX (three) | shadow side (×0.35): Neutral | ACES | AgX |
| --- | --- | --- | --- | --- | --- | --- |
| ITA 62° | 4.8 | 5.3 | 6.5 | 9.0 | 3.1 | 3.7 |
| ITA 25° | 6.8 | 4.4 | 6.6 | 12.5 | 5.9 | 3.2 |
| ITA −15° | 12.1 | 6.6 | 3.7 | 11.2 | 8.0 | 4.2 |
| ITA −45° | 13.2 | 7.3 | 3.4 | 7.8 | 9.8 | 5.2 |
| ITA −60° | 13.1 | 7.7 | 3.7 | 7.1 | 10.3 | 4.7 |

- Under Neutral, deep skin goes **darker and more saturated**. For the ITA −60°
  key-lit pixel, L\* drops from 26.7 to 19.2 and chroma rises from 17.6 to 28.0,
  so deep skin turns rust-orange. Under ACES (three's version, with its ×1/0.6
  gain), deep shadows **crush**: L\* 14.1 → 5.0. AgX keeps the error between
  3.4 and 6.6 everywhere and the hue within about 4°. It is the most *uniform*
  across the range.
- In a uniform white environment, where the scene includes a 0.028 specular
  floor, Neutral's offset largely cancels that floor (ΔE 1.7–3.5). Neutral
  behaves well when lighting is dominated by the environment and badly in
  key-lit areas.
- **Fix:** make the studio preset's tone mapping a tested choice. Prefer AgX,
  or keep Neutral and add a fairness check: render the 10 anchors under the
  preset rig, take ΔE\*ab against the untone-mapped value, and require that the
  error's *spread* across anchors stays within a few units (the "parity" test
  below).

### 5.3 Over-red subsurface scattering

- **Cause:** the fixed `hkScatter (0.42, 0.20, 0.12)`. **Fix:** the per-melanin
  `hkScatter(m)` in §3.2.
- **Related:** lips and areola are computed as albedo × fixed multipliers
  (`0.74 − 0.2·lips`, and so on). On the deepest anchor that puts lip red near
  0.06. No measured source on lip colour across skin tones was found. Validate
  lip and areola colour at the deep end against reference photography before
  tuning the multipliers.

### 5.4 A parity test (recommended)

For each of the 10 anchors (and each MST level, for coverage), render a sphere
and a face under the studio preset. Then assert:

1. the metered face luminance falls within ±⅓ EV of `skinZoneEV`;
2. the tone-mapping ΔE\*ab spread across anchors is no more than about 3;
3. there is no hue rotation greater than 5° from the albedo hue on the key side;
4. on the shadow side, the deepest anchor's L\* stays above 10, so it is not
   crushed.

### 5.5 Validation in the renderer (2026-10-08)

The tone-mapping simulation in 5.2 preferred AgX. Rendering settled it the
other way. Faces were rendered under `StudioStage` at melanin 0, 0.25, 0.5,
0.75 and 1. For each, the median L\* and mean hue and chroma of all skin pixels
in the face box were compared with the model's own albedo for that melanin
(rendered / albedo).

| Setting | L\* (0 → 1) | hue (°) | chroma |
| --- | --- | --- | --- |
| AgX, exposure 0.95 | 66/66, –, 54/49, 45/37, 36/27 | within 2–4 | −3 to −7 |
| Neutral, exposure 0.95 | 63/66, 56/59, 45/49, 34/37, 23/27 | within 1–3 | +2 to +4 |
| **Neutral, exposure 1.05** | **66/66, 59/59, 48/49, 36/37, 25/27** | **within 2–3** | **+2 to +4** |

AgX lifts the deepest skin by 9 L\* and drains its chroma, which flattens the
range toward the middle. That is the bias this work exists to remove. Neutral
holds the same small error at every tone. The studio preset therefore ships
`NeutralToneMapping` at exposure 1.05 (`STUDIO_TONE_MAPPING`,
`STUDIO_EXPOSURE`). These measurements replace recommendation 5 below where they
disagree.

---

## 6. Recommended changes in priority order

1. **Replace `MELANIN_ANCHORS`** with the 10 ISSA-derived diffuse albedos in
   §2.4. Re-check `DEFAULT_SKIN_TONE.melanin`. Credit ISSA (CC BY 4.0) in
   `NOTICE.md`.
2. **Set `ior: 1.4`** on `SkinMaterial` (F0 ≈ 0.028). Keep roughness 0.52.
   Allow a lower T-zone roughness, and an *oiliness* control that does not
   depend on melanin.
3. **Make `hkScatter` depend on melanin:** `mix((0.42, 0.20, 0.12), (0.32, 0.16, 0.075), m)`.
4. **Tint the sheen from the albedo and reduce it with melanin**
   (sheen `0.25 → 0.12`, `sheenColor` derived from the albedo).
5. **Studio preset and tone mapping.** Use a neutral fill and ambient, a
   large-area key, and a key-to-fill of 2:1–4:1. Switch to AgX, or prove
   Neutral with the parity test. Publish `skinReflectance`, `skinZoneEV` and
   `meterRegion` from the figure.
6. **Calibrate the modifiers.** Make undertone a symmetric ±3 b\* shift, and
   change the haemoglobin fade to `1 − 0.4·melanin`.

---

## 7. Sources

### Measurement and colour data

- Yan, L. et al. (2025). *The International Skin Spectra Archive (ISSA): a
  multicultural human skin phenotype and colour spectra collection.* Scientific
  Data. <https://www.nature.com/articles/s41597-025-04857-5>. Data (CC BY 4.0):
  <https://doi.org/10.6084/m9.figshare.28228571.v4>
- Monk Skin Tone Scale, Wikipedia (swatch table cites Google, *MST Swatches*,
  <https://skintone.google/get-started>):
  <https://en.wikipedia.org/wiki/Monk_Skin_Tone_Scale>
- Del Bino, S., Duval, C., Bernerd, F. (2018). *Clinical and Biological
  Characterization of Skin Pigmentation Diversity and Its Consequences on UV
  Impact.* IJMS 19(9):2668. <https://pmc.ncbi.nlm.nih.gov/articles/PMC6163216/>
- skinoptics, `colors` module (ITA thresholds):
  <https://skinoptics.readthedocs.io/en/latest/07_colors.html>
- Xiao, K. et al. (2017). *Characterising the variations in ethnic skin colours:
  a new calibrated data base for human skin.* Skin Res Technol 23(1):21–29.
  <https://eprints.whiterose.ac.uk/id/eprint/100718/>
- Wright, C. Y. et al. (2018). *Towards a reliable, non-invasive melanin
  assessment for pigmented skin.* Letter, Skin Res Technol, doi:10.1111/srt.12592.
  <https://repository.nwu.ac.za/bitstreams/72510b55-80fc-4fe0-b73f-ad49677f3489/download>
- Jacques, S. L. (1998). *Skin Optics.* OMLC News.
  <https://omlc.org/news/jan98/skinoptics.html>
- *Evaluating edge loss in the reflectance measurement of translucent
  materials.* <https://hal.archives-ouvertes.fr/hal-02956071>
- physicallybased.info materials API ("Skin I–VI"):
  <https://api.physicallybased.info/materials>

### Rendering literature

- Weyrich, T. et al. (2006). *Analysis of Human Faces using a Measurement-Based
  Skin Reflectance Model.* ACM TOG 25(3).
  <https://cdfg.csail.mit.edu/pdf/journal/2006-weyrich-analysis-of-human-faces-using-a-measurement-based-skin.pdf>
- Donner, C., Jensen, H. W. (2006). *A Spectral BSSRDF for Shading Human Skin.*
  EGSR. <https://cseweb.ucsd.edu/~henrik/papers/skin_bssrdf/skin_bssrdf.pdf>
- Jimenez, J. et al. (2010). *A Practical Appearance Model for Dynamic Facial
  Color.* ACM TOG 29(6). Melanin fraction range "0 − 0.5"; the example
  measurements are of Caucasian subjects.
  <https://www.iryoku.com/skincolor/downloads/A-Practical-Appearance-Model-for-Dynamic-Facial-Color.pdf>
- Kim, T. et al. (2022). *Countering Racial Bias in Computer Graphics Research.*
  SIGGRAPH Talks. <https://arxiv.org/abs/2103.15163>. Talk summary:
  <https://3dvf.com/en/siggraph-2021-how-can-we-move-towards-anti-racist-graphics-research/>
- Schneider, G. F. et al. (2026). *True to Tone? Quantifying Skin Tone Fidelity
  and Bias in Photographic-to-Virtual Human Pipelines.*
  <https://arxiv.org/abs/2604.02055>
- Khronos PBR Neutral tone mapper specification:
  <https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md>
- three.js `MeshPhysicalMaterial` docs:
  <https://threejs.org/docs/pages/MeshPhysicalMaterial.html>. Tone-mapping
  source (r186): `node_modules/three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js`

### Dermatology

- Uhoda, E. et al. (2003). *Skin weathering and ashiness in black Africans.*
  <https://orbi.uliege.be/handle/2268/11134>

### Photography and cinematography

- Google, *Real Tone*: <https://store.google.com/intl/en/ideas/real-tone/>
- Roth, L. (2009). *Looking at Shirley, the Ultimate Norm.* Canadian Journal of
  Communication 34(1). Citation and abstract:
  <https://just-tech.ssrc.org/citation/looking-at-shirley-the-ultimate-norm-colour-balance-image-technologies-and-cognitive-equity/>
- Harding, X. (2017). *Keeping 'Insecure' lit: HBO cinematographer Ava
  Berkofsky on properly lighting black faces.* Mic.
  <https://mic.com/articles/184244/keeping-insecure-lit-hbo-cinematographer-ava-berkofsky-on-properly-lighting-black-faces>
- PetaPixel (2017). *A Look at How HBO's 'Insecure' Lights Black Actors so
  Well.* <https://petapixel.com/2017/09/14/look-hbos-insecure-lights-black-actors>
- Parris, A. (2015). *Selma cinematographer Bradford Young's refreshing approach
  to lighting black skin.* CBC Arts. <https://www.cbc.ca/lite/story/1.3270970>
- Color chart, Wikipedia (summary of Roth's Shirley-card history):
  <https://en.wikipedia.org/wiki/Color_chart>
- Zone System, Wikipedia (Adams' zone descriptions):
  <https://en.wikipedia.org/wiki/Zone_System>
