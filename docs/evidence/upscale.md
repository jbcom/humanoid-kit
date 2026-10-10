# Upscaling: methods, gates and what they found

What it takes to upscale a texture without inventing anything, and whether
doing it is worth the texels. The inventory of what is low-resolution, and why,
is in [upscale-inventory.md](./upscale-inventory.md). Measured 2026-10-09.

## The outcome

- **Re-sourcing is enough almost everywhere.** The packers now size every
  texture by the edge its closest QA framing needs, taken from the original
  (`scripts/lib/textureSizing.ts`). The hair, the suits and the fedora get the
  texels their originals always had. The numbers are under "What it costs"
  below.
- **No texture is upscaled.** Three originals have fewer texels than their
  textures need: the eye's albedo, and the female sportsuit's and the fedora's
  normal maps. A conservative upscale of the eye passes every integrity gate,
  but on held-out originals the best conservative method is closer to the
  truth than the GPU's own bilinear magnification by 0.03 CIEDE2000 (median),
  a thirtieth of a just-noticeable difference. Re-deriving normal maps from
  their height is no closer than bilinear at all. The two normal maps also fail
  the gates. An upscale would cost memory for nothing anyone could see, so these
  three ship at their originals' size, and each pack's `PROVENANCE.md` records
  the shortfall.
- **A learned upscaler is unfair as well as unfaithful.** Real-ESRGAN x4plus
  fails the gates on all 22 MakeHuman skins. It is further from the original
  than plain bilinear on every one (median 1.35 against 0.89), and on the
  darkest skins its round trip shifts mean luminance by up to 17.5%.

## Methods by channel class

`scripts/lib/upscale/methods.ts`, all deterministic, with no learned weights:

- **Coverage** (cut-out alphas, masks): an antialiased coverage value is 0.5
  plus the signed distance of the texel's centre from the edge, so its linear
  interpolation is a distance field sampled finer. Scaled to output texels and
  re-rasterised with a one-texel ramp, it draws the same edge crisply at the
  new size, with no new region and no new hole. This needs no vectorising
  through potrace.
- **Albedo**: Lanczos-3 in linear light, premultiplied by alpha, then
  back-projected (Irani and Peleg, 1991): twelve passes add back what the
  result's area-downsample still misses of the source. Lanczos lobes clipped at
  black would otherwise shift the darkest texels' mean.
- **Normal maps**: never resampled as vectors. The slopes are integrated into a
  height by least squares in a cosine basis (Frankot and Chellappa's
  projection with free edges), with the mean slope taken out as a plane. The
  height's exact slopes are evaluated at the new size, and the part no height
  explains is carried across as a residual. Back-projection then settles the
  round trip.
- **Line-art tattoos**: the playground draws its tattoo images from vector paths
  (`playground/src/tattooImages.ts`), which re-rasterise exactly at any size,
  now at 512 px, the ink's own resolution. The forearm's pixels were lost in
  the body-art bake, not in the image; the body-art lane has since moved the
  ink out of that bake ([upscale-inventory.md](./upscale-inventory.md)).

An anti-ringing clamp (each texel held to the range of the 2×2 source texels
around it) was tried and rejected. It made every gate worse: on the sportsuit,
the share of power above the source's band went from 1.9% to 10.3%, and the
round trip failed. The clip is itself a nonlinearity that adds harmonics, and
it fights the back-projection.

## The gates

`scripts/lib/upscale/gates.ts`, each a unit-tested function
(`tests/upscale.test.ts`):

