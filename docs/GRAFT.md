# Grafting a foreign part

A graft joins a foreign mesh (a head, a prosthetic hand, a creature foot, a helmet) to a
figure as one continuous, watertight surface. The figure's body is cut at a loop and the
part is refit to that loop on every evaluation, so a recipe that changes the neck's girth,
the figure's height or its age moves and resizes the part with the body. The part is bound
to the skeleton, so it follows the figure's poses.

This is how the kit uses community parts (docs/DECISIONS.md, ruling 2). The module is
`src/graft/`: it is core code with no rendering dependencies. Its entry point on a model is
`HumanoidModel.graft`.

## Use cases

1. A head with or without its own neck stump, grafted at the neck. This is the first
   consumer.
2. A prosthetic or creature hand at a wrist, or a foot at an ankle.
3. A part whose seam the caller supplies (a vertex loop, or a plane that trims the part),
   instead of the detected open boundary.
4. Any recipe: macros and modifiers move the cut loop, and the part follows on every
   evaluation.
5. Any pose: the part follows its root bone, and the seam stays closed.

## The design, and why

Three designs were weighed (issue 11 has the full comparison):

- **Cut and close the control mesh, then subdivide the merged mesh.** This was rejected.
  Every body field built on the subdivision (stencils, UV seams, skin layers, occlusion
  bakes) would have to be rebuilt for every part, and the part's resolution would be
  forced onto the control mesh's.
- **Snap the part's rim onto the body's loop, with no band.** This was rejected. It needs
  the two loops to have equal vertex counts, or a re-triangulation of the part's first
  ring, which no general part guarantees.
- **Hide the cut faces, and bridge the loop to the rigid part with a new band.** This was
  chosen. The body surface stays exactly what it is: the cut is a face mask, like the one a
  garment applies (`faceVisibility` and `maskIndex`, in `src/model/outfit.ts`). Its
  boundary is the subdivided image of a control-mesh edge loop at every level. Only the
  band and the part are new vertices, and they share the body's loop vertices, so the
  result is welded. The band and its skinning generalise the adult pack's reservoirs, which
  bridge a loop on the body to a part with a band of rings and blend skin weights across
  it into a root bone (`src/build/reservoir.ts`, `src/model/reservoirSkin.ts`).

## The cut-loop registry

`CUT_SITES` (`src/graft/sites.ts`) names the places a part can be grafted: `neck`,
`wrist.L`, `wrist.R`, `ankle.L` and `ankle.R`. A site is not a hand-listed vertex loop. It
is a rule that resolves to one:

