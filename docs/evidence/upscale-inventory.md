# Raster inputs and their texel density

Which images the packers consume, how finely each resolves on the figure, and
whether any is too coarse for the closest framing the QA sheets use. Measured
2026-10-09 by `node scripts/research/texel-density.ts <system-assets-dir>` on the
default figure; the definitions are in `scripts/lib/texelBudget.ts`.

## How it is measured

A triangle's texel density is √(UV area × width × height ÷ surface area), in
texels per millimetre of skin or cloth. A texture resolves at a framing when its
texels are no larger than the screen's pixels there. Below that, each texel is
magnified into a visible block or blur. A texture counts as resolving when 90%
of its surface area does (the "covered" column), so a small stretched corner
does not decide it.

The framings are the closest ones the QA sheets have used. Their pixel density
is computed at the playground's 35° field of view and the integrator's 2×
pixel density.

| Framing | From | px/mm |
| --- | --- | --- |
| face (and what is worn on the head) | `lane-face/brows-tones-age6`, 0.42 m | 2.87 |
| forearm | `lane-hands/tattoos-forearm-after`, 0.37 m | 3.44 |
| hand | `lane-hands/hands-palm-child-after`, 0.13 m | 8.85 |
| torso | `lane-clothing/torso-breast-baseline`, 0.22 m | 6.86 |
| foot | `lane-clothing/feet-heel-macro`, 0.07 m | 23.56 |
| clothed figure | `lane-clothing/garments-dual-skinning-poses`, 2.6 m | 0.68 |

## What the packers consume

The skin's colour is not an image: it is computed from melanin, haemoglobin and
undertone (`src/surface/skinTone.ts`), with measured anchors. Its regional
colour, creases, flush and pallor come from fields on the mesh, which are
rasterised at run time into the shared field atlas (`src/render/layerAtlas.ts`).
Its pores come from a procedural height field, turned into normals at load
(`poreNormalMap`, `src/render/skinMaterial.ts`). As a result, several kinds of
input that might be expected here do not exist in this kit:

- **MakeHuman skins (23 folders, 22 images, all 2048²) and litspheres.** No
  packer reads them. Upscaling them would change nothing on the figure.
- **Nails, the genital "UV masks", areolae, creases.** These are fields per
  vertex or masks of morph targets (`scripts/lib/adultAnatomySpec.ts`), not
  rasters.
- **Height maps.** None ship. The only normal maps are the garments' (below)
  and the procedural pore map.
- **Tattoos.** The application supplies the images at run time
  (`bodyArtImages`). The playground draws its two from vector paths
  (`playground/src/tattooImages.ts`), so they are resolution-free; they were
  256² canvases and are now 512² (below).

These are the rasters that do ship, with each texture's surface-area-weighted
median texel density and the density 90% of its area meets. A bracketed figure
is that same density at the source's own resolution.

| Surface | Channels | Shipped before | Source | Framing | Median | 90% covered | Needs | Ships now |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| field atlas, body-art bake | per-figure, body UV | 1024² | — | forearm | 0.44 | 0.42 | 8448 | 1024² |
| ″ | ″ | ″ | — | face | 1.09 | 0.71 | 4224 | ″ |
| ″ | ″ | ″ | — | hand | 0.63 | 0.56 | 16128 | ″ |
| eye (brown) | sRGB albedo, cornea alpha | 1024² | 1024² | face | 3.56 | **2.12** [2.12] | 1408 | 1024² (short) |
| teeth | sRGB albedo, alpha | 1024² | 2048² | face | 4.57 | 4.20 [8.40] | 768 | 1024² |
| tongue | sRGB albedo | 1024² | 1024² | face | 6.86 | 5.22 | 640 | 1024² |
| scalp hair, 10 styles | strand luminance, card alpha | 1024² | 2048² | face | 1.00–16.6 | **0.64–1.79** [1.28–3.58] | 1664–4608 | 1664²–2048² |
| eyebrows, 12 | coverage alpha | 512² | 512² | face | 5.45–9.02 | 3.80–6.91 | 256–512 | 512² |
| eyelashes, 4 | coverage alpha | 512² | 512² | face | 8.24–10.0 | 4.91–9.88 | 256–384 | 512² |
| suits, 11 | sRGB albedo | 1024² | 2048² | clothed | 0.44–0.85 | **0.36–0.69** [0.73–1.39] | 1024–2048 | 1024²–2048² |
| suits, 10 | tangent-space normal | 1024² | 2048²–4096² | clothed | 0.44–0.85 | **0.36–0.69** [0.96–2.78] | 1024–2048 | 1024²–2048² |
| female sportsuit | tangent-space normal | 1024² | **1024²** | clothed | 0.66 | **0.48** [0.48] | 1536 | 1024² (short) |
| shoes, 6 | albedo, 2 normals | 1024² | 1024² | clothed | 1.89–2.83 | 0.75–1.01 | 768–1024 | 1024² |
| fedora | sRGB albedo | 1024² | 2048² | face | 2.65 | **2.25** [4.51] | 1408 | 1408² |
| fedora | tangent-space normal | 512² | **512²** | face | 1.32 | **1.13** [1.13] | 1408 | 512² (short) |

