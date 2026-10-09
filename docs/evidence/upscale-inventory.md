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
  (`bodyArtImages`). The playground draws its two on 256² canvases from vector
  paths (`playground/src/tattooImages.ts`), so they are already resolution-free.

These are the rasters that do ship, with each texture's surface-area-weighted
median texel density and the density 90% of its area meets. A bracketed figure
is that same density at the source's own resolution.

| Surface | Channels | Shipped | Source | Framing | Median | 90% covered | Needs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| field atlas, body-art bake | per-figure, body UV | 1024² | — | forearm | 0.44 | 0.42 | 16384 |
| ″ | ″ | ″ | — | face | 1.09 | 0.71 | 8192 |
| ″ | ″ | ″ | — | hand | 0.63 | 0.56 | 16384 |
| eye (brown) | sRGB albedo, cornea alpha | 1024² | 1024² | face | 3.56 | **2.12** [2.12] | 2048 |
| teeth | sRGB albedo, alpha | 1024² | 2048² | face | 4.57 | 4.20 [8.40] | 1024 |
| tongue | sRGB albedo | 1024² | 1024² | face | 6.86 | 5.22 | 1024 |
| scalp hair, 10 styles | strand luminance, card alpha | 1024² | 2048² | face | 1.00–16.6 | **0.64–1.79** [1.28–3.58] | 2048–8192 |
| eyebrows, 12 | coverage alpha | 512² | 512² | face | 5.45–9.02 | 3.80–6.91 | 256–512 |
| eyelashes, 4 | coverage alpha | 512² | 512² | face | 8.24–10.0 | 4.91–9.88 | 256–512 |
| suits, 11 | sRGB albedo | 1024² | 2048² | clothed | 0.44–0.85 | **0.36–0.69** [0.73–1.39] | 1024–2048 |
| suits, 10 | tangent-space normal | 1024² | 2048²–4096² | clothed | 0.44–0.85 | **0.36–0.69** [0.96–2.78] | 1024–2048 |
| female sportsuit | tangent-space normal | 1024² | **1024²** | clothed | 0.66 | **0.48** [0.48] | 2048 |
| shoes, 6 | albedo, 2 normals | 1024² | 1024² | clothed | 1.89–2.83 | 0.75–1.01 | 1024 |
| fedora | sRGB albedo | 1024² | 2048² | face | 2.65 | **2.25** [4.51] | 2048 |
| fedora | tangent-space normal | 512² | **512²** | face | 1.32 | **1.13** [1.13] | 2048 |

Bold marks a texture that does not resolve at its framing.

## What is low-resolution, and why

1. **Almost nothing at the source.** Every scalp-hair strand map, every suit
   and the fedora's albedo are packed at half or a quarter of the original's
   resolution, because the packers cap every texture at 1024
   (`TEXTURE_MAX` in `scripts/lib/packWriter.ts` and `scripts/lib/packHair.ts`).
   At the originals' own resolution, 8 of the 10 hair styles and every suit
   resolve. This is a matter of re-sourcing, not upscaling. A higher-resolution
   original exists: it is the file the packer already reads.
2. **The originals fall short in only three places:** the eye's albedo (1024²,
   needs 2048), the female sportsuit's normal map (1024², needs 2048) and the
   fedora's normal map (512², needs 2048). These are the only candidates for an
   upscale. All three are MakeHuman CC0 assets with no higher-resolution
   release, so there is nothing to re-source them from. The fabrics are baked
   to each garment's UV layout, so a tiling ambientCG or Poly Haven material
   cannot replace them without re-texturing the garment, which would be new
   art rather than a resample.
3. **Two hair styles (bob02, long01) and the ponytail and braid need 4096 to
   8192.** Their cards stretch a 2048² atlas over a long fall of hair. They stay
   at 2048 (see the ceiling below).
4. **The body-UV bakes are the coarsest surfaces on the figure.** These are
   the field atlas and the body-art texture, at 0.4–1.1 texels/mm. The field
   atlas holds smooth fields (masks and coordinates that the shader
   interpolates), so its resolution does not show. The body-art texture holds
   ink, and it does show (below).

## The pixelated forearm tattoo is the bake, not the image

On the forearm, the body-art texture has 0.44 texels/mm (1024² over the whole
body's UV layout). The QA sheet's compass is 10 cm across, so it gets 44
texels. Its 256-pixel image has 2.56 px/mm there, 5.8 times more. The image's
6-pixel outer ring is 2.3 mm wide, about one texel of the bake. Its 3-pixel
inner ring is half a texel, which is why the ring breaks into dots. The screen
at that framing has 3.44 px/mm, so each bake texel covers about 8 screen pixels.
Upscaling the image cannot help, because the bake throws away 83% of the
resolution it already has.

The fixes, in the body-art owner's code (`src/render/bodyArtTexture.ts`), are:

- **Raising the bake's size is not one.** Resolving the forearm needs 8192²
  (two RGBA8 pages, 512 MB per figure). At 2048² (32 MB per figure) each texel
  still covers four screen pixels.
- **Bake each tattoo into a UV window of its own.** Keep the projection, the
  seam handling and the ink spread exactly as they are. Draw each tattoo
  through an orthographic camera fitted to the UV bounding box of the
  triangles it covers, instead of the whole 0–1 square. The skin shader then
  maps a texel's UV into that window. A 10 cm forearm tattoo spans about 0.043
  of the UV square (44 of 1024 texels), so a 512² window gives it 5.1 texels/mm, which resolves the
  forearm framing at 2 MB per tattoo (two RGBA8 pages). That is a quarter of
  today's 8 MB per figure. A tattoo that crosses a UV seam gets one window per
  island it covers.
- **Or sample the image in the skin shader.** Project the fragment's rest-space
  position into the decal frame, with no bake for ink. This resolves at the
  image's own density, but it adds a rest-position vertex attribute and moves
  the facing, reach and ink-spread logic into the skin shader.

The playground's images would then be the limit: 2.56 px/mm at 10 cm against
the forearm's 3.44. They are drawn from vector paths, so drawing them at 512²
instead of 256² (5.1 px/mm) is exact and needs no upscaler.
