# Collar surface isolation — 2026-10-12

**Status: causal witness only; no appearance fix accepted.** The existing finite collar
comparison showed bright triangular-looking collar marks under `SkinMaterial` and no matching
marks under `MeshNormalMaterial`. That pair was not a causal material comparison: replacing the
product material also disabled humanoid-kit's mixed dual-bone/fold skinning in the twisted pose.

`tests/browser/collarSurfaceIsolation.test.tsx` keeps one settled adult female (age 30, balanced
macro anchors, the existing four-birthmark fixture) in the `twisted` pose. It retains the actual
visible `SkinMaterial`, product `DualBones`, body mesh, StudioStage lights, and the Canvas main
camera. The camera is framed from the current `clavicle.L`, `clavicle.R`, and `neck01` bone world
positions with the same target offset and distance as the finite pose/surface lab.

It captures four 512px main-camera frames:

1. product baseline;
2. only the public `normalMap` disabled;
3. only the public `SkinMaterial.setLayerAtlas(null)` state applied;
4. both disabled.

The test restores the original normal map, normal scale and exact active atlas in `finally`.
It asserts byte-identical camera and dual-bone texture values across the four captures, then reads
the centred 256px collar region. No product shader constant, geometry, quality threshold, or
appearance baseline changes.

## First controlled capture

Remote Metal browser run on `.202` passed:

```text
heavy-slot job: render-8cfd601c25734491881328ea5777238e
tests/browser/collarSurfaceIsolation.test.tsx: 1 passed
collar-centred changed pixels from baseline:
  pores off:  11,413
  layers off: 11,788
  both off:   20,664
```

The passed job retained four separate Canvas-main-camera PNGs for direct review:

- `.heavy-slot/remote-artifacts/render-8cfd601c25734491881328ea5777238e/test-results/collar-surface-isolation/baseline.png`
- `.heavy-slot/remote-artifacts/render-8cfd601c25734491881328ea5777238e/test-results/collar-surface-isolation/pores-off.png`
- `.heavy-slot/remote-artifacts/render-8cfd601c25734491881328ea5777238e/test-results/collar-surface-isolation/layers-off.png`
- `.heavy-slot/remote-artifacts/render-8cfd601c25734491881328ea5777238e/test-results/collar-surface-isolation/both-off.png`

Before saving each PNG, the test reads an offscreen target from the exact Canvas main-camera
object, re-renders that same scene and camera to the Canvas, and then screenshots that canvas
element. It also checks the camera's full world matrix and the product dual-bone texture bytes are
identical in every receipt. The `layers-off` state uses `setLayerAtlas(null)`, so it removes the
whole skin-layer atlas rather than only the clavicle layer.

This proves both the pore map and the layer atlas materially affect the exact collar framing while
the product's skinning and camera remain fixed. It does **not** by itself prove which input creates
the observed triangular contour: direct visual review of the four captured states is still needed.
Source tracing identifies the collar-local layer candidate as the detail-only `CLAVICLE_LAYER`
(`src/surface/regions/torso.ts`), whose height reaches the product normal perturbation through
`SkinMaterial.hkDetailHeight`; it does not paint a white colour. No clavicle implementation change
is authorized from this evidence alone.

## Single-layer clavicle witness

After direct review showed that the bright marks remain in the baseline and pores-off captures but
vanish when every atlas layer is disabled, the test added one fifth capture: `clavicle-off`. It does
not alter the product source atlas, its recipe, or any shader API. It makes two test-owned clones:

- the body `layerFields` clone has only the `CLAVICLE_LAYER` (`clavicles`) row zeroed before a
  temporary `buildLayerAtlas` call;
- the current material's half-float stop-table clone has only that same row zeroed before it is
  assigned as the material uniform for the capture.

