# Algorithmic, colour-agnostic surface appearance

Research notes for moving humanoid-kit's surface appearance from hand-set,
skin-specific constants to functions of the surface colour itself. The library
has to render any colour faithfully: human skin across the measured range,
fur, scales, and fantasy colours (blue, green, near-black, near-white,
saturated). The companion document `SKIN-RENDERING.md` covers measured human
skin colour, the specular layer, the studio stage and tone mapping. This
document builds on it and does not repeat it.

The code this concerns:

- `src/render/skinMaterial.ts`: `MeshPhysicalMaterial` with the direct diffuse
  line replaced by a per-channel wrapped diffuse, `hkScatter`.
- `src/surface/skinTone.ts`: albedo from 10 measured ISSA anchors, or an
  explicit `override` colour.
- `e2e/colour-parity.spec.ts`: the current parity gate.

Labelling follows `SKIN-RENDERING.md`. Formulas in quotation or code blocks
attributed to a source were checked against that source's text (the PDFs were
downloaded and their text extracted; the URLs are in §7). Numbers marked
*computed here* come from the scripts described in §6.3. Everything else is a
recommendation and is labelled as one.

---

## 1. Summary

1. **The current wrapped diffuse adds light and shifts hue, and the shift does
   not depend on the surface colour.** `SkinMaterial` uses
   `clamp((N·L + w) / (1 + w), 0, 1)`, the wrap model that Steve McAuley showed
   is not energy-conserving. On a sphere lit 45° from the camera it raises red
   by 20–25%, green by 10–13% and blue by 5–8% (computed here, §2.6). Because
   `setAppearance` derives `hkScatter` from `tone.melanin` even when
   `tone.override` is set, every fantasy colour gets a skin-coloured red wrap.
   Golden fur shifts ΔE00 4.0 and near-white fur ΔE00 4.8 at a 45° key.
2. **Scatter distance can be derived from albedo alone.** Chiang, Kutz and
   Burley (2016) map surface albedo A to single-scattering albedo α.
   Christensen and Burley (2015) map A to the scale factor s that turns a mean
   free path into Burley's profile width d. Chained with one scalar scattering
   length, they give a per-channel d for any colour. For the lightest ISSA skin
   anchor this gives channel ratios 1 : 0.53 : 0.36 (computed here), close to
   the hand-set `hkScatter` ratios 1 : 0.48 : 0.29.
3. **One scalar, pigment depth, covers layered materials such as skin.** Skin
   keeps its pigment above the scattering dermis. Mixing the albedo
   geometrically toward an unpigmented substrate with weight p = 0.75
   reproduces the practitioner reduction in skin scatter radius from types
   I–III to IV–VI to within 0.07 per channel (computed here, §2.3).
4. **Wrap amount should come from scatter distance times curvature.**
   Pre-integrating Burley's profile over a sphere (Penner's method) and fitting
   an energy-conserving wrap gives `w(x) = 2.0246·x^1.2997 / (1 + 1.3543·x^1.2997)`
   with x = d/r (computed here, §2.4). The hand-set red wrap 0.42 corresponds to
   d/r ≈ 0.38. For skin with d ≈ 0.7 mm in red, that is a radius of about
   2 mm: an ear rim, not a cheek. On a cheek (r ≈ 60 mm) the physical wrap is
   about 0.006.
5. **A tractable biophysical model does not reproduce the ISSA anchors well
   enough to replace them.** A two-parameter Beer–Lambert/Kubelka–Munk model in
   the style of Alotaibi and Smith (2017), fitted per anchor, misses by ΔE00
   3.2–3.4 at the light end and up to 9.5 at the deep end (computed here, §3.3). Adding a
   neutral 3% surface floor brings every anchor under ΔE00 3.6, but only by
   driving the fitted haemoglobin to zero at the deep end, which the
   measurements contradict. Keep the measured anchors as the source of truth.
   A Jimenez-style 2D lookup table is the right shape for flush and pallor
   edits, and it should be calibrated so its melanin path passes through the
   anchors.
6. **Fur colour has a published colour-to-absorption inversion.** Chiang et al.
   (2016) fit `σa = (ln C / (5.969 − 0.215βN + 2.532βN² − 10.73βN³ + 5.574βN⁴ + 0.245βN⁵))²`
   from the desired multiple-scattering colour C and azimuthal roughness βN.
   That one function lets the same base colour drive the diffuse, TT and TRT
   terms of a real-time fur shader.
7. **Scales need no new model, but they need two parity checks.** three's
   clearcoat scales all underlying light by `(1 − clearcoat·Fcc)` with a fixed
   F0 of 0.04. Iridescence replaces the Fresnel term with a coloured one, and
   three's diffuse is weighted by `(1 − F)`, so the diffuse picks up the
   complementary hue.
8. **The parity test should separate shading from display.** §5 proposes three
   stages: linear shading fidelity on an analytic sphere read from a half-float
   render target (three skips tone mapping for render targets), the tone-mapped
   output against the tone-mapped expectation, and the existing fairness check
   across faces. The CIEDE2000 implementation used here reproduces Sharma's 34
   published test pairs to within 5×10⁻⁵ (computed here) and should be the
   test's colour difference.

---

## 2. Albedo-driven subsurface scattering

### 2.1 What the sources establish

**Burley's normalized diffusion** (Burley 2015, Eq. 5–6):

```text
Rd(r) = (e^(−r/d) + e^(−r/(3d))) / (8π d r)

∫₀^2π ∫₀^∞ Rd(r) r dr dφ = 1
```

Burley: "Because our profile is normalized, we can achieve our desired diffuse
color simply by multiplying the integrated result at the end by baseColor,
avoiding the need for albedo inversion and guaranteeing consistency with our
diffuse BRDF." The profile's shape is the same in every channel; only d
changes. That is what makes a colour-agnostic real-time approximation possible.
One table of the unit profile's effect serves every channel of every colour.

**Christensen and Burley (2015)** relate d to physical scattering lengths
through a scale factor s(A) of the surface albedo A, with `d = ℓ/s`:

```text
R(r) = A s (e^(−s r/ℓ) + e^(−s r/(3ℓ))) / (8π ℓ r)                (Eq. 3)
```

They give three fits, depending on the illumination model and on which length
ℓ is used:

| Configuration | Length ℓ | s(A) | Mean relative error of the fit |
| --- | --- | --- | --- |
| Searchlight (light enters perpendicular) | volume mean free path | s = 1.85 − A + 7 \|A − 0.8\|³ (Eq. 5) | 5.5% |
| Diffuse surface transmission | volume mean free path | `s = 1.9 − A + 3.5 (A − 0.8)²` (Eq. 6) | 3.9% |
| Searchlight | diffuse mean free path ℓd | `s = 3.5 + 100 (A − 0.33)⁴` (Eq. 8) | 7.7% |

On the second form, they note that diffuse transmission "may be a more
appropriate model for rough surface materials such as dry (nonsweaty) skin" and
that "in practical VFX and CG animation work this distinction might not be
particularly important."

**Chiang, Kutz and Burley (2016)** invert surface albedo to single-scattering
albedo for a semi-infinite slab with isotropic scattering and a diffuse
interface, and use Eq. 6 above for the length:

```text
α  = 1 − e^(−5.09406A + 2.61188A² − 4.31805A³)    (1)
s  = 1.9 − A + 3.5 (A − 0.8)²                     (2)
σt = 1 / (d s)                                    (3)
```

Their premise: "on a semi-infinite slab, the single-scattering albedo, α, is
then the only factor affecting the multiple-scattering albedo A while the
extinction coefficient, σt, merely scales the path lengths and hence only
affects the translucency."

**Real-time use.** Golubev (Unity, SIGGRAPH 2018) implemented Burley's profile
in screen space and states the convergence condition that matters here: "A
diffuse BRDF approximates SSS when the scattering distance is within the
footprint of the pixel." Unity also "directly use[s] the surface albedo as the
volume albedo" to keep the two consistent.

### 2.2 From albedo to a per-channel scatter distance

The chain below turns any linear albedo into a per-channel d. It needs one
material property, the scattering mean free path ℓs = 1/σs (a length, in scene
units), plus an optional spectral slope.

1. Clamp the albedo: `A_c = clamp(albedo_c, 0.001, 0.999)`.
2. Single-scattering albedo, Chiang Eq. 1: `α_c = 1 − exp(−5.09406A + 2.61188A² − 4.31805A³)`.
3. Volume mean free path. With scattering fixed and absorption carrying the
   colour, `σt,c = σs,c / α_c`, so `ℓ_c = α_c · ℓs,c`.