- **Its plane.** The plane runs through a point a fraction `at` along two skeleton joints
  (`from`, then `to`; bone heads, from the body pack's `skeleton.joints`), with its normal
  along them. The normal points to the side that is removed.
  - The neck runs from `neck01` to `head`, at 0.3 of the way.
  - A wrist runs from `lowerarm01` to `wrist`, at the wrist itself.
  - An ankle runs from `lowerleg01` to `foot`, at the ankle itself.
- **Its seed.** The removed region starts at the body face, among those whose centre is on
  the removed side, that lies nearest the `to` joint.
- **Its root bone.** This is the bone the part is bound to: `head`, `wrist.L`, `foot.L` and
  so on.
- **Its forward direction.** This is the body's front (+z), the direction a loop's samples
  start from, so that a part's front meets the body's front.

A site is resolved once per model, on the base mesh at rest (`resolveCut`):

1. Flood-fill the body's control faces from the seed, through shared edges, keeping faces
   whose centre is on the removed side.
2. Fill in any kept face that is cut off from the rest of the body. At the neck, for
   example, the chin dips below the plane and would otherwise leave an island.

The removed faces' boundary must then be one simple closed edge loop: every vertex on it
has exactly two boundary edges. Anything else is a `GraftError`, so the topology is
deterministic and cannot change with a recipe.

On hm08 at rest, the loops have these control edge counts:

| Site    | Edges |
| ------- | ----- |
| neck    | 46    |
| wrist   | 24    |
| ankle   | 30    |

`tests/graft.test.ts` pins these counts.

A caller can supply its own cut instead of naming a site: a plane with a seed point
(`{ plane, seed, rootBone }`), or the control faces to remove (`{ faces, rootBone }`).
Either one passes through the same single-loop check.

The cut also reports what it removes:

- **The attachments inside the removed region** (`GraftTopology.droppedAttachments`): an
  attachment is dropped when every reference vertex it is bound to is a vertex of a
  removed face. For a head, that is the eyes, teeth, tongue, brows and lashes.
- **The bones whose heads lie inside the region** (`GraftTopology.removedBones`). The
  part's vertices are bound to the root bone alone, so a face unit or a jaw pose never
  moves the part.

## The part's seam

The part is a triangle mesh: positions, triangles, and optionally normals, UVs and
material groups. Its vertices are welded by position first, so UV-seam duplicates do not
read as boundary. The seam is then one of these:

- **Detected** (the default): the longest boundary loop, made of the edges that only one
  triangle uses.
- **Supplied as a loop**: `{ loop: number[] }`, the part's vertex indices in order.
- **Supplied as a plane**: `{ plane: { point, normal } }`. The triangles whose centre is on
  the side the normal points to are trimmed away, and the longest boundary loop left is the
  seam.

## The fit, on every evaluation

A graft is built once per model and site (its topology). It is then evaluated against each
evaluation of the body (`Graft.evaluate`).

1. **Sample both loops.** The evaluated body loop and the part's rim are each resampled to
   `samples` points (64 by default) by arc length. Each starts at the loop vertex nearest
   its forward direction, which was chosen once, at rest, so the stitching never changes.
   Both loops wind counter-clockwise about their axis: for the body, the axis points into
   the removed side; for the part, it points from the rim into the part.
2. **Fair them.** The sampled loops are faired (Laplacian steps, at most 50) until no sample
   turns by more than `maxTurn` (40° by default). This is the same gate as the reservoirs'
   loops, because unfaired loops zigzag and fringe in the shading.
3. **Fit a similarity.** The part's samples are fitted to the body's by a similarity
   Procrustes transform (Umeyama 1991): a uniform scale, a rotation and a translation. The
   samples correspond in order, so the rotation about the loop's axis is fixed by the two
   forward directions, even for a round loop. An optional extra scale (`scale`: a number,
   or one per part axis) multiplies the part about its rim's centre before the fit. The
   fitted scale is then the ratio of the two loops' sizes, which is what ties a head's size
   to the neck it sits on.
4. **Leave a gap.** The part is placed `gap` (0.3 by default, in units of the body loop's
   RMS radius) beyond the body's loop, along the loop's axis. The band fills that gap.
5. **Blend the rim.** The part stays rigid except for a falloff band (`band`: 0.5 of the
   rim's RMS radius by default, measured along the part's edges from the rim, at rest).
   Inside that band each vertex moves by the residual between its rim point and the target
   (the faired body loop, shifted by the gap), weighted by a smoothstep from 1 at the rim to
   0 at the band's edge. The rim therefore lies exactly on the target loop.
6. **Build the bridge.** The band has `rings` rings (4 by default):
   - **Ring 0** is the body's own loop vertices.
   - **The last ring** is the part's rim vertices.
   - **The interior rings** are cubic Hermite curves from the faired body loop to the rim.
     At the body end, each curve leaves along the body surface's continuation (the body
     normal crossed with the loop's tangent). At the part end, it arrives along the part
     surface's continuation. Both tangents are scaled to the gap.
   - **The two zippers** (body loop to ring 1, last interior ring to the rim) are
     triangulated by merging the loops' rest arc-length parameters, so the band's triangles
     are fixed at build time.
   Because the curves leave and arrive along each surface, the band continues each surface
   to first order, and the normals meet with no crease.
7. **Shade it.** The body's vertices keep the body's normals. The band's and the part's
   normals are area-weighted over the merged triangles. Where the part supplies its own
   normals, they are rotated with the part outside the falloff band and blended toward the
   recomputed ones inside it.

## Rig binding

- **The body's vertices** keep their own skin weights.
- **The part's vertices** are bound to the site's root bone alone.
- **The band's vertices**, at a fraction `t` of the way from the body to the part, take the
  body loop's weights at that point of the loop. Those are blended into the root bone by a
  smoothstep of `t`, keeping the four largest weights, renormalised. This is the
  reservoirs' surface-distance blend, carried across the band.

The merged surface therefore skins with the rig's own skinning (`skinPositions`) like any
body vertex, and the part follows the head in every pose.

## API

```ts
import { HumanoidModel } from "humanoid-kit";

const model = new HumanoidModel(assets, { subdivision: 1 });
const graft = model.graft({
  at: "neck", // a CUT_SITES id, or { plane, seed, rootBone }, or { faces, rootBone }
  part: { positions, triangles, normals, uvs, groups, forward: [0, 0, 1] },
  // Optional: seam (detected by default), samples, rings, gap, band, scale, maxTurn.
});
const ev = model.evaluate(recipe);
const surface = graft.evaluate(ev);
// graft.topology: index, groups ("body", "bridge", then the part's own), vertexCount,
// skinIndex, skinWeight, loop, rim, removedFaces, droppedAttachments, removedBones,
// rootBone.
// surface: positions, normals (for every merged vertex, the body's first),
// and fit (scale, rotation, translation, loopRadius, turn: the largest ring turn in degrees).
```

A plane seam trims the part. Each of the part's groups then covers the kept triangles that
came from its range, and a group with nothing kept is dropped. Fit options are checked:
`gap` and `maxTurn` must be positive, `band` must not be negative, and every `scale` axis
must be positive and finite. Anything else throws a `GraftError`.

The merged vertices are laid out in this order: the body's render vertices (unchanged
ids), then the band's interior rings, then the part's vertices. The body's triangles inside
the cut, and those the mounted attachments hide, are left out of `index`.

A recipe does not carry the part. A part is geometry, and recipes stay plain JSON, so a
caller keeps the `Graft` and evaluates it beside the figure. The recipe-level form
`grafts: [{ at, part: "<id>" }]`, the worker client's entry point, and the figure's skin
renderer drawing a grafted body are the next steps. They are tracked in the follow-up issue
linked from issue 11.

## Proof

`tests/graft.test.ts` grafts a procedural head stand-in onto the neck. The stand-in is a
closed head with an open neck stump, a nose bump that marks its front, and UV-seam
duplicate vertices. It is authored in centimetres and turned off-axis, so the fit has to
find both the scale and the orientation.

Across the height, weight and age extremes, the test proves numerically:

- **Watertightness.** Once the body's UV-seam copies are welded, every edge is used by
  exactly two triangles.
- **Positional continuity.** The band shares the body's loop vertices, and the rim lies on
  the target loop to within 1e-5 m.
- **Normal continuity.** The dihedral angle across the seam, and across the rim, stays
  within the test's bound.
- **The turn gate.** No band ring turns by more than 40°.
- **Scale.** The fitted scale follows the neck loop's radius.

A posed variant shows that the part moves rigidly with the head bone.

`scripts/research/graft/` renders before and after captures (lit, zebra, normals, wire)
with a CPU rasteriser for review.