- **Round trip.** The result is area-downsampled back to the source's size and
  compared with the source, in linear light.
  - Albedo: mean CIEDE2000 < 1 and p99 < 3 overall. The same bar applies in
    every skin-tone bucket (ITA°: very light, light, intermediate, tan, brown,
    dark) that holds at least 1000 texels.
  - Each bucket's mean luminance may shift by less than 1%, and its mean a\*b\*
    by less than 0.5. This bias test exists because CIEDE2000 alone is not
    equally strict at every tone. A 10% darkening of the kit's deepest skin
    (L\* 30) scores about 0.9, while the same darkening of light skin scores
    about 1.9, so a dark tone could drift twice as far before failing.
  - Texels that are no skin tone (L\* < 20, or b\* ≤ 0: painted lines, greys,
    blues) count in the total but are not judged as a tone.
  - Coverage: mean |Δα| < 0.01 and p99 < 0.05. Normals: mean angle < 1° and
    p99 < 3°.
- **No new features.** The result's share of power above the source's Nyquist
  frequency, from a Hann-windowed 2D FFT, may exceed a Lanczos-3
  interpolation's share by at most one percentage point. That interpolation is
  clipped to what can be stored. In its 99th-percentile 32-texel tile, the
  above-band power beyond the reference's may be at most 20% of the image's
  mean tile power, so a local artefact cannot hide in the average. A coverage
  mask may gain no region and no hole.
- **Provenance** (`scripts/lib/upscale/provenance.ts`). Each output gets a
  manifest entry: the source's SHA-256 and licence, the method, the code's
  version (the SHA-256 of `raster.ts` and `methods.ts`), the codec (sharp),
  any weights (none), the parameters, every gate's reading, and the output's
  SHA-256.

### Setting the tile bar on ground truth

The tile bar was not chosen by eye. It is set where the held-out results say
an upscale starts to be worse than bilinear:

| Result | Tile p99 | Closer to the original than bilinear? |
| --- | --- | --- |
| Lanczos, back-projected, 20 skins | 0.010–0.113 | yes on mean in 19, level in 1; better p99 in all 20 |
| Lanczos, back-projected, the 2 suit-painted skins (hard graphic edges) | 0.333, 0.428 | no: +0.35 CIEDE2000 |
| Real-ESRGAN x4plus, 22 skins | 0.461–2.809 | no: +0.42 to +0.80 |

Every result at 0.113 or below was at least as close to the original as
bilinear. Every result at 0.33 or above was further from it. The bar, 0.2, lies
between. At the first bar, 5%, the gate rejected Lanczos on skins where it was
measurably closer to the truth, so that bar was wrong.

## Which upscaler, and does it beat the GPU

`node scripts/research/upscale-eval.ts <system-assets-dir> <work-dir>
--realesrgan <dir>`. Real-ESRGAN is the ncnn-vulkan build 20220424 (MIT; ncnn
BSD-3-Clause) with the realesrgan-x4plus weights (BSD-3-Clause; `.bin` SHA-256
`713ee713…ddf`), run on Apple's GPU.

**Albedo.** The 22 MakeHuman skin images (2048²) were area-downsampled to 512²
and upscaled ×4. The kit does not pack these skins, since it computes skin
colour, but they are the largest set of real albedo with known originals at
every tone.

| Method | Skins passing the gates | Median CIEDE2000 to the original | Median p99 |
| --- | --- | --- | --- |
| GPU bilinear (linear light) | 3/22 | 0.887 | 6.17 |
| Lanczos-3, back-projected | 20/22 | 0.859 | 5.63 |
| Real-ESRGAN x4plus | 0/22 | 1.350 | 6.88 |

Median CIEDE2000 to the original, by the original texel's tone bucket:

| Method | Very light | Light | Intermediate | Tan | Brown | Dark |
| --- | --- | --- | --- | --- | --- | --- |
| GPU bilinear | 0.818 | 0.566 | 0.956 | 1.667 | 2.154 | 6.783 |
| Lanczos-3, back-projected | 0.791 | 0.566 | 0.870 | 1.634 | 2.075 | 6.641 |
| Real-ESRGAN x4plus | 1.403 | 1.077 | 1.376 | 2.180 | 3.132 | 8.196 |

Worst round trip over the skins, by bucket (mean / p99 CIEDE2000, and
luminance shift):