4. Optional spectral slope of scattering, `ℓs,c = ℓs · (λ_c / 550 nm)^b`, with
   representative wavelengths λ = 612, 549 and 465 nm for linear-sRGB red,
   green and blue. This is a recommendation. The wavelengths are an
   approximation of the sRGB primaries, and b comes from the skin data below.
5. Profile width, Christensen–Burley Eq. 6: `d_c = ℓ_c / s(A_c)`.

**Choosing b.** Reduced scattering falls with wavelength in tissue. Implied
slopes between the red and blue channels (computed here, using the wavelengths
above): Jensen et al. 2001 "Skin1" σs′ = (0.74, 0.88, 1.01) mm⁻¹ gives b ≈ 1.1;
"Skin2" (1.09, 1.59, 1.79) gives b ≈ 1.8; Donner and Jensen's
`σ′s(λ) = 14.74λ^−0.22 + 2.2 × 10^11 × λ^−4` gives b ≈ 1.8. b = 1.4 sits in that
range and is used below. Set b = 0 for media with no spectral scattering
preference.

**Check against measured skin.** Jensen et al. (2001) tabulate Skin1 as
σs′ = (0.74, 0.88, 1.01) mm⁻¹, σa = (0.032, 0.17, 0.48) mm⁻¹, diffuse
reflectance (0.44, 0.22, 0.13). Using their measured reflectance as A and
`ℓ = 1/(σs′ + σa)`, Eq. 5 gives d = (0.75, 0.32, 0.18) mm (computed here). Burley
(2015, Fig. 8) fits a Monte Carlo profile of the red channel as
`0.031 exp(−0.41 r) + .02 exp(−1.7 r)`, which corresponds to d ≈ 0.6–0.8 mm.
The chain above, with ℓs = 1/0.88 mm = 1.14 mm and b = 1.4, gives
d = (0.70, 0.37, 0.25) mm for the lightest ISSA anchor (computed here).

**Channel ratios for the parity palette** (computed here; d relative to the
largest channel, b = 1.4):

| Swatch | Linear albedo | α (Chiang) | d ratio R : G : B |
| --- | --- | --- | --- |
| skin, melanin 0 | 0.498, 0.322, 0.271 | 0.911, 0.780, 0.720 | 1 : 0.53 : 0.36 |
| skin, melanin 0.5 | 0.298, 0.148, 0.081 | 0.753, 0.508, 0.327 | 1 : 0.44 : 0.20 |
| skin, melanin 1 | 0.092, 0.040, 0.024 | 0.362, 0.181, 0.114 | 1 : 0.39 : 0.19 |
| white fur | 0.78, 0.76, 0.72 | 0.988, 0.986, 0.980 | 1 : 0.84 : 0.63 |
| near-black scales | 0.025, 0.025, 0.030 | 0.118, 0.118, 0.140 | 1 : 0.86 : 0.80 |
| green scales | 0.07, 0.22, 0.06 | 0.292, 0.647, 0.257 | 0.41 : 1 : 0.24 |
| blue skin | 0.06, 0.11, 0.36 | 0.257, 0.414, 0.817 | 0.27 : 0.41 : 1 |
| red fur | 0.42, 0.06, 0.035 | 0.864, 0.257, 0.161 | 1 : 0.13 : 0.06 |

For comparison, the hand-set `hkScatter` at melanin 0 is (0.42, 0.20, 0.12),
or 1 : 0.48 : 0.29, and the physicallybased.info skin radius for types I–III
is (0.482, 0.169, 0.109), or 1 : 0.35 : 0.23. The albedo chain lands between
them without any per-material tuning, and the same chain makes blue skin
scatter furthest in blue and green scales in green.

### 2.3 Layered pigment: one scalar for skin

In skin, melanin sits in a thin epidermis above a scattering dermis whose
optical properties vary much less between people. Jimenez et al. (2010) render
this way: "we perform a standard subsurface scattering simulation using
parameters for colorless skin. We then modulate the resulting value with the
color from the lookup table". A homogeneous inversion instead treats all of the
darkening as absorption inside the scattering medium. It shortens the scatter
distance far too much on deep skin: at melanin 1 it gives a red d of 0.135 mm,
5.2 times shorter than at melanin 0 (computed here).

**Recommendation.** Compute d from an albedo mixed geometrically toward an
unpigmented substrate:

```text
A_scatter,c = A_c^(1 − p) · substrate_c^p
```

p = 0 is pigment mixed through the scattering medium (homogeneous; fantasy
pigments, wax, scales). p = 1 is all pigment above it (the scatter is the
substrate's, and the albedo only tints the result). For human skin, with the
melanin-0 ISSA anchor as the substrate, p was fitted so that the ratio
d(melanin 0.8) / d(melanin 0.2) matches the physicallybased.info reduction from
skin I–III `[0.482, 0.169, 0.109]` to IV–VI `[0.367, 0.137, 0.068]`, which is
(0.76, 0.81, 0.62) (computed here):

| p | ratio R | ratio G | ratio B |
| --- | --- | --- | --- |
| 0 (homogeneous) | 0.37 | 0.30 | 0.21 |
| 0.5 | 0.58 | 0.54 | 0.46 |
| **0.75 (best fit)** | **0.76** | **0.74** | **0.69** |
| 1 | 1.00 | 1.00 | 1.00 |
| target | 0.76 | 0.81 | 0.62 |

With p = 0.75, ℓs = 1.14 mm and b = 1.4, skin d runs from (0.70, 0.37, 0.25) mm
at melanin 0 to (0.44, 0.23, 0.14) mm at melanin 1 (computed here). The red-to-blue
spread stays similar while the overall distance shortens, which matches
Weyrich et al.'s finding that "Subjects with skin type V and VI have higher
absorption and lower scattering coefficients than subjects with skin type II or
III" (quoted in `SKIN-RENDERING.md` §3.2). The single fitted number replaces the
hand-set `mix((0.42, 0.20, 0.12), (0.32, 0.16, 0.075), m)`.

### 2.4 From scatter distance to a real-time diffuse term

**Penner's pre-integration** (SIGGRAPH 2011 Advances course; GPU Pro 2). The
slides list the problems with wrap lighting: "Not based on real skin diffusion
profiles" and "Biggest problem: doesn't account for curvature/thickness!"
Penner's fix is to "Integrate all incoming light on a sphere (or a ring, it's
easier)" for each light angle and curvature, and bake the result into a 2D
table indexed by N·L and curvature. The slide's diagram labels the chord
between two points on the sphere as `2r sin(θ/2)`. Curvature comes from screen
derivatives, `c = length(fwidth(N)) / length(fwidth(p))` in the slide's code,
and the notes warn that "shader derivatives are constant within a triangle"
and suggest storing curvature in vertices or a texture instead.

The integral used here is the sphere form. For a point whose normal makes angle
θ with the light, on a sphere of radius r, a neighbour at polar angle ψ and
azimuth φ around it has a normal at angle cos⁻¹(cos θ cos ψ + sin θ sin ψ cos φ)
to the light and sits at chord distance 2r sin(ψ/2):

```text
D(θ, r) = ∫₀^π ∫₀^2π max(0, cos θ cos ψ + sin θ sin ψ cos φ) Rd(2r sin(ψ/2)) r² sin ψ dφ dψ
          ─────────────────────────────────────────────────────────────────────────────────
                         ∫₀^π ∫₀^2π Rd(2r sin(ψ/2)) r² sin ψ dφ dψ
```

D depends only on θ and x = d/r, so one table serves every channel of every
colour; each channel looks it up at its own x_c = d_c · κ.

