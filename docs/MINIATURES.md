# Miniatures: hundreds of small figures in a few draw calls

Status: being implemented in stages (issue #12). Done: MakeHuman proxy bodies,
`posedFigure`, the multi-pose decimator, `bakeMiniature` and its binary (with
the CPU lab `scripts/research/miniature-lab.ts`); the instanced runtime
(`MiniatureCrowd` in `src/render/miniature.ts`, `<Miniatures>` in `src/react`)
with a browser test of its shader; and the numeric budget test
(`tests/miniatureBudget.test.ts`); and the 500-figure stress lab in the
playground (`?miniatures=500`) with its Playwright check
(`e2e/miniatures.spec.ts`).

## Measured (2026-10-13)

Four dressed archetypes, each baked from `proxy741` with three clips (walk,
idle, crouch: 102 frames at 15 fps):

| | Measured | Budget |
| --- | --- | --- |
| Triangles per figure | 1,499 near, 399 far | about 1,500 and 400 |
| Vertex-animation textures per archetype | about 1.0 MB | at most 4 MB |
| An archetype's binary, gzipped | about 0.57 MB | at most 1.5 MB |
| A 600-figure table (554 in view) | 8 draw calls, 235 k triangles | at most 20 and 250 k |
| CPU per frame (cull, LOD, instances) | about 0.2 ms in Node | |
| Bake time per archetype | about 1 to 1.6 s with clips, 0.15 s static | |
| The stress lab, 500 figures, headless Chrome on an M1 Pro (Metal) | 8 draws, 204 k triangles; frame 16.7 ms median, 20.5 ms p95 | the display's rate, as one figure draws it (16.5 median, 20.2 p95) |

The lab's frame times are the host's: one figure and 500 differ by under a
millisecond, so the crowd fits inside a 60 fps frame and the p95 is headless
Chrome's frame pacing. The check therefore holds the crowd to the one-figure
frame on the same machine, and judges frame time only when the page's WebGL
renderer is a GPU (never SwiftShader).

## Why

The live path draws one figure at a time: subdivision 0 is still the full
19,158-vertex control mesh, skinned per figure on the GPU, with fold and skin
textures per figure. That is right for a hero figure and impossible for a table
of 300 to 600 small ones on a phone. A strategy game needs each archetype (a
dressed recipe) baked once into a few hundred triangles and drawn for every
figure of that archetype in one call.

## Use cases

| # | Use | Needs |
| --- | --- | --- |
| U1 | Static castings: brigade stands of 8 to 12 figures, one posed stance per archetype, the base slides (the consumer's own narrowing on the issue) | A whole dressed figure posed by arbitrary `BoneRotations`, at a fixed low triangle count; per-instance transform and tint; no runtime animation |
| U2 | Animated crowds: walk, idle, crouch looping with each figure at its own phase | Per-instance clip and phase, the same skinning the full renderer draws, a load and memory budget per archetype |
| U3 | Offline bakes in a build step, committed with the game | Deterministic output (same recipe and options, same bytes); a compact binary; runs in Node, a worker or a headless page and returns transferable buffers |
| U4 | Reading at 40 to 120 pixels tall | The silhouette survives: head, hands, hat brim, coat skirts, the gap between the legs |
| U5 | Generals at 1.6 times scale, regiments in their colours | Per-instance scale and tint channels (coat, trousers, hat) over colours baked from the garments' own textures |
| U6 | A MakeHuman user who picked a proxy (`proxy741`, `male1591`, `female1605`) | The kit fits the same proxy to the same figure (ruling 3, parity) |
| U7 | Consumer-side pipelines (their own decimation, their own engine) | One call that returns the dressed, posed figure as parts, with body regions per vertex, garment order guaranteed |

## Budgets (from the issue; Pixel 7 / iPhone 13 class, Galaxy Z Fold 5, Steam Deck)

| | Budget |
| --- | --- |
| All figures together | at most 20 draw calls (one per archetype and LOD), at most 250 k triangles |
| Per figure | about 1.5 k triangles near, about 400 far |
| Animation | vertex-animation textures at most 4 MB per archetype |
| Load | an archetype's mesh and animations at most 1.5 MB transferred |

600 figures at 400 triangles is 240 k, so most of a full table must be far:
the runtime chooses LODs against the triangle budget (nearest first), not by a
fixed distance.

## Options weighed

**A. A baked, decimated mesh per archetype with vertex-animation textures
(VAT).** The figure is posed on the CPU by the kit's own skinning
(`skinPositions`: the shader's blend of linear and dual-quaternion skinning,
with the hip fold) for every frame of every clip, decimated once to a vertex
subset of the full mesh, and the subset's positions and normals per frame are
written to a texture. One `InstancedMesh` per archetype and LOD; the vertex
shader reads its frame from the texture by instance clip and phase. A static
casting is the one-frame case: a texture of one row per thousand vertices.

- Fits U1 to U5. Draw calls: archetypes times LODs. Vertex cost per figure is
  two texture reads, no bones.
- What is drawn is exactly what the full renderer would draw in that pose,
  corrective included: the blend of skinning schemes and the hip fold are
  baked, not re-implemented in a second shader.
- Memory: about 12 bytes per vertex per frame (half-float position, 8-bit
  normal). A 1,000-vertex near LOD with three 32-frame clips is about 1.2 MB.
- Cost: no runtime blending between clips beyond a crossfade of two sampled
  clips; new clips need a re-bake.

**B. A decimated `SkinnedMesh` on a shared skeleton, skinned in batches.**
One decimated mesh per archetype keeps bone weights; each instance carries a
bone palette (163 bones in MakeHuman's default rig, or a reduced rig).

- Fits U2 with arbitrary blending and procedural motion.
- 500 figures times 163 bones is 81,500 matrices to animate on the CPU and
  upload every frame, the heaviest single cost on a phone; a baked bone texture
  avoids the upload but keeps four weighted bones per vertex in the shader.
- It would not draw the same body: the dual-quaternion share per bone and the
  hip fold are part of the full shader and would have to be re-implemented, or
  the miniature deforms worse than the figure it stands for.
- U1 gains nothing from a skeleton.

**C. MakeHuman's own low-poly proxy bodies.** The system assets ship CC0 proxy
topologies bound to the base mesh exactly like garments: `proxy741` (741
vertices, 1,460 triangles), `male1591` (3,140), `female1605` (3,168). Any of
them follows every morph through its binding, and its skin weights come from
the base vertices it is bound to (MakeHuman's own rule).

- This is a body source, not a runtime: it is orthogonal to A and B.
- Assets first (ruling 2): an artist-made low-poly body with clean joint loops
  deforms better than a decimated dense one at the same count.
- Parity (ruling 3): the kit has no proxy support at all today. A MakeHuman user
  who chose a proxy gets the same topology only once the kit fits proxies.
- It does not cover the garments, and no proxy reaches 400 triangles.

## Decision

**C as the body, decimation for the rest, A for the runtime.** B is rejected
for phones: its per-frame bone work grows with the figure count and it would
draw a different body from the full renderer.

1. **Proxy bodies are a core capability.** The body pack ships MakeHuman's
   low-poly proxies (`proxy741`, `male1591`, `female1605`) from the CC0 system
   assets, packed by the same compiler and licence gate as the attachments.
   `HumanoidModel.proxyTopology(id)` gives a proxy's static data and
   `fitProxy` places it on an evaluated figure. Its skin is `bindingSkin` (each
   proxy vertex blends its three base vertices' weights, as MakeHuman does).
   Under clothes a proxy vertex shows when at least two of its three base
   vertices show (`transferVisibility`, the rule the kit already applies to a
   garment under another, and MakeHuman's `transferVertexMaskToProxy`), and a
   face shows unless all its corners are hidden. The proxy names are
   MakeHuman's own names for its topologies; none is tied to the figure's frame
   (ruling 1).
2. **`posedFigure(model, recipe, rotations)`** returns the whole dressed figure
   in a pose as parts (`body`, then each garment in `outfit.order`), each with
   positions, normals, triangles, UVs and a body region per vertex. It answers
   U7 on its own and is what the bake samples.
3. **The decimator** (`src/bake/decimate.ts`) is quadric edge collapse with
   three choices that make it fit:
   - **Half-edge collapse only.** A vertex always collapses onto an existing
     neighbour, so every LOD is a subset of the full vertices. Positions per
     frame are a gather, the topology is the same in every frame and every
     pose, and nested LODs share one vertex set and one VAT.
   - **Multi-pose error.** Each vertex's quadric is summed over sample frames
     (frames spread evenly over every clip, or a casting's one pose), so a collapse that is
     harmless at rest but tears a knee in the walk is expensive. A collapse that
     flips or degenerates a triangle in any sample frame is refused.
   - **Silhouette weight.** Open boundaries (a coat's hem, a hat's brim, a
     cuff) carry a boundary quadric, and the head and hands (by body region)
     cost more to simplify, so the features read at small size keep their
     triangles longest. Parts never merge: a garment and the body are separate
     components.
   It is deterministic: plain arithmetic, ties broken by vertex index. The kit
   writes its own rather than depending on meshoptimizer because it needs the
   vertex-subset constraint, the per-pose quadrics and the region weights
   together, and because the core has no binary dependencies.
   Borders hold by what they are: a garment's (hems, brims) firmly, the body's
   (its sockets and the edges the outfit cut away) weakly, since nobody sees
   them as lines.
4. **Normals per level.** A kept vertex stands for the patch merged into it, so
   each level carries its own normals per frame: the mean of the full normals
   of that patch. With the kept point's own normal, a socket's rim shaded half a
   far face dark.
5. **Colour is baked per vertex.** Each kept vertex gets the area-weighted mean
   colour of the full-resolution vertices that collapsed into it (by area, so a
   densely stitched hem does not spread over a shirt): skin from the recipe's
   tone (`skinAlbedo`), garments from their own diffuse textures sampled at
   their UVs, scalp hair painted from its colour over the scalp the style grows
   from. Each vertex also carries a tint channel (0 skin, never tinted; 1 upper
   garment; 2 lower garment; 3 hat, shoes and the rest) so a regiment's coat
   and trousers take per-instance colours (U5). The channel follows the body
   region a garment vertex covers, so a long coat's skirt over the thighs takes
   the lower channel; a channel per garment is the follow-up if a consumer
   needs it. No texture is sampled at run time except the VAT.
6. **`bakeMiniature(model, recipe, options)`** returns a `MiniatureBake`: one
   vertex set (the near LOD's), colours and tint channels per vertex, positions
   for every frame of every clip (or the one pose of a static casting), and per
   LOD an index buffer and its normals. `encodeMiniature` and
   `decodeMiniature` turn it into one binary (half-float positions, octahedral
   byte normals), so a build step can commit it and a page or worker can
   transfer it.
7. **The runtime** (`src/render/miniature.ts`, `src/react`) builds one
   `InstancedMesh` per archetype and LOD over the shared vertex set, reads the
   frame from the VAT in the vertex shader by per-instance clip, phase and
   speed, and multiplies the baked colour by the instance's tint channels. Each
   frame it assigns LODs nearest first while the triangle budget lasts and
   culls instances outside the frustum, so the whole table is
   archetypes times LODs draw calls.
8. **Selected facial alpha cards (opt-in).** `bakeMiniature` keeps selected
   `recipe.facialHair` attachments out of opaque decimation when given
   `facialHair: "alpha-cards"`. The caller supplies each decoded RGBA source
   image through `texture`; the resulting `alphaCards` carry source topology,
   UV seams, posed frames, tint and embedded RGBA pixels without a runtime URL.
   Decoded rows run top to bottom (`sharp` or Canvas `getImageData`). The
   source map uses the live image convention: flipped Y upload, linear filtering
   and generated mipmaps. `textureBytes` includes every retained mip level.
   Use straight RGBA that preserves transparent RGB for filtered colour fidelity;
   Canvas decoding may round low-alpha RGB and discard fully transparent RGB.
   By default the runtime draws alpha-tested companion meshes only at the finest
   body LOD. Set `facialHairLod: "all"` on `MiniatureCrowd` or `<Miniatures>` to
   retain the exact authored cards at every body LOD, including their baked
   frames, clip timing, source alpha and multisample edge coverage. This reuses
   the same card meshes, VATs and source maps; it adds no payload or textures.
   Each selected source card adds one instanced draw per visible archetype and
   its full source triangles per figure. These costs are included in frame
   stats and LOD budget decisions. If even the coarsest bodies plus retained
   cards exceed `triangleBudget`, the crowd draws them and reports the excess;
   the budget does not cull visible figures or remove opted-in source cards.
   This is appearance retention with full source costs, not a far optimization
   or conversion into a solid miniature representation.

## What stays out

- **The adult pack.** The miniature path never evaluates it. `bakeMiniature`
  refuses a model built with the adult anatomy pack (`MiniatureError`); a game
  that also draws full figures builds a second model without it for baking.
  At miniature size there is nothing to show, and a baked binary that a game
  commits must never carry adult data.
- **Teeth, tongue, brows and lashes.** Interior or under a pixel at miniature
  size; left out. The eyes stay: without them a proxy's sockets are holes, and
  a decimated face reads as a mask.
- **Solid facial hair.** Source alpha cards can be preserved as an opt-in
  companion payload at the finest or every body LOD, but cannot be decimated into a solid
  silhouette. A source-backed solid miniature representation for distant or
  painted miniatures remains a follow-up.

## Stages

1. Proxy bodies (pack, format, fitting, masking, skin), `posedFigure`, the
   decimator and `bakeMiniature` with its binary, in `src/bake` (no rendering
   dependencies). Unit tests: proxy fit follows morphs, masking follows
   MakeHuman 2, decimation meets each LOD's triangle target, keeps a subset,
   never flips a triangle in a sample frame, and is byte-deterministic.
2. The instanced runtime and its React component.
3. A numeric budget test: triangles per LOD, draw calls for a table of
   archetypes, VAT bytes and encoded size per archetype.
4. A stress lab: 500 figures in the playground (`?miniatures=500`), its
   capture and a frame-time measurement against one figure (done).