| Method | Very light | Light | Intermediate | Tan | Brown | Dark |
| --- | --- | --- | --- | --- | --- | --- |
| Lanczos-3, back-projected | 0.003 / 0.01, 0.00% | 0.000 / 0.00, 0.00% | 0.000 / 0.00, 0.00% | 0.001 / 0.01, 0.00% | 0.009 / 0.05, 0.02% | 0.284 / 2.71, 0.27% |
| Real-ESRGAN x4plus | 1.48 / 10.2, 0.82% | 1.23 / 3.67, 0.93% | 1.64 / 6.65, 2.10% | 2.86 / 12.0, 3.18% | 4.76 / 14.8, 6.90% | 6.66 / 18.4, 17.5% |

GPU bilinear is not round-trip consistent (it blurs), so its round trip fails
on 19 skins. That is a property of the measure, not of what the GPU shows. It
is listed above as the baseline for closeness to the original.

**Normal maps.** The seven garment normal maps whose originals are 4096² were
reduced by their slopes to 1024², 8-bit, and upscaled ×2. Each was then
compared with its original reduced to 2048²:

| Method | Passing the gates | Median angle to the original | Median p99 |
| --- | --- | --- | --- |
| GPU bilinear | 6/7 | 0.634° | 5.86° |
| Height, re-derived | 7/7 | 0.657° | 5.76° |

The height method is closer on two maps (the work suit: 0.437° against 0.540°)
and further on five. It is not better.

**The three textures whose originals fall short** (`pnpm upscale
<system-assets-dir> <out-dir>`):

| Texture | Source → needed | Round trip | Above-band excess, whole / p99 tile | Gates |
| --- | --- | --- | --- | --- |
| eye albedo | 1024 → 1408 | 0.016 / 0.31 CIEDE2000; dark bucket 0.14 / 2.04, −0.07% | +0.008 pp / 0.073 | pass |
| sportsuit normal | 1024 → 1536 | 0.0001° / 0.002° | 0 pp / 0.466 | fail |
| fedora normal | 512 → 1408 | 0.059° / 0.58° | +0.22 pp / 1.465 | fail |

The fedora's failure is visible. Its normal map has one-texel stripes and an
aliased diagonal line, and any reconstruction sharper than bilinear redraws
that aliasing as a dotted stipple along the line.

## What it costs

Re-sourcing adds texels where the closest framing needs them (31 textures grow;
none shrinks):

| | Before | After | Change |
| --- | --- | --- | --- |
| Field atlas | 7 pages, 28 MB | the same | 0: no texture here is in it |
| Hair pack download | 4.39 MB | 8.05 MB | +3.66 MB across ten styles |
| Clothing pack download | 4.43 MB | 5.78 MB | +1.35 MB across 19 garments |
| Body pack download | 7.01 MB | 7.01 MB | +1 KB (PROVENANCE.md) |
| One worn hair style on the GPU | 5.3 MB | 14.1–21.3 MB | +8.8 to +16.0 MB |
| One worn suit on the GPU, diffuse and normal | 10.7 MB | 16.6–42.7 MB | +5.9 to +32.0 MB |

GPU sizes are RGBA8 with mipmaps (the edge squared × 4 bytes × 4/3). A figure
fetches only the hair style and garments it wears, so the download a figure
pays is one style (the largest, the afro, 0.74 → 2.05 MB; a short style
0.25 → 0.47 MB) and its outfit. A crowd shares each texture across every figure
wearing it.

## Reproducing

- `node scripts/research/texel-density.ts <system-assets-dir>`: what every
  texture needs.
- `pnpm upscale <system-assets-dir> <out-dir>`: the gated upscales of the
  shortfalls, with their manifest, written outside the repository.
- `node scripts/research/upscale-eval.ts <system-assets-dir> <work-dir>
  [--realesrgan <dir>]`: the held-out evaluation above.
- `pnpm pack:data <makehuman-data-dir> <system-assets-dir>` and `pnpm
  pack:clothing <system-assets-dir>`: the packs, with each texture's size and
  source in their `PROVENANCE.md`.