**Values** (computed here, Burley's profile, 4000 × 256 quadrature):

| x = d/r | D(0°) | D(90°) | D(110°) | best energy-conserving wrap w | RMS error of that wrap |
| --- | --- | --- | --- | --- | --- |
| 0.01 | 0.999 | 0.008 | 0.000 | 0.001 | 0.001 |
| 0.05 | 0.983 | 0.039 | 0.002 | 0.020 | 0.006 |
| 0.10 | 0.934 | 0.074 | 0.017 | 0.077 | 0.015 |
| 0.20 | 0.828 | 0.119 | 0.052 | 0.224 | 0.031 |
| 0.30 | 0.758 | 0.143 | 0.076 | 0.352 | 0.041 |
| 0.50 | 0.678 | 0.166 | 0.103 | 0.539 | 0.050 |
| 1.00 | 0.595 | 0.187 | 0.132 | 0.836 | 0.054 |
| 2.00 | 0.539 | 0.200 | 0.151 | 1.137 | 0.047 |

Two things follow.

- **Scattering dims the lit side as well as lighting the terminator.** D(0°)
  falls below 1 as x grows. The non-normalised wrap in `SkinMaterial` cannot
  represent that: it always equals 1 at N·L = 1 and only adds light elsewhere.
  Fitted against the table, the best non-normalised wrap is w ≤ 0.002 at every
  x (computed here): any wrap of that form makes the fit worse.
- **The energy-conserving wrap fits well.** McAuley's form, as quoted by Hill,
  is `saturate((dot(N, L) + w) / ((1 + w) * (1 + w)))`. Its peak is 1/(1 + w),
  which tracks the dimming. Its worst RMS error against the pre-integrated
  curve is 0.054 of the lit value.

**Closed form for w** (computed here, least squares over the table):

```text
w(x) = 2.0246 · x^1.2997 / (1 + 1.3543 · x^1.2997)     max |error| 0.036 in w
```

A simpler `w(x) = 1.368 (1 − e^(−0.953 x))` has a maximum error of 0.047.

**What this says about scale** (computed here; scene units are metres, so κ is
in m⁻¹; skin at melanin 0 with d = (0.70, 0.37, 0.25) mm):

| Feature (radius) | x in red | w (R, G, B) |
| --- | --- | --- |
| cheek (60 mm) | 0.012 | 0.006, 0.003, 0.002 |
| jaw, brow (25 mm) | 0.028 | 0.019, 0.009, 0.005 |
| nose tip (8 mm) | 0.088 | 0.081, 0.037, 0.022 |
| ear rim, nostril (3 mm) | 0.23 | 0.254, 0.124, 0.075 |
| eyelid margin (1 mm) | 0.70 | 0.688, 0.408, 0.271 |

The hand-set red wrap 0.42 inverts to x ≈ 0.38, and the blue wrap 0.12 to
x ≈ 0.12. On a smooth face mesh that is roughly 100 times the physically
supported wrap at the cheek. Some of the extra softening the hand-set value
gives may stand in for detail the mesh does not resolve (pores, fine wrinkles).
Penner treats that detail separately, by pre-filtering the normal map per
channel ("Pre-filter new normal maps for R/G/B using our skin profile again"),
which is also colour-agnostic once it is driven by d_c.

### 2.5 Proposed replacement for `hkScatter`

**Recommendation.** Replace the uniform `hkScatter` with per-material inputs
and a per-fragment function. Inputs:

| Uniform | Meaning | Skin default | Fantasy default |
| --- | --- | --- | --- |
| `hkScatterMfp` | scattering mean free path ℓs, metres; 0 disables | 1.14e-3 | 1.14e-3, or per material class |
| `hkScatterSlope` | spectral slope b | 1.4 | 1.4, or 0 for spectrally flat media |
| `hkPigmentDepth` | p in §2.3 | 0.75 | 0 |
| `hkSubstrate` | unpigmented substrate albedo (linear) | ISSA melanin-0 anchor | unused when p = 0 |
| `vHkCurvature` | mean curvature κ, m⁻¹, per vertex | from the mesh | from the mesh |

```glsl
// Chiang, Kutz & Burley 2016, Eq. 1: surface albedo -> single-scattering albedo.
vec3 hkSingleScatterAlbedo( vec3 A ) {
  return 1.0 - exp( -5.09406 * A + 2.61188 * A * A - 4.31805 * A * A * A );
}

// Christensen & Burley 2015, Eq. 6 (diffuse surface transmission).
vec3 hkProfileScale( vec3 A ) {
  vec3 t = A - 0.8;
  return 1.9 - A + 3.5 * t * t;
}

// Per-channel Burley profile width d, in the units of hkScatterMfp.
vec3 hkScatterDistance( vec3 albedo ) {
  vec3 A = clamp( albedo, vec3( 0.001 ), vec3( 0.999 ) );
  // Pigment above the scattering layer: scatter as the substrate does (Section 2.3).
  A = pow( A, vec3( 1.0 - hkPigmentDepth ) ) * pow( clamp( hkSubstrate, 0.001, 0.999 ), vec3( hkPigmentDepth ) );
  // Scattering length per channel; representative wavelengths 612, 549, 465 nm.
  vec3 ls = hkScatterMfp * pow( vec3( 1.1127, 0.9982, 0.8455 ), vec3( hkScatterSlope ) );
  return hkSingleScatterAlbedo( A ) * ls / hkProfileScale( A );
}

// Energy-conserving wrap fitted to Penner-style pre-integration of Burley's profile.
vec3 hkWrapFromScatter( vec3 d, float curvature ) {
  vec3 y = pow( d * curvature, vec3( 1.2997 ) );
  return 2.0246 * y / ( 1.0 + 1.3543 * y );
}
```

And in the replaced direct diffuse line:

```glsl
float hkNdotL = dot( geometryNormal, directLight.direction );
vec3 hkW = hkWrapFromScatter( hkScatterDistance( material.diffuseContribution ), vHkCurvature );
vec3 hkWrapped = max( vec3( hkNdotL ) + hkW, 0.0 ) / ( ( 1.0 + hkW ) * ( 1.0 + hkW ) );
reflectedLight.directDiffuse += hkWrapped * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
```

Notes on the design:

- **Per fragment, not per material.** The lip, flush and areola masks change
  the albedo per fragment in `color_fragment`, so d must follow
  `material.diffuseContribution`. The cost is three `exp` and two `pow` per
  channel group, once per fragment if hoisted out of the light loop.
- **A lookup table is the higher-quality variant** (implemented, at a different
  size and layout; see the note below). The table in §2.4 can ship
  as a 64 × 32 single-channel half-float `DataTexture` (θ by x, generated
  offline by a deterministic script) and be sampled three times, at x_r, x_g
  and x_b. That keeps the exact pre-integrated shape, including the dimmed lit
  side, instead of the wrap fit's 0.05 RMS approximation.

  **Decided and implemented: the table.** Measured on the figure's own
  curvatures (`scripts/research/preintegration.ts`: median 26 m⁻¹, 90th
  percentile 113, 99th 354) over the 11 skin anchors, the wrap fit missed the
  exact integral by up to ΔE00 2.8 at the 90th percentile and 4.8 at the 99th
  even with a fill light of 15 % of the key added to both (12.7 and 16.4
  without): it cuts off the soft red light just past the terminator that is
  most of what scatter does on noses, ears, lips and fingers. The shader now
  samples `src/surface/scatterTable.ts` (generated by
  `scripts/generate-scatter-table.ts` from `src/surface/preintegration.ts`):
  129 columns of N·L, so N·L = 0 falls on a texel centre, by 64 rows of
  u = x/(x + 0.25), holding the residual D − max(N·L, 0) so the exact Lambert
  knee is added back in the shader. Interpolated, it is within 0.00064 of the
  integral (ΔE00 ≤ 0.03 on the anchors at every curvature quantile), and a
  test regenerates it byte for byte. On the figure the change is confined to
  the tightest curves: ear folds shade softer and warmer (up to ΔE00 4.1),
  the rest of the head moves by a mean ΔE00 of 0.06.
- **Curvature.** Prefer a per-vertex mean curvature attribute computed with the
  evaluated geometry, so it follows shape changes and
  subdivision. Penner's `fwidth` estimate is a fallback; it is constant per
  triangle and noisy at silhouettes.
- **Coverage.** The replaced line covers punctual and directional lights. three
  r186 evaluates rect-area lights in a separate line
  (`reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate(...)`)
  and indirect light in `RE_IndirectDiffuse_Physical`, neither of which this
  patch reaches. `SKIN-RENDERING.md` §4.3 recommends a large-area key, so a
  rect-area key would bypass the scatter term. Hill's "Righting Wrap (Part 1)"
  gives the spherical-harmonic kernel for carrying the wrap into environment
  lighting if that is wanted.
- **Sheen should follow the albedo too.** `sheen = 0.25 − 0.13·m` uses melanin,
  so overrides get the default 0.35. A colour-agnostic replacement is a function
  of luminance Y, which is the quantity melanin was standing in for, for
  example `sheen = mix(0.12, 0.25, smoothstep(0.050, 0.355, Y))`, the ISSA
  anchor luminance range (recommendation).

### 2.6 Pitfalls

**The current wrap's colour shift** (computed here). A sphere seen from +z, lit
by one directional light at the given angle from the camera, averaged over the
visible disc and weighted by projected area. Gains are the wrap's channel
brightness relative to Lambert. Overrides use the default melanin 0.35.

| Swatch | Gains R, G, B (45° key) | ΔE00 at 0° | ΔE00 at 45° | ΔE00 at 70° |
| --- | --- | --- | --- | --- |
| skin, melanin 0 | 1.249, 1.129, 1.080 | 2.7 | 4.3 | 6.4 |
| skin, melanin 1 | 1.197, 1.105, 1.051 | 1.1 | 1.8 | 2.6 |
| white fur | 1.231, 1.121, 1.070 | 2.9 | 4.8 | 7.1 |
| golden fur | 1.231, 1.121, 1.070 | 2.5 | 4.0 | 5.9 |
| red fur | 1.231, 1.121, 1.070 | 1.7 | 2.8 | 4.2 |
| blue skin | 1.231, 1.121, 1.070 | 0.9 | 1.4 | 2.1 |
| near-black scales | 1.231, 1.121, 1.070 | 0.9 | 1.4 | 2.2 |

Part of each ΔE00 is lightness (the wrap adds light). With luminance
normalised away, the chromatic part alone is still ΔE00 3.6 for white fur and
2.2 for light skin at 45°. On near-white the hue rotates 23° toward red, which
reads as a pink cast on white fur.

**Very dark colours.** A near-black homogeneous material has α ≈ 0.12 and a d
about 30 times shorter than white's. Its wrap goes to zero, which is correct
for black plastic or obsidian scales. When the darkness is a pigment layer over
paler tissue (deep skin, dark-scaled skin over flesh), use p > 0, or the
terminator loses its warmth entirely. For both, the specular layer dominates:
at A = 0.025 the F0 0.028 surface reflection exceeds the diffuse.

**Very saturated colours.** One channel near zero gets a near-zero d, so the
terminator glows only in the dominant channel. That is physical (red wax glows
red), and with the energy-conserving wrap the lit-side average hue is
preserved. A parity test must therefore measure hue on the lit side
(N·L ≥ 0.7) and treat the terminator separately (§5.3).

**Near-white colours.** α approaches 1 and d is at its largest, so thin
features (ears, fingers) glow strongly. The A ≤ 0.999 clamp keeps α finite.
Scenes that need snow-white fur to stay crisp should lower `hkScatterMfp`
rather than the albedo.

**Out-of-gamut and negative channels.** A colour converted from a wide-gamut
source can have negative linear-sRGB channels (the ColorChecker cyan patch has
R = −0.044, computed here, §5.1). Clamp before the chain.

**Tone mapping.** Khronos PBR Neutral reproduces base colours only where every
channel is between 0.08 and 0.8 (`SKIN-RENDERING.md` §5.2). Saturated and dark
swatches have channels below 0.08 by construction, so their display error
measures the tone curve, not the material. §5 separates the two.

---

## 3. Biophysical skin colour models

### 3.1 The models

**Donner and Jensen (2006).** Two layers (epidermis, dermis) with spectral
absorption and scattering from four parameters, rendered with the multipole
diffusion model:

```text
σa^em(λ) = 6.6 × 10^11 × λ^−3.33                                    (3)
σa^pm(λ) = 2.9 × 10^14 × λ^−4.75                                    (4)
σa^baseline(λ) = 0.0244 + 8.53 e^(−(λ−154)/66.2) mm^−1              (5)
σa^epi(λ) = Cm (βm σa^em(λ) + (1 − βm) σa^pm(λ)) + (1 − Cm) σa^baseline   (6)
σa^derm(λ) = Ch (γ σa^oxy(λ) + (1 − γ) σa^deoxy(λ)) + (1 − Ch) σa^baseline (7)
σ′s(λ) = 14.74 λ^−0.22 + 2.2 × 10^11 × λ^−4                         (8)
```

Parameters: Ch "Hemoglobin fraction" 0.001–0.1, Cm "Melanin fraction" 0–0.5,
βm "Melanin type blend" 0–1, ρs "Oiliness" 0–1; γ fixed at 0.75; epidermis
0.25 mm; "a constant index of refraction of 1.4". The paper labels Eq. 3–4 in
mm⁻¹, while Jacques (OMLC 1998) gives the same eumelanin law in cm⁻¹
("mua.mel = (6.6 x 10^11)(nm^(-3.33)) [cm-1]"). The computation in §3.3 follows
Jacques' units. The authors tried RGB coefficients and found it "tends to
overly smooth the effective spectra", so they stay spectral (2 nm steps,
400–700 nm) and convert at the end with "the standard CIE 2° color matching
functions, with the D65 illuminant".