Bold marks a texture that did not resolve at its framing. "Needs" is the
smallest edge, rounded up to a multiple of 128 (WebGL2 mipmaps any size), at
which 90% of the area resolves. "Ships now" is the packers' policy
(`scripts/lib/textureSizing.ts`): the need, never below the pack's default nor
above the source or 2048.

## What is low-resolution, and why

1. **Almost nothing at the source.** Every scalp-hair strand map, every suit
   and the fedora's albedo were packed at half or a quarter of the original's
   resolution, because the packers capped every texture at 1024 (a
   `TEXTURE_MAX` in `scripts/lib/packWriter.ts` and `scripts/lib/packHair.ts`).
   At the originals' own resolution, 8 of the 10 hair styles and every suit
   resolve. This is a matter of re-sourcing, not upscaling. A higher-resolution
   original exists: it is the file the packer already reads. The packers now
   size each texture by its need (`scripts/lib/textureSizing.ts`).
2. **The originals fall short in only three places:** the eye's albedo (1024²,
   needs 1408), the female sportsuit's normal map (1024², needs 1536) and the
   fedora's normal map (512², needs 1408). These are the only candidates for an
   upscale, and none is upscaled ([upscale.md](./upscale.md)). All three are MakeHuman CC0 assets with no higher-resolution
   release, so there is nothing to re-source them from. The fabrics are baked
   to each garment's UV layout, so a tiling ambientCG or Poly Haven material
   cannot replace them without re-texturing the garment, which would be new
   art rather than a resample.
3. **Four hair styles (bob02, long01, the ponytail and the braid) need 2176 to
   4608.** Their cards stretch a 2048² atlas over a long fall of hair. They ship
   at their full 2048²: a texture never exceeds 2048 (16 MB on the GPU, 21 MB
   with mipmaps).
4. **The body-UV bakes are the coarsest surfaces on the figure.** These are
   the field atlas and the body-art texture, at 0.4–1.1 texels/mm. The field
   atlas holds smooth fields (masks and coordinates that the shader
   interpolates), so its resolution does not show. The body-art texture holds
   ink, and it does show (below).

## The pixelated forearm tattoo was the bake, not the image

On the forearm, the body-art texture has 0.44 texels/mm (1024² over the whole
body's UV layout). The QA sheet's compass is 10 cm across, so it gets 44
texels. Its 256-pixel image has 2.56 px/mm there, 5.8 times more. The image's
6-pixel outer ring is 2.3 mm wide, about one texel of the bake. Its 3-pixel
inner ring is half a texel, which is why the ring breaks into dots. The screen
at that framing has 3.44 px/mm, so each bake texel covers about 8 screen pixels.
Upscaling the image cannot help, because the bake throws away 83% of the
resolution it already has.

Raising the bake's size does not fix it. Resolving the forearm needs 8448²
(two RGBA8 pages, 571 MB per figure), and at 2048² (32 MB per figure) each texel
still covers four screen pixels. A fix has to stop baking the ink's colour
into body UV. The options were a UV window of its own per tattoo (the same bake
through a camera fitted to the tattoo's UV bounds: 5.1 texels/mm in a 512²
window), or sampling the tattoo's image in the skin shader.

**Fixed on integration by the body-art lane** (3d8360f, "tattoos as decals
sampled at screen detail, not baked colour"). The bake now stores, per texel,
the place in the tattoo that covers it, and the skin shader samples the
tattoo's own image there, mipmapped, never finer than the ink's spread in the
dermis (`INK_SPREAD`, 0.2 mm). That left the playground's images as the limit:
256 px over the sheet's 10 cm compass is 0.39 mm a pixel, coarser than both the
ink and the forearm framing's 0.29 mm screen pixel. They are drawn from vector
paths, so `playground/src/tattooImages.ts` now draws them at 512 px (0.2 mm a
pixel, the ink's own spread) from the same 256-unit design. That is exact, and
needs no upscaler.