The `.202` Metal run recorded `clavicles` at layer index 5. The sole altered field range was
`[557840, 669408)` (111,568 `Float32` entries); the sole altered stop-table range was `[180, 216)`
(36 `Uint16` entries). The test asserts every value outside those intervals is identical to the
active product data, retains the exact atlas plan, and restores/disposes both clones in `finally`.
It repeats the main-camera and dual-bone-byte receipts for this fifth state.

```text
heavy-slot job: render-cc065899dbb6414eb9e57f72dbf3ab16
tests/browser/collarSurfaceIsolation.test.tsx: 1 passed
baseline → clavicle-off, collar-centred changed pixels: 16,293
```

The direct review pair is retained at:

- `.heavy-slot/remote-artifacts/render-cc065899dbb6414eb9e57f72dbf3ab16/test-results/collar-surface-isolation/baseline.png`
- `.heavy-slot/remote-artifacts/render-cc065899dbb6414eb9e57f72dbf3ab16/test-results/collar-surface-isolation/clavicle-off.png`

The other three controls (`pores-off`, `layers-off`, `both-off`) are adjacent. This is an isolated
causal witness for review, not authorization to blur, retune, or otherwise repair the clavicle
surface. The broad shoulder angularity was visible independently and remains a separate question.

## Why the clavicle layer makes triangles

The fourth witness isolates a field interpolation error, rather than a pore, normal-map, atlas-owner
or coordinate-cutoff error. `clavicleFields` measures an S-bowed projection and a product of smooth
mask windows at base vertices. `HumanoidModel.renderLayerFields` carries those sampled values through
the body subdivision stencil; `buildLayerAtlas` then linearly rasterises the render-vertex values in
each triangle. The projection and mask are not linear over those triangles, so their height gradients
can change abruptly at a triangle's shared diagonal even though the values themselves are continuous.

The prior unit check walks the control mesh's quad perimeter edges. It does not inspect the render
triangles' shared diagonals, which is where this failure occurs. A bounded CPU receipt against the
same female-30 topology found symmetric interior pairs with masks from 0.604 to 0.876 and coordinates
from 0.267 to 0.519, far from either clamped coordinate end or a zero-mask cutoff. Their unit-height
three-dimensional height-gradient jump is 102.815/m. At the fixture's approximately 0.89 mm effective
relief, that becomes about a 0.0915 normal-slope change at one internal edge.

The browser diagnostic reads the actual product 1024px atlas at the corresponding worst UV edge:

```text
heavy-slot job: render-4dc36594faba4889bf97e34c26690322
shared edge: 5766:15122 (render triangles 26533, 27194)
unit-height UV-gradient jump: 90.70094796304632
interpolated source [mask, coordinate]: [0.9535188562, 0.3755384423]
read product atlas [mask, coordinate]:        [0.9529411793, 0.3764705956]
owner map / expected owner id: 2 / 2
```

The difference is the expected 8-bit field quantisation. The owner map agrees exactly, so a shared
channel neither substitutes a different layer nor creates this seam. The test reads a temporary atlas
from the unchanged topology and disposes it before the captures.

### Repair proposal for review

Do not suppress the layer, reduce its height globally, blur the atlas, or change its anatomical ridge /
fossa profile. Add an optional render-vertex field evaluator to the layer contract and use it only for
the non-linear clavicle projection. `HumanoidModel` can obtain its static rest render positions by
applying the existing body stencil to `assets.positions`; the clavicle evaluator should then measure
the current projection and mask directly at those render vertices, retaining the existing base evaluator
for other callers. The atlas will still rasterise normally, but it will start from field samples on the
actual render surface rather than interpolated control-mesh samples.

The red contract should compare the topology's clavicle row with that direct render-vertex evaluator
for the fixed fixture, without an appearance threshold; it fails now because the row is only stencil-
carried. The green browser witness must retain the fixed camera, product material, dual bones and
clavicle profile while the reviewed baseline capture loses the triangular highlights. No repair has
been implemented or accepted from this proposal.