**Jimenez et al. (2010).** Uses the Donner et al. (2008) spectral model offline
to fill a 2D RGB lookup table: "we use a precomputed skin color lookup table
that is indexed by the local value in the melanin and hemoglobin parameter
maps". Table 1 ranges: Cm 0–0.5, βm 0–1, Che 0–0.1, Chd 0–0.32, with
"Che = 0.25Chd" and a melanin blend of "61% eumelanin and 39% pheomelanin". The
axes are cube-root spaced: "u = ∛Cm, v = ∛Chd". Scattering uses "parameters for
colorless skin" and the LUT colour modulates the result.

**Iglesias-Guitian et al. (2015).** A "time-varying, multi-layered
biophysically-based model of the optical properties of human skin" for ageing,
drivable by "higher-level parameters such as age, gender, skin care or skin
type", and usable "with any rendering algorithm that uses diffusion profiles".
It has more layers (stratum corneum, epidermis, papillary and reticular dermis)
and chromophores (carotene, bilirubin) than Donner and Jensen. That makes it the
right reference for ageing, but its parameter space is too large for a small
LUT.

**Alotaibi and Smith (2017).** Deliberately two free parameters (blood volume
fraction and melanosome volume fraction) "so that the model can be fitted to
colour RGB data". The epidermis is Beer–Lambert, `Tepidermis(λ) = e^(−µa.epidermis(λ))`;
the dermis is Kubelka–Munk; and "Rtotal (fmel, fblood, λ) = Tepidermis (fmel, λ)² Rdermis (fblood, λ)",
"squared because the light is transmitted through the epidermis twice". Their
ranges: blood 2–7%, melanosomes 1–43%. Closed-form and cheap, so it can be
evaluated directly in TypeScript, but it has no epidermal backscatter (they
"ignore reflections from the epidermis").

**Aliaga, Hery and Xia (2022).** A Monte Carlo two-layer model over a 5D space
(melanin and blood fractions, epidermal thickness, melanin type ratio,
haemoglobin type ratio), sampled "cubicly (∛Vm) and quarticly (∜Vb)". They
first tried a lookup tensor and found that "The LUT approach suffers from
quantization in the estimated parameters maps even for large tensors", so they
moved to a neural inverse. They allow melanin and haemoglobin "to go beyond the
usual values for human adults" to cover lips, veins and freckles.

### 3.2 Tractability as a small LUT

| Model | Forward cost | Free parameters | As a small LUT | Inverse (RGB → parameters) |
| --- | --- | --- | --- | --- |
| Donner & Jensen 2006 | spectral multipole, seconds per parameter set | 4 | yes, offline; the Jimenez table is exactly this | not provided |
| Jimenez et al. 2010 | texture fetch | 2 (Cm, Chd) | **is** a 2D LUT | not needed |
| Iglesias-Guitian et al. 2015 | multi-layer spectral | many | no, too many dimensions | not provided |
| Alotaibi & Smith 2017 | closed form, 33 wavelengths | 2 | not needed; evaluate directly | least squares |
| Aliaga et al. 2022 | Monte Carlo | 5 | quantizes, per the authors | neural |

### 3.3 Does a tractable model reproduce the ISSA anchors?

Computed here: an implementation of the Alotaibi–Smith structure, with
coefficients from Jacques (melanin, baseline), Donner and Jensen (pheomelanin),
Prahl's tabulated molar extinction of oxy- and deoxyhaemoglobin (OMLC), the
Alotaibi–Smith dermal scattering `2×10^5·λ^−1.5 + 2×10^12·λ^−4` cm⁻¹, epidermis
0.21 mm, dermis 2 mm, oxygenation 0.75, 400–700 nm in 10 nm steps, CIE 1931 2°
and D65, then linear sRGB. Melanin and blood fractions were fitted per anchor by
minimising ΔE00 against the anchor.

| Variant | Mean ΔE00 | Max ΔE00 | Light anchors | Deep anchors |
| --- | --- | --- | --- | --- |
| As published structure | 5.8 | 9.5 | 3.2–3.4 | 8.0–9.5 |
| Eumelanin only | 5.7 | 9.5 | 3.2–3.4 | 7.9–9.5 |
| Plus neutral surface floor c = 0.02 | 3.5 | 4.5 | 3.1–3.4 | 2.0–3.7 |
| Plus neutral surface floor c = 0.03 | 2.6 | 3.6 | 3.0–3.3 | 0.1–1.5 |

The surface floor is `R = c + (1 − c)·T²·R_dermis`. It stands for diffuse
backscatter from the stratum corneum, which the published model ignores.

Findings:

- **Deep skin comes out too red and too blue-starved without a floor.** At the
  deepest anchor the model's blue channel collapses to about 0 against the
  measured 0.024. That is the same "rust" failure that `SKIN-RENDERING.md` §2.4
  found in the old hand-picked anchors.
- **The floor fixes the colour but not the physiology.** With c = 0.03 the fit
  drives haemoglobin to 0–0.3% for the three deepest anchors, while ISSA shows
  facial a\* nearly constant (8.7–11.7) across the whole range. A good colour
  match with impossible parameters means the model is not identifying the
  physiology, so its haemoglobin axis cannot be trusted for flush on deep skin.
- **At the light end the model wants more red.** The best fits put red at
  0.58 against the anchor's 0.498. That is consistent with the edge-loss caveat
  in `SKIN-RENDERING.md` §2.3 (contact measurements under-read red on light
  skin), but this computation does not prove it.

**Recommendation.** Keep the 10 measured anchors as the albedo of record. Use a
biophysical table only for *changes* from the anchor: flush, pallor and
undertone directions. If a Jimenez-style table is adopted, build it offline
from a spectral layered model (Donner–Jensen or Aliaga–Hery–Xia), then warp its
melanin axis so the melanin path at typical haemoglobin passes through the ISSA
anchors, and check every anchor at ΔE00 ≤ 1 in a unit test. A 32 × 32 RGB table
in cube-root axes, as Jimenez uses, is about 3 KB as half floats.

---

## 4. Fur and scales

### 4.1 Fibre reflectance models

**Kajiya and Kay (1989).** The strand tangent T replaces the normal. In
Scheuermann's GDC 2004 real-time formulation, the diffuse term is
"Kajiya-Kay diffuse term sin(T, L)" (noted as looking "too bright without
proper self-shadowing") and the specular is:

```glsl
float StrandSpecular (float3 T, float3 V, float3 L, float exponent)
{
float3 H = normalize(L + V);
float dotTH = dot(T, H);
float sinTH = sqrt(1.0 - dotTH*dotTH);
float dirAtten = smoothstep(-1.0, 0.0, dot(T, H));
return dirAtten * pow(sinTH, exponent);
}
```

Scheuermann shifts the tangent toward the normal by different amounts for two
lobes (`shiftedT = T + shift * N`) to imitate Marschner's shifted primary and
secondary highlights.

**Marschner et al. (2003).** Three lobes: surface reflection R, transmission TT,
and internal reflection TRT. Fibre "index of refraction η of approximately
1.55". Table 1:

| Parameter | Purpose | Typical value |
| --- | --- | --- |
| αR | longitudinal shift, R lobe | −10° to −5° |
| αTT | longitudinal shift, TT lobe | −αR/2 |
| αTRT | longitudinal shift, TRT lobe | −3αR/2 |
| βR | longitudinal width (stdev), R lobe | 5° to 10° |
| βTT | longitudinal width, TT lobe | βR/2 |
| βTRT | longitudinal width, TRT lobe | 2βR |
| wc | azimuthal width of caustic | 10° to 25° |

Absorption along an internal path: `T(σa, h) = exp(−2σa(1 + cos(2γt)))`.

**d'Eon et al. (2011).** An energy-conserving longitudinal function to replace
Marschner's Gaussian, which "creates extra energy for grazing angles":

```text
Mp(v, θi, θr) = csch(1/v) / (2v) · e^(sin(−θi) sin θr / v) · I0(cos(−θi) cos θr / v)     (7)
```

where "v = β² is the roughness variance and Io(x) is the modified Bessel function
of the first kind".

**Yan et al. (2015).** Fur differs from hair: "Fur has a distinct diffusive and
saturated appearance, that is not captured by either the Marschner hair model or
the Kajiya-Kay model." The cause is the medulla, a scattering core that is
large in animal fur ("for human hair, the medulla has minimal width and thus
negligible contributions"). Their double-cylinder model precomputes medulla
scattering profiles.

**Yan et al. (2017).** Reduces the fur model to "only 5 lobes", keeping
"the traditional R, TT, and TRT lobes in hair" plus scattered lobes TTs and
TRTs, with the precomputed data compressed "to only 150 KB". Still a
path-tracing model; for WebGL2 its practical lesson is that fur needs a
coloured, diffuse, medulla-scattered lobe in addition to the hair lobes.

**Chiang et al. (2016).** Production hair and fur with colour-driven
parameters. Artists "would prefer to specify the multiple-scattering color
directly", so they rendered "dense hair cubes, illuminated by a white dome" and
fitted the absorption that produces a given colour C:

```text
σa = (ln C / (5.969 − 0.215βN + 2.532βN² − 10.73βN³ + 5.574βN⁴ + 0.245βN⁵))²     (9)
```

The mapping "works for different hair density", because "Changing the
scattering coefficients only scales the light paths and does not change the
resulting albedo". It is the fur counterpart of the Chiang–Kutz–Burley skin
inversion in §2.1.

### 4.2 Fur geometry in real time

Lengyel et al. (2001) render fur "as a series of concentric shells of
semi-transparent medium", and "To improve the visual quality of the fur near
silhouettes, we place 'fins' normal to the surface". Shells and fins fit
three's `InstancedMesh` and the existing `onBeforeCompile` patching
(recommendation). Short pelts need shells and fins; long hair needs strand
cards.

### 4.3 How the base colour flows into fur

**Recommendation.** One colour C per texel drives every coloured term, through
Chiang's Eq. 9 with a fixed βN, so that changing the colour never requires
retuning the lobes.

| Term | Colour source | Real-time form |
| --- | --- | --- |
| R (primary highlight) | none: keratin Fresnel, η ≈ 1.55, F0 = ((η − 1)/(η + 1))² ≈ 0.047 | `StrandSpecular` with a root-ward tangent shift (αR) |
| TT (back-lit glow) | `exp(−σa · ℓTT)`, σa from Eq. 9 | forward lobe, enabled only when the light is behind |
| TRT (secondary highlight) | the TT tint squared (two internal passes) | `StrandSpecular` with a tip-ward shift (−3αR/2) and width 2βR |
| Diffuse and medulla scattering | C itself (Chiang's C is the multiple-scattering albedo) | wrapped diffuse from §2.5, with d from C |

The fur parity check mirrors Chiang's fitting setup: a dense fur ball under a
uniform white environment must reproduce C (§5.4).

### 4.4 Scales with three r186

`MeshPhysicalMaterial` (r186.1 installed) already provides everything a scaled
surface needs:

| Feature | three parameters | Effect on colour faithfulness |
| --- | --- | --- |
| Clearcoat (a lacquered or keratinised outer layer) | `clearcoat`, `clearcoatRoughness`, `clearcoatNormalMap` | three computes `outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat` with `material.clearcoatF0 = vec3( 0.04 )`. The base is dimmed by 4% at normal incidence and more at grazing, uniformly per channel, so it changes lightness, not hue. |
| Thin-film iridescence (structural colour) | `iridescence`, `iridescenceIOR` ("Between `1.0` to `2.333`", default 1.3), `iridescenceThicknessRange` (default `[100, 400]`), `iridescenceThicknessMap` | Replaces the Fresnel term, `F = mix( F, material.iridescenceFresnel, material.iridescence )`. three's direct diffuse is weighted by `( 1.0 - F )`, so a coloured F tints the diffuse with the complementary hue. Small at normal incidence and larger at grazing. |
| Anisotropic specular (ridged or keeled scales) | `anisotropy`, `anisotropyRotation`, `anisotropyMap` | Specular only; the base colour is untouched. |
| Retroreflection | `retroreflectivity` ("redirecting the specular lobe back toward the light source") | Specular only. |
| Sheen (fine scale edges, velvet) | `sheen`, `sheenColor`, `sheenRoughness` | three applies `sheenEnergyComp = 1.0 - max3( material.sheenColor ) * ...` to the base, so a saturated `sheenColor` darkens all channels by its maximum; derive `sheenColor` from the albedo as `SkinMaterial` already does. |

**Recommendation.** For scales the base colour stays the diffuse albedo, with
the §2.5 scatter function at p = 0 and a short `hkScatterMfp`. Keratin scales
are far less translucent than skin, so a value around a tenth of skin's is a
reasonable starting point; that value is an assumption, not a measurement. Any
structural colour goes in iridescence, never in the albedo, so the parity
measurement of the albedo stays meaningful.

---

## 5. Colour-parity test design

The existing `e2e/colour-parity.spec.ts` renders faces under `StudioStage`,
reads the canvas through a 2D `drawImage`, and bounds ΔL\*, Δchroma and Δhue.
It answers the fairness question (no colour lifted or crushed relative to the
others). It cannot tell a shading error from a tone-mapping error, and its
error is relative to the untone-mapped albedo, which tone mapping deliberately
changes. The design below keeps it as stage 3 and adds two stages underneath.

### 5.1 Palette

1. **ISSA skin anchors**, all 10, from `MELANIN_ANCHORS` (`SKIN-RENDERING.md` §2.4).
2. **ColorChecker Classic, post-November-2014 formulation.** X-Rite's L\*a\*b\*
   (D50) as carried by colour-science, converted here to linear sRGB with a
   Bradford D50→D65 adaptation (computed here):

   | Patch | Linear sRGB | Patch | Linear sRGB |
   | --- | --- | --- | --- |
   | dark skin | 0.174, 0.079, 0.053 | yellow green | 0.333, 0.497, 0.043 |
   | light skin | 0.560, 0.277, 0.211 | orange yellow | 0.771, 0.358, 0.020 |
   | blue sky | 0.104, 0.189, 0.329 | blue | 0.021, 0.048, 0.284 |
   | foliage | 0.106, 0.151, 0.051 | green | 0.046, 0.292, 0.061 |
   | blue flower | 0.227, 0.212, 0.426 | red | 0.446, 0.036, 0.041 |
   | bluish green | 0.115, 0.507, 0.411 | yellow | 0.842, 0.574, 0.005 |
   | orange | 0.746, 0.202, 0.030 | magenta | 0.522, 0.078, 0.289 |
   | purplish blue | 0.059, 0.101, 0.388 | cyan | −0.044, 0.234, 0.377 (clamp R to 0) |
   | moderate red | 0.560, 0.080, 0.115 | white 9.5 | 0.880, 0.885, 0.834 |
   | purple | 0.109, 0.042, 0.138 | neutral 8 | 0.585, 0.592, 0.584 |
   | neutral 6.5 | 0.358, 0.367, 0.365 | neutral 5 | 0.190, 0.191, 0.190 |
   | neutral 3.5 | 0.086, 0.089, 0.090 | black 2 | 0.031, 0.031, 0.032 |

3. **Fantasy and extreme swatches.** The seven already in the spec (white fur,
   near-black scales, green scales, blue skin, red fur, violet, golden fur),
   plus the extremes the library promises to support: near-white
   (0.90, 0.90, 0.90), velvet black (0.010, 0.010, 0.010), saturated red
   (0.60, 0.02, 0.02), saturated green (0.02, 0.50, 0.02), saturated blue
   (0.02, 0.04, 0.60), cyan (0.02, 0.45, 0.55) and yellow (0.75, 0.60, 0.02).

### 5.2 Stage 1: linear shading fidelity on an analytic sphere

What it isolates: the material's diffuse model, before tone mapping and
display encoding.

1. Render a `SphereGeometry(1, 256, 128)` with the material under test,
   orthographic camera on +z, one white `DirectionalLight` of intensity π
   (three's `BRDF_Lambert` is `RECIPROCAL_PI * diffuseColor`, so Lambert
   radiance is then `A · N·L`), no environment, no ambient.
2. Turn off everything that is not diffuse: `specularIntensity = 0` (three sets
   `specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor )`, so the
   Fresnel term and the `( 1.0 - F )` factor vanish), `sheen = 0`,
   `clearcoat = 0`, `iridescence = 0`, no normal map, flush and masks at 0.
3. Render into a `WebGLRenderTarget` with `type: HalfFloatType`. three applies
   tone mapping only when rendering to the screen (`if ( _currentRenderTarget === null || _currentRenderTarget.isXRRenderTarget === true )`)
   and writes render targets in the working colour space (linear sRGB). Read
   back with `renderer.readRenderTargetPixels`.
4. Reconstruct each pixel's normal analytically from its position on the disc,
   `n = (x, y, √(1 − x² − y²))`, so N·L is exact for every pixel.
5. Bin pixels by N·L: lit [0.7, 1.0], shoulder [0.3, 0.7), terminator
   [−0.2, 0.3). For each bin, compare the mean rendered radiance with the
   expected mean of `A · max(N·L, 0)`.
6. Repeat at light angles 0°, 45° and 70°.

Assertions (recommendation; ΔE00 on CIELAB D65 computed from linear sRGB):

| Check | Bound | Why |
| --- | --- | --- |
| lit bin, Lambert material | ΔE00 ≤ 0.5 per swatch | only half-float quantization remains |
| lit bin, scatter material | ΔE00 ≤ 1.0 per swatch; spread across the palette ≤ 0.5 | the energy-conserving wrap dims the peak by at most 1/(1 + w) |
| whole disc, scatter material | integrated radiance within ±3% of Lambert per channel | energy conservation |
| terminator bin, scatter material | any channel gain above Lambert must be ordered like d_c | scatter may tint the terminator, but only toward the channel that scatters furthest |
| specular-only render (diffuse colour black, `specularIntensity = 1`) | ΔE00 ≤ 0.5 between every pair of swatches | a dielectric's specular must not depend on its base colour |

The last check is the colour-agnostic invariant in its simplest form. It would
catch any future code that tints the specular or sheen from the albedo by
accident.

**As implemented (`tests/browser/sphereParity.test.ts`), with corrections.**
The render target is `FloatType` rather than half-float, so readback adds no
quantisation. The curvature attribute stands for a 2 cm feature (a nose tip)
and, for the exact-model check, also a 3 mm one (an ear rim), where the table's
gradient is steep. Against the TypeScript model (`src/surface/scatter.ts`; the
shader's wavelength ratios, default uniforms and table come from it, its
Chiang and Christensen–Burley polynomials are copied, and this test holds the
copy to it) the scatter material renders within ΔE00 0.5 in every bin for all
49 swatches at 0°, 45° and 70°, and no pixel strays by more than 0.3% of the
swatch's peak albedo; a half-texel error in the table lookup breaks that at
3 mm. (At 0° the light is on the view axis, so the terminator bin holds only a
thin ring; 45° and 70° are where the terminator is exercised.) That replaces
the energy and terminator-order rows: both are properties of the model, proven
on it in `tests/scatter.test.ts` (the pre-integrated response and its table
keep Lambert's integral over the sphere), and a single view of the sphere
cannot measure the energy anyway, because at a frontal light the scattered
light falls behind the silhouette.

The specular-only row, as specified, cannot catch a shader that reads the
albedo into the specular: with the base colour black there is no albedo to
read. It is kept for what it does catch (a specular or sheen colour derived
from the swatch in `setAppearance`), and a stronger contract covers the
shader: with scatter off, the skin material with the creator's own settings
(sheen, specular, the pore normal map) renders exactly as three's
`MeshPhysicalMaterial` with the same settings, within 0.002 per pixel. That
contract found a real fault: the replaced diffuse line had dropped three's
sheen energy compensation (the light the sheen layer reflects is not
available below it), so skin with its sheen on was lit up to 0.011 brighter
than three's accounting allows.

The "spread ≤ 0.5" row was wrong. How far a colour carries light follows from
its albedo by design (§2), so the lit peak of white dims more than black's:
measured ΔE00 1.01 for white 9.5, 0.60 for neutral 8, 0.12 for neutral 5 and
0.01 for black 2. A spread bound would forbid the model itself. The test bounds
every colour at ΔE00 1.3 (BabelColor's red flag, §5.5), and the fairness
property for skin, that pigment sits above a shared scattering layer so the
deepest measured skin keeps more than half the fairest's scatter distance
(about a tenth if the pigment were mixed through), is asserted on the model.
Each of these checks was seen to fail under a planted fault: the old
(1 + w) wrap, a specular tinted by the albedo in `setAppearance`, a tenfold
mean free path, pigment mixed through the medium, the sheen compensation
removed, and the table sampled half a texel off.

### 5.3 Stage 2: the display path

What it isolates: tone mapping and sRGB encoding, given correct shading.

1. Render the same sphere to the canvas with the studio stage's tone mapping
   (`NeutralToneMapping`, exposure 1.05) and read the drawing buffer
   (`preserveDrawingBuffer: true`, or `readPixels` in the same task as the
   render).
2. Compute the expectation in TypeScript: the stage 1 expected linear radiance,
   multiplied by the exposure, passed through a TypeScript port of the Khronos
   PBR Neutral curve, then sRGB-encoded and quantized to 8 bits.
3. Assert ΔE00 ≤ 1.0 per swatch in the lit bin.

Because the expectation is tone-mapped too, the swatches with channels below
0.08 are no longer penalised for what the tone curve does by design. A failure
here means the shader and the expected tone curve disagree, for example after a
three upgrade changes `tonemapping_pars_fragment`.

**As implemented** (same spec file): the stage's exposure is now
`STUDIO_EXPOSURE` (1.15). The expectation is the scatter model's radiance per
pixel through a line-for-line port of three r186's `NeutralToneMapping` and
`sRGBTransferOETF` (its 0.41666 exponent included), quantised to 8 bits, and
the canvas is read with `gl.readPixels` in the same task as the render. All 49
swatches agree within ΔE00 1.0 in the lit and shoulder bins at every angle;
moving the curve's compression start from 0.76 to 0.56 turns 20 of them red,
all bright, where compression acts.

### 5.4 Stage 3: fairness under the studio stage

Keep the current face renders under `StudioStage`, extended to the full palette,
and change the measure to ΔE00 against the albedo:

| Check | Bound (recommendation) |
| --- | --- |
| per swatch, median of the face's lit region | ΔE00 ≤ 6 |
| spread across the palette (max − min of the per-swatch ΔE00) | ≤ 3 |
| hue, chromatic swatches (C\* > 8) | within 6°, as today |

Calibrate the absolute bounds on the first run after the §2.5 change, then
ratchet down. The spread bound is the one that encodes fairness: no tone, skin
or otherwise, may be rendered systematically worse than the rest.

**Fur ball.** For fur, add Chiang's own validation: a dense fur ball under a
uniform white environment must reproduce C, with ΔE00 ≤ 2 in the centre of the
ball.

### 5.5 Acceptance scale

BabelColor's ColorChecker comparisons flag a patch "with a difference higher
than 1.3" in red and "higher than 1.0 but less than 1.3" in yellow (CIEDE2000).
That is the scale for stages 1 and 2, whose errors should be numerical only.
Stage 3 includes deliberate tone mapping, so its bounds are wider, and the
spread bound carries the fairness guarantee.

**ΔE00 implementation.** Use Sharma, Wu and Dalal (2005), including the
hue-rotation term `RT = −sin(2Δθ) RC` and `T = 1 − 0.17 cos(h̄′ − 30°) + 0.24 cos(2h̄′) + 0.32 cos(3h̄′ + 6°) − 0.20 cos(4h̄′ − 63°)`.
Ship Sharma's 34 published pairs as a unit-test fixture. The implementation
used for this document reproduces all of them to within 5×10⁻⁵ (computed here).

### 5.6 Determinism in headless and headed Chromium

1. **Software GL.** Keep `--use-angle=swiftshader --enable-unsafe-swiftshader`
   (already in `playwright.config.ts`). Chromium documents SwiftShader as
   running "purely on the CPU", so output depends on the Chromium build, not
   the host GPU. Pin it through the Playwright version in the lockfile.
2. **Headed runs and colour management.** Add `--force-color-profile=srgb`
   ("Force all monitors to be treated as though they have the specified color
   profile"). On macOS Chromium also documents `--ensure-forced-color-profile`,
   which crashes at startup if the display profile does not match, "because
   Chrome's pixel output is always subject to the color conversion performed by
   the operating system". Stages 1 and 2 read pixels from WebGL before
   compositing, so OS colour management cannot reach them. The current
   `drawImage` path goes through a 2D canvas and can be affected.
3. **No network.** `StudioStage` uses drei's `Environment preset="studio"`,
   which loads `studio_small_03_1k.hdr` from
   `https://raw.githack.com/pmndrs/drei-assets/.../hdri/` at run time. Vendor
   the file or serve it with `page.route`, so a CDN outage cannot change a
   result.
4. **Frames, not timeouts.** Replace `waitForTimeout(1500)` with an explicit
   readiness signal: render on demand, then expose a frame counter or a
   `data-` attribute after the frame that contains the final geometry, and read
   pixels in the same task as that render.
5. **Fixed raster state.** `deviceScaleFactor: 1`, a fixed viewport,
   `antialias: false` for stages 1 and 2 (so edge pixels cannot blend into the
   bins), `dithering: false` (three's default), no post-processing.
6. **Seeds.** The pore normal map is already a deterministic hash. Any future
   noise (fur strand placement, scale variation) must take a seed from the
   recipe.
7. **Serial GPU work.** Run the parity spec with one worker. SwiftShader shares
   the CPU, and parallel WebGL contexts cause timeouts rather than wrong
   colours, but timeouts make the gate flaky.

---

## 6. Recommended changes, in order

1. **Fix the override path now.** In `setAppearance`, do not derive
   `hkScatter` or `sheen` from `tone.melanin` when `tone.override` is set. Until
   §2.5 lands, use zero wrap for overrides. This removes a shift of up to
   ΔE00 4.8 on fantasy colours at a 45° key (computed here).
2. **Make the wrap energy-conserving.** Divide by `(1 + w)²` instead of
   `(1 + w)` (McAuley). That alone removes the added light at every colour.
3. **Replace `hkScatter` with the albedo chain and curvature** (§2.5): Chiang α,
   Christensen–Burley s, a scattering length, pigment depth, and a per-vertex
   curvature attribute. Start with the closed-form wrap; move to the
   pre-integrated table if the wrap's 0.05 RMS error is visible.
4. **Derive sheen intensity from luminance**, not melanin (§2.5).
5. **Add parity stages 1 and 2** (§5.2–5.3), including the specular-only
   invariant, with Sharma's CIEDE2000 fixture as a unit test.
6. **Make stage 3 deterministic**: vendor the studio HDR, force the sRGB colour
   profile, and wait on frames instead of time (§5.6).
7. **Keep the ISSA anchors as albedo.** If a biophysical table is added for
   flush and pallor, calibrate it to pass through the anchors (§3.3).
8. **Fur and scales**: shells and fins with Chiang's colour inversion driving
   every coloured lobe; scales on `MeshPhysicalMaterial` with structural colour
   kept in iridescence (§4).

### 6.1 TypeScript mirror of the scatter chain (for tests and CPU-side defaults)

```ts
const singleScatterAlbedo = (a: number) =>
  1 - Math.exp(-5.09406 * a + 2.61188 * a * a - 4.31805 * a * a * a);
const profileScale = (a: number) => 1.9 - a + 3.5 * (a - 0.8) ** 2;
const WAVELENGTH_RATIO: Rgb = [612 / 550, 549 / 550, 465 / 550];

/** Per-channel Burley profile width d, in the units of `mfp`. */
export function scatterDistance(
  albedo: Rgb,
  mfp: number,
  slope = 1.4,
  pigmentDepth = 0,
  substrate: Rgb = albedo,
): Rgb {
  return albedo.map((c, k) => {
    const a =
      Math.min(0.999, Math.max(0.001, c)) ** (1 - pigmentDepth) *
      Math.min(0.999, Math.max(0.001, substrate[k] as number)) ** pigmentDepth;
    const ls = mfp * (WAVELENGTH_RATIO[k] as number) ** slope;
    return (singleScatterAlbedo(a) * ls) / profileScale(a);
  }) as Rgb;
}

/** Energy-conserving wrap fitted to the pre-integrated profile; x = d · curvature. */
export const wrapFromScatter = (x: number) => {
  const y = x ** 1.2997;
  return (2.0246 * y) / (1 + 1.3543 * y);
};
```

### 6.2 Open questions this research could not settle

- **Physical ℓs for fur and scales.** No measured scattering length for scale
  keratin or for fur medulla in a form usable here was found. The defaults in
  §4.4 are starting points to be tuned against reference photographs.
- **Lip and areola colour across skin tones.** Still unvalidated
  (`SKIN-RENDERING.md` §5.3).
- **Whether the hand-set wrap stands in for unresolved detail.** The physical
  wrap on a smooth face is near zero. Penner's per-channel normal pre-filtering
  is the principled replacement for that softening, and it should be compared
  with the hand-set look in a side-by-side render before the hand-set value is
  removed.

### 6.3 How the computed numbers were produced

Python with NumPy and SciPy, run in a scratch environment, not committed:

- **CIEDE2000** per Sharma et al., checked against the 34 published pairs.
- **Biophysical fit** (§3.3): spectra 400–700 nm at 10 nm; CIE 1931 2° CMFs and
  D65 from CVRL; haemoglobin extinction from Prahl (OMLC); Nelder–Mead from a
  6 × 5 grid of starts per anchor, minimising ΔE00.
- **Pre-integration** (§2.4): sphere integral of Burley's profile, 4000 polar ×
  256 azimuthal samples, 91 light angles; wraps fitted by grid search, closed
  forms by least squares.
- **Wrap colour shift** (§2.6): a 400 × 400 hemisphere grid, projected-area
  weighted.
- **ColorChecker conversion** (§5.1): X-Rite post-2014 L\*a\*b\* (D50, ICC white
  0.9642, 1, 0.8249) to XYZ, Bradford to D65, IEC 61966-2-1 matrix.

---

## 7. Sources

### Subsurface scattering

- Christensen, P. H., Burley, B. (2015). *Approximate Reflectance Profiles for
  Efficient Subsurface Scattering.* Pixar Technical Memo #15-04. Project page:
  <https://graphics.pixar.com/library/ApproxBSSRDF>. Paper (archived copy used
  here):
  <https://web.archive.org/web/2017/http://graphics.pixar.com/library/ApproxBSSRDF/paper.pdf>
- Burley, B. (2015). *Extending the Disney BRDF to a BSDF with Integrated
  Subsurface Scattering.* SIGGRAPH Physically Based Shading course notes.
  <https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf>
- Chiang, M. J.-Y., Kutz, P., Burley, B. (2016). *Practical and Controllable
  Subsurface Scattering for Production Path Tracing.* SIGGRAPH Talks.
  <https://media.disneyanimation.com/uploads/production/publication_asset/153/asset/siggraph2016SSS.pdf>
- Jensen, H. W., Marschner, S. R., Levoy, M., Hanrahan, P. (2001). *A Practical
  Model for Subsurface Light Transport.* SIGGRAPH.
  <https://graphics.stanford.edu/papers/bssrdf/bssrdf.pdf>
- Golubev, E. (2018). *Efficient Screen-Space Subsurface Scattering Using
  Burley's Normalized Diffusion in Real-Time.* SIGGRAPH Advances in Real-Time
  Rendering.
  <https://advances.realtimerendering.com/s2018/Efficient%20screen%20space%20subsurface%20scattering%20Siggraph%202018.pdf>
- Penner, E. (2011). *Pre-Integrated Skin Rendering.* SIGGRAPH Advances in
  Real-Time Rendering (slides and speaker notes).
  <https://advances.realtimerendering.com/s2011/index.html>. Book chapter:
  Penner, E., Borshukov, G., *Pre-Integrated Skin Shading*, GPU Pro 2 (2011),
  41–55.
- Moore, J. *In-depth: Skin shading in Unity3D* (implementation notes on
  Penner's method). <https://www.gamedeveloper.com/programming/in-depth-skin-shading-in-unity3d>
- McAuley, S. (2011). *Energy-Conserving Wrapped Diffuse.* Archived:
  <https://web.archive.org/web/2016/http://blog.stevemcauley.com/2011/12/03/energy-conserving-wrapped-diffuse/>
- Hill, S. (2011). *Righting Wrap (Part 1).*
  <https://blog.selfshadow.com/2011/12/31/righting-wrap-part-1/>

### Biophysical skin colour

- Donner, C., Jensen, H. W. (2006). *A Spectral BSSRDF for Shading Human Skin.*
  EGSR. <https://cseweb.ucsd.edu/~henrik/papers/skin_bssrdf/skin_bssrdf.pdf>
- Jimenez, J. et al. (2010). *A Practical Appearance Model for Dynamic Facial
  Color.* ACM TOG 29(6).
  <https://www.iryoku.com/skincolor/downloads/A-Practical-Appearance-Model-for-Dynamic-Facial-Color.pdf>
- Iglesias-Guitian, J. A., Aliaga, C., Jarabo, A., Gutierrez, D. (2015). *A
  Biophysically-Based Model of the Optical Properties of Skin Aging.* Computer
  Graphics Forum 34(2). <https://graphics.unizar.es/papers/Iglesias_eg15.pdf>
- Alotaibi, S., Smith, W. A. P. (2017). *A Biophysical 3D Morphable Model of Face
  Appearance.* ICCV Workshops.
  <https://openaccess.thecvf.com/content_ICCV_2017_workshops/papers/w16/Alotaibi_A_Biophysical_3D_ICCV_2017_paper.pdf>
- Alotaibi, S., Smith, W. A. P. (2019). *BioFaceNet: Deep Biophysical Face Image
  Interpretation.* <https://arxiv.org/abs/1908.10578>
- Aliaga, C., Hery, C., Xia, M. (2022). *Estimation of Spectral Biophysical Skin
  Properties from Captured RGB Albedo.* <https://arxiv.org/abs/2201.10695>
- Jacques, S. L. (1998). *Skin Optics.* OMLC News.
  <https://omlc.org/news/jan98/skinoptics.html>
- Prahl, S. *Tabulated Molar Extinction Coefficient for Hemoglobin in Water.*
  OMLC. <https://omlc.org/spectra/hemoglobin/summary.html>
- CVRL. CIE 1931 2° colour matching functions,
  <http://cvrl.ucl.ac.uk/database/data/cmfs/ciexyz31_1.csv>, and CIE D65,
  <http://cvrl.ucl.ac.uk/database/data/cie/Illuminantd65.csv>
- Yan, L. et al. (2025). *The International Skin Spectra Archive (ISSA).*
  Scientific Data. <https://www.nature.com/articles/s41597-025-04857-5>

### Hair, fur and scales

- Kajiya, J. T., Kay, T. L. (1989). *Rendering fur with three dimensional
  textures.* SIGGRAPH.
  <https://history.siggraph.org/learning/rendering-fur-with-three-dimensional-textures-by-kajiya-and-kay>
- Scheuermann, T. (2004). *Hair Rendering and Shading.* GDC.
  <https://web.engr.oregonstate.edu/~mjb/cs519/Projects/Papers/HairRendering.pdf>
- Marschner, S. R., Jensen, H. W., Cammarano, M., Worley, S., Hanrahan, P.
  (2003). *Light Scattering from Human Hair Fibers.* ACM TOG 22(3).
  <https://www.cs.cornell.edu/~srm/publications/SG03-hair.pdf>
- d'Eon, E., Francois, G., Hill, M., Letteri, J., Aubry, J.-M. (2011). *An
  Energy-Conserving Hair Reflectance Model.* EGSR.
  <https://www.eugenedeon.com/pdfs/egsrhair.pdf>
- Yan, L.-Q., Tseng, C.-W., Jensen, H. W., Ramamoorthi, R. (2015).
  *Physically-Accurate Fur Reflectance: Modeling, Measurement and Rendering.*
  ACM TOG 34(6). <https://sites.cs.ucsb.edu/~lingqi/publications/paper_fur.pdf>
- Yan, L.-Q., Jensen, H. W., Ramamoorthi, R. (2017). *An Efficient and Practical
  Near and Far Field Fur Reflectance Model.* ACM TOG 36(4).
  <https://sites.cs.ucsb.edu/~lingqi/publications/paper_fur2.pdf>
- Chiang, M. J.-Y., Bitterli, B., Tappan, C., Burley, B. (2016). *A Practical and
  Controllable Hair and Fur Model for Production Path Tracing.* Computer
  Graphics Forum 35(2).
  <https://media.disneyanimation.com/uploads/production/publication_asset/152/asset/eurographics2016Fur_Smaller.pdf>
- Lengyel, J., Praun, E., Finkelstein, A., Hoppe, H. (2001). *Real-Time Fur over
  Arbitrary Surfaces.* I3D. <https://hhoppe.com/fur.pdf>
- three.js r186 source, `node_modules/three/src/materials/MeshPhysicalMaterial.js`,
  `src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js`,
  `lights_physical_fragment.glsl.js`, `common.glsl.js`,
  `src/renderers/shaders/ShaderLib/meshphysical.glsl.js` and
  `src/renderers/WebGLRenderer.js` (version 0.186.1 installed).

### Colour measurement and testing

- Sharma, G., Wu, W., Dalal, E. N. (2005). *The CIEDE2000 Color-Difference
  Formula: Implementation Notes, Supplementary Test Data, and Mathematical
  Observations.* Color Res. Appl. 30(1).
  <https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/ciede2000noteCRNA.pdf>.
  Test data:
  <https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt>
- colour-science, ColorChecker chromaticity data (X-Rite post-November-2014
  values).
  <https://github.com/colour-science/colour/blob/develop/colour/characterisation/datasets/colour_checkers/chromaticity_coordinates.py>
- BabelColor, *The ColorChecker Pages (2/3).* <https://babelcolor.com/colorchecker-2.htm>
- Chromium, *Using Chromium with SwiftShader.*
  <https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md>
- Beverloo, P. *List of Chromium Command Line Switches* (`--force-color-profile`,
  `--ensure-forced-color-profile`).
  <https://peter.sh/experiments/chromium-command-line-switches/>
- Playwright, *Visual comparisons.* <https://playwright.dev/docs/test-snapshots>
- drei `Environment` presets: `@react-three/drei` `helpers/environment-assets.js`
  and `core/useEnvironment.js` (10.7.9 installed).
