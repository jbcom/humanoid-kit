# The adult sculpt: plan for the phase after the layer plumbing

Date: 2026-10-09. Status: design, nothing sculpted. This is the next phase of
milestone 3 ("Adult anatomy sculpt", docs/ARCHITECTURE.md, Roadmap): own
geometry for the adult anatomy, in the adult pack, for figures aged 18 or over,
bound to the hm08 base so it follows every body shape and pose. Phase 1 built
the layer, state and age-gating plumbing on today's CC0 targets
(docs/ARCHITECTURE.md, "Adult-pack layers"); this document is what that
plumbing is for, and what it found.

Everything here is subject to docs/AGE-POLICY.md: adult geometry exists only in
the separate `humanoid-kit-adult-anatomy` pack, no figure under 18 can reach it
in any channel (shape, colour, relief, state), and `pnpm check:pages` proves it
never ships on Pages. A design that cannot meet that is rejected below, whatever
else it offers.

**The sculpt is the critical path for milestone 3, not an option.** The CC0
`genitals/*` targets deform `helper-genital`, a face group the render surface
never draws, so the penis and testes skin layers and the engorgement state morph
are invisible until this phase puts adult geometry on the surface. Nothing built
in phase 1 can show without it, and no further plumbing makes it show.

## 1. What phase 1 found

Measured on the shipped packs (`tests/adultStack.test.ts` records that the
penis and testes fields reach no drawn vertex, so the day that changes, a test
fails and these notes get rewritten):

- The CC0 `genitals/penis-*` targets deform MakeHuman's `helper-genital` face
  group, 200 vertices, 182 quads, median edge 10 mm. **None of those vertices is
  in the `body` group**, which is all the render surface draws. So today the
  penis and testes targets, the engorgement state morph and the layers keyed on
  them move or colour geometry nobody sees.
- `pelvis/bulge-incr` is the one adult target that moves drawn skin: 57 of its
  328 vertices are body vertices (the rest are `helper-genital` and
  `helper-tights`).
- The base pelvis is coarse. Around the genital region the body has about 90
  quads, median edge 18.7 mm (maximum 38 mm); one Catmull-Clark level halves
  that to about 9 mm. The atlas texel there is about 2 mm. Structures the
  sculpt must carry (labial folds, a glans, a clitoral hood) are millimetres
  across; a 9 mm surface cannot hold them.
- The render surface is **static and shared across ages**: one body topology,
  built once, evaluated for every recipe. A static surface cannot be gated by
  age, which rules out the obvious fix of drawing `helper-genital` always.
- The packs already carry the machinery a graft needs: `.mhclo` bindings
  (`src/mhclo`), bound attachments with their own topology, skinning and
  occlusion (`ModelTopology.attachments`), and the rule that a body face is
  hidden only when all its corners are deleted (`deleteVerts`).

## 2. Use cases

The sculpt must serve these, in this order of how much of the design each
decides:

1. **A figure with no adult anatomy modelled**: any age, and any adult who does
   not use it. Identical to today, to the vertex. This is most figures, and it
   must cost nothing (no extra geometry, no extra evaluation).
2. **An adult with a penis and testes**, independently variable: length,
   girth, glans, foreskin presence, testes size and descent, scrotal form.
3. **An adult with a vulva**: mons, outer and inner labia, clitoris and hood,
   each independently variable.
4. **An adult with both, or with features between**: intersex variation is a
   real range of anatomy, not a corner case, and a creator for human figures
   should be able to author it without a workaround. Features are therefore
   independent, never one male-to-female slider (docs/ARCHITECTURE.md already
   records this; `appliedAnatomy` implements it for paint).
5. **Moving along the age slider across 18** in a creator: the surface changes
   at the boundary, in both directions, without a stale frame showing adult
   geometry on a figure that is no longer one.
6. **Posing and skinning** (milestone 2's rig): the anatomy follows pelvis and
   thigh motion with no tearing.
7. **Skin states** (docs/ARCHITECTURE.md, "Skin states"): colour and engorgement
   states act on the anatomy; the skin layers colour it.
8. **Clothing** (the lane in progress): garments `delete_verts` and sit over the
   region, so the anatomy must be coverable and must not poke through a
   `helper-tights`-shaped garment.
9. **Many figures at once** (a crowd): per-figure cost stays a few hundred
   bytes of paint plus one evaluation, as the base contract requires.

## 3. Constraints

- The base contract (docs/ARCHITECTURE.md, "Parallel work: the base contract")
  is frozen: the hm08 topology, vertex indices, UV layout and face groups; the
  pack format and `.mhclo` binding; the recipe schema, extended only by
  optional fields; the region layer interface. New vertices are appended after
  the base's 19,158; nothing is renumbered.
- Clean room. The own sculpt is authored here against the hm08 base only. The
  `genitals/*` and `helper-genital` data are CC0 and may be used as reference,
  but the shipped geometry is new, so the pack is MIT-clean regardless of what
  any proxy mesh elsewhere is licensed as.
- Adult geometry never in the body pack, never in a static topology (the
  property phase 1 established for layer fields and extends to geometry), never
  in an evaluation under 18.
- Dimensions are measured, or labelled as choices. Penile length and
  circumference have verified distributions (research/SKIN-STATES.md, B4:
  flaccid 9.16 cm length and 9.31 cm circumference, Veale et al.). **No verified
  open measurements of vulvar, labial or clitoral dimensions were gathered**;
  they are the first research task (section 8), and until then no vulvar number
  appears in code as if it were measured.

## 4. Decision 1: how the geometry reaches the surface

Three ways to put adult geometry on a figure whose base surface has none.

**A. A worn attachment with `delete_verts`.** The graft is a bound mesh like the
eyes and teeth; body faces under it are hidden. Reuses everything. But the
hidden faces are removed from the one static body surface, so every figure,
including every minor, loses them; the model would have to be built "wearing"
it or not, per model, and an age slider crossing 18 in one creator has one
model. Rejected.

**B. An overlay attachment with no deleted faces.** The graft sits over intact
body skin. No hole, no seam, and the body is unchanged for everyone. But the
graft's boundary coincides with the skin it grows out of, so it z-fights unless
it is offset, and an offset ridge is a visible rim. The attachment's mesh is in
`ModelTopology.attachments` and so in every figure's static data, which breaks
the property above unless it is also gated at draw time, where a bug draws it.
Rejected.

**C. An adult surface variant, selected by the age gate inside the model.**
The adult pack ships a second body surface: the base faces with the pelvic
region cut out and replaced by a refined patch, whose boundary vertices are the
base's own (so the seam is shared geometry) and whose interior vertices are new,
appended after the base's. The model builds it only when the adult pack's stage
has loaded; `evaluate` returns the variant's positions only for an adult recipe
and the base surface's for any other. It arrives like the adult layer fields do
now: its own worker request, never in `ready`'s topology, and `<Humanoid>` swaps
the geometry's index and attributes at the age crossing.

**Decision: C.** It is the only option where the guarantee is structural: a
minor's evaluation has exactly the base's vertex count, so there is no adult
vertex to leak, and a test can assert that. The cost is a second surface build
and a geometry swap, both paid only when the adult pack is installed.

Rejected inside C: drawing both surfaces and masking by alpha (the adult mesh
exists in the minor's draw call), and one merged surface whose adult faces are
zero-area for minors (the vertices still exist and still bind to the skeleton).

## 5. Decision 2: the pelvic patch and its parametrisation

The patch replaces about 90 base quads (the genital region of section 1, cut
along existing base edges so the boundary loop is a closed chain of base
vertices) with a refined grid: target median edge 3 to 4 mm at the control
level, so one Catmull-Clark level reaches 2 mm, matching the atlas texel.

**Boundary.** Boundary vertices are base vertices (same index). Catmull-Clark's
boundary rule gives both the base side and the patch side the same limit curve
from the same control vertices, so the surface is watertight at every
subdivision level. The shading seam this leaves (each side lacks the other's
neighbours when it computes vertex normals) is solved by computing normals on
the merged variant, not per piece, which the variant makes natural.

**Parametrisation.** The patch is built on a (u, v) domain: u runs across the
body, symmetric about the midline (u = 0), v runs from the mons at the front to
the perineum at the back. Features are zones of that domain, not separate
meshes, so any combination is a displacement field on one lattice:

| Zone | Structure |
| --- | --- |
| Central strip, \|u\| < c | mons, the phallic or clitoral body, glans or hood, urethral meatus, perineal raphe |
| Lateral zones, c < \|u\| < L | outer labia or the two halves of the scrotum, and the volumes under them (testes) |
| Between, a ring around the strip | inner labia, foreskin or hood folds |

### Central versus lateral placement, compared

**Working interpretation, flagged for the owner:** the brief said "central vs
lateral placement" without defining it, and this section reads it as where
independent features live relative to the midline. If the owner meant something
else (for instance where the graft sits on the body), this comparison needs
redoing; the decisions that follow it do not depend on it except the zone layout.

The question is where independent features live relative to the midline.

- **All central** (one midline form that morphs through a spectrum): compact,
  and it is how MakeHuman's own genital proxies read, but it forces the spectrum
  back into one axis, which is exactly what use case 4 rejects, and it cannot
  represent paired structures without mirrored duplicates that fight each other.
- **All lateral** (paired structures only): represents the labia and scrotal
  halves well, and has no place for the midline structures, which are most of
  what use cases 2 and 3 differ on.
- **Central strip plus lateral zones** (the table above): the midline
  structures and the paired structures each get their own region and their own
  controls, and a figure with any mix is a mix of independent displacements.
  The cost is conflicts where zones meet (a fused versus open labial seam, the
  base of the shaft against the labial commissure), resolved by per-feature
  priority masks written into the pack, not by code that knows which anatomy it
  is looking at.

**Decision: central strip plus lateral zones**, because it is the only layout
that satisfies use case 4 without special cases, and it makes every
feature a target file over a known zone.

## 6. Decision 3: features, controls and the recipe

Each feature is its own set of morph targets over patch vertices, packed in the
adult pack in the existing sparse encoding with indices in the variant's vertex
space (base count plus patch index). A feature carries a presence (0..1) and
its own shape controls:

| Feature | Controls (first cut) |
| --- | --- |
| `penis` | length, girth, glans size, foreskin, curvature at rest |
| `testes` | size, descent, scrotal tightness |
| `mound` | volume (today's `pelvis/bulge`) |
| `labia-majora` | fullness, projection |
| `labia-minora` | length, projection, asymmetry |
| `clitoris` | glans size, hood coverage |

Presence 0 contributes no displacement and no paint (`appliedAnatomy` already
carries a presence per feature, so the paint input needs no change). The
recipe gains one optional record, `anatomy`, keyed by feature id, each value its
presence and control values; an absent record is exactly today's recipe, so the
frozen schema is only extended. Today's `genitals/*` and `pelvis/bulge`
modifiers keep working: they are the first controls of `penis`, `testes` and
`mound` (the phase 1 `anatomy.features` of the pack's manifest), and migrate to the new
targets when the patch lands.

The age policy extends in the same three places it exists now: `ADULT_ONLY`
covers the `anatomy` record as it covers the modifiers; `withAge` below 18
deletes it explicitly; `assertAgePolicy` rejects it, never clamps it.

## 6a. Decision 4: detail targets (settled once the refined surface existed)

Sections 4 to 7 were written before the refined surface was built, and speak of
patch vertices. What was built is a refinement of the base's own surface
(`buildRefinedSurfaceMesh`): every adult-surface vertex is a fixed linear
combination of the base's control vertices. That changes how a feature reaches
the surface, and this is the decision.

**Use cases.** (1) A large soft form, the mound or the scrotal volume, that
should follow every macro and region target of the base. (2) A fine form, a
glans edge, a labial fold, a meatus, 2 to 6 mm across, which the base's control
mesh (about 10 mm cells) cannot hold. (3) Any mix of features on one figure
(section 2, use case 4). (4) A figure under 18 never has either.

**Options.** (a) New control vertices for the sculpt, in the base topology:
rejected in section 4, the base is shared across ages. (b) Targets on the base's
control vertices only: large forms follow the body for free, but nothing finer
than a control cell can be expressed, and a fine form moves whole cells. (c)
**Two levels**: control targets as today for the large forms (they refine
through the stencil), plus *detail targets* defined on the adult surface's own
vertices for the fine forms, added after the stencil.

**Decision: (c).** Control targets keep their role and their pack file. A detail
target is a sparse list of `(region vertex, delta)` in the adult target file,
evaluated as `position += sum(weight * delta * scale)` on the refinement's
lattice, then carried through any further smoothing. The region is the lattice
vertices the refined faces use (a few thousand), ranked, because the whole
lattice (82 000 vertices) does not fit the target encoding's 16-bit index and a
detail has no business beyond the patch and its border. The refinement is built
over every body face, and worn things hide triangles by a mask, so the
numbering does not change with clothing. It exists in the adult surface only, so a minor (evaluated on
the base surface) cannot reach it, and it is structurally absent from a
session that never asks for the surface.

- **Frame.** A delta is authored in the body's axes at the default figure (x
  across, y up, z forward) and scaled at evaluation by the figure's pelvic scale
  (the ratio of the control mesh's pelvic breadth to the default's), so the same
  detail is the same shape on a tall figure and a short one. It is not rotated:
  pose is skinning's job (the surface's skin weights come from the base). A
  per-vertex tangent frame was rejected: the authored deltas are per vertex
  anyway, and a fixed frame is stable under macro changes with no extra data.
- **Normals.** The refined surface shades with the base's interpolated normals
  (so it matches the base). With detail displacement the normal of each
  displaced vertex gains the *change* in its geometric normal (area-weighted over
  its faces, displaced against undisplaced), which is zero wherever nothing
  moved, so there is no seam at the region's edge and the shading follows the
  new form.
- **Pinning.** Detail target indices depend on the refinement, so the adult
  manifest carries a hash of the surface (`surfaceSha256`: the refinement spec
  and the resulting vertex and face counts) and the loader refuses detail
  targets built against a different one, as it refuses a pack built against a
  different body.
- **Authoring.** Deltas are generated by code (`scripts/lib/detail/*`) from
  parametric forms placed in the zones of section 5 and sized from the measured
  dimensions (ADULT-ANATOMY-DATA.md), then written to the pack by the packer. No
  mesh is sculpted by hand or imported, so the geometry is ours and
  reproducible, and the pack is byte-identical on rebuild.
- **Recipe.** The `anatomy` record of section 6 (feature id to presence and
  controls) selects detail targets and their weights; the age policy covers it in
  the three places of section 6.

Rejected: a variant mesh swapped in per figure (section 4), per-vertex local
frames (above), and generating detail at load time from the recipe (it would
move the sculpt's source of truth out of the pack).

## 6b. Decision 5: reservoirs (what a shaft, a scrotum and a labial fold need)

Detail targets move the lattice's own vertices. That shapes relief (the mound,
labial folds) but not a shaft: a 10 to 20 cm extrusion of a surface whose cells
are 2.3 mm would stretch a few cells into spikes. The anatomy needs *material*
to extrude from, and it must stay one continuous surface (no attachment seam;
the skin fields, occlusion bake and clothing masks of the body apply to it).

**Use cases.** (1) A phallic body: from a clitoral glans of a few millimetres to a
penis of 20 cm erect, one structure at different sizes, so intersex
presentations are points on one continuum. (2) A pair of labioscrotal swellings:
labia majora to scrotum, fused to any degree. (3) Folds (labia minora, foreskin,
hood) that project beyond the surface. (4) Any combination on one figure, with no
feature knowing which anatomy it is next to. (5) Nothing visible, and nothing
different from the base, when a feature is absent; and nothing at all in a figure
under 18.

**Options.** (a) A separate mesh bound to the figure: an attachment seam, and its
own skin fields and occlusion; rejected. (b) More vertices in the lattice at rest
spread over the extrusion: wasteful and still spiky. (c) **Collapsed strips**: cut
the surface along a closed loop of lattice edges around a disc of faces (the
*cap*), insert rings of vertices between the loop and the cap that coincide with
the loop at rest, and re-attach the cap to the last ring. The strips between
rings have zero area at rest; detail targets pull the cap and the rings outward
and they become the wall of a tube, with the cap as its tip. (d) A bud: a separate
closed tube welded at the loop: at rest its cap cannot collapse to zero area
(it spans the loop), so it would duplicate the skin and z-fight.

**Decision: (c).** The reservoir exists only in the adult surface (a figure under
18 is evaluated on the base surface and has none). It is generated at the
subdivision level in use from the free surface: ring vertices are copies of the
loop's vertices at that level (the same stencil row, hence the same position,
skin weights and shading normal), so at rest the surface is exactly the surface
without the reservoir, at every level, and the collapsed strips have zero area
(they contribute no pixel and no normal). A detail target addresses a reservoir's
rings at the lattice level (one vertex per loop vertex and ring, numbered after
the region's), and finer levels interpolate along the ring. The strips belong to
the control face that owns the cap edge they run from, and are written with that
face's triangles, so a garment that hides the face hides them and the body
occlusion bake covers them through their copied rows. A reservoir is data of the
adult pack (`anatomy.reservoirs`: loop, cap faces, rings), authored by the
packer from a disc on the lattice, never code that knows what it will become.

Rejected: creases on the strip edges (a crease changes the limit surface at rest,
a faint ridge along the loop at level 2), and reservoirs only at level 1 (the
renderer offers level 2, and the cap's edges must match the strips' there).

## 6c. Decision 6: the phallic organ (keys, factors and states)

The organ is a tube drawn out of the phallic reservoir (`scripts/lib/detail/phallus.ts`):
its rings leave the loop on the skin, bend from the skin's normal toward the way the
organ lies, and close in a rounded glans on the cap. Authored by us from the loop and
the measured numbers (ADULT-ANATOMY-DATA.md, F); nothing third-party is read.

**Size is a blend of baked shapes, not a scale.** The root's loop is 1.3 cm in
radius whatever is drawn from it, so a small organ is not a scaled-down large one
(a clitoral glans cannot be a 0.1 homothety of a penis). The organ is baked at
four sizes (a clitoral glans, a small organ, the pooled mean, a large one), and a
size modifier between them blends its two neighbours by a hat. The pooled mean is
exact at its key: flaccid 9.16 cm along the top and 9.31 cm round (Veale 2015).

**The factor language.** The engine does not know any of this. The pack's manifest
gives each detail target a weight as a product of factors (`src/model/detailFactors.ts`):
`mod:`/`mod-:` (a modifier's positive or negative part), `signal:`, `ramp:` (a
piecewise-linear function of a modifier, the hat) and `sramp:` (the same of a
signal). `AdultDetailSpec.drives` gives a target a weight from factors alone;
`gates` multiplies a modifier's own target by factors. A modifier end named ""
is virtual: legal, no target, read by factors (the size, length and girth are such).

**Variations are targets too.** Length and girth are two-sided modifiers whose full
step is two standard deviations of the pooled values. A variation's shape depends
on the size (a longer small organ is not a longer large one), so each key has its
own length and girth targets, and the product of size and length is exact at the keys.

**Arousal is drawn at three states**, not two. A morph moves each vertex in a straight
line, so a tube swinging from hanging (about 70 degrees below forward, modelled) to
rising (30 degrees above, provisional) would shorten at its middle (arousal 0.5 shorter
than flaccid, found in the first build). Drawn at a midpoint too, it swings, and each
pair is short enough to stay a tube. The signal's hats (`sramp:arousal`) are 1 at one
state and fall to 0 at its neighbours. A key too small to be a penis (the clitoral
glans) has no erect state: no verified magnitude exists for it.

**Cost.** Each key has base, length and girth targets (five), and each state it erects
through adds five again, so the organ is 50 targets of about 1,500 vertices (0.31 MB gzipped
with the rest of the adult file). A cross term of length with girth is left out: it is
second order and the keys carry the first.

Measured, in `tests/phallus.test.ts`: the dorsal length and circumference of the
default key against the literature, erect against flaccid (+43%, +25%), the monotone
growth through the keys, and the surface against the authored shape for every variation.

## 7. How the patch stays bound to hm08

- **Position.** Every new vertex is bound to base vertices exactly as an
  attachment's are (`.mhclo`: reference vertices, weights, and an offset in the
  local frame), so every macro, modifier and region target that moves the base
  moves the patch with it, and the patch scales with the figure. Boundary
  vertices are the base vertices themselves. The binding is solved when the
  pack is built, against the default figure, and checked against the extremes
  (below).
- **Skinning.** New vertices take their skin weights from their reference
  vertices (`bindingSkin`), so pelvis and thigh poses move the patch with the
  body, and the boundary has the base's weights.
- **Features.** Feature displacement is added to the bound position, in the
  local frame, so a long shaft on a tall figure and on a short one are the same
  shape at the figure's scale.
- **UVs and the skin layers.** The patch's UVs are the replaced region's UVs
  interpolated onto the new vertices, so the patch lies in the same UV
  neighbourhood and the body's texture space has no new island. The field atlas
  rasteriser then draws the variant's patch triangles, with each adult layer's
  fields computed from the zones (mask: zone membership; coordinate: along the
  shaft, glans to base), and refreshes in place exactly as phase 1's
  `LayerAtlas.refresh` does now. This is what turns today's penis and testes
  layers, which paint nothing, into layers that do.
- **State morphs.** Engorgement moves from the `helper-genital` targets to the
  patch's own, with the same calibration (circumference +25%, length +43%), and
  the clitoral and vulvar responses are added only when their magnitudes are
  verified (research/SKIN-STATES.md lists them as unverified).

## 8. Research before sculpting

1. **Vulvar, labial and clitoral dimensions and their ranges**, from open
   sources, by the same method as research/SKIN-STATES.md (what was read versus
   what was not). Penile numbers exist (B4); these do not yet.
2. **Colour** of genital skin: A4 found none calibrated; the layers' colour stays
   modelled and labelled so until one exists. The Sommers et al. per-site tables
   named there are the first request.
3. **Variation in intersex anatomy** from clinical anatomy references, to choose
   the feature controls (section 6) so the range is representable; the controls
   above are a first cut from the zones, not from this reading.
4. **Erectile and clitoral volume change** magnitudes (B4 marks them
   unverified) before any state morph is calibrated for them.

## 9. Tests and acceptance

Each is a test written before the code it covers, mutation-checked as phase 1's
gates were.

- **Structure.** The patch is watertight against the base (boundary vertices
  are base indices and every boundary edge is shared exactly once), manifold,
  all quads, with a UV that has no overlap and a vertex count inside a stated
  budget.
- **Binding.** For macro extremes (age 18 and 90, gender and weight at both
  ends) and for pose extremes (the rig's benchmark pose), patch vertices stay
  within a tolerance of where the binding says, and no boundary edge opens.
- **Independence.** Each feature's targets move only vertices in its own zone and
  its priority-mask overlap; setting one feature leaves every other zone
  bit-identical.
- **Age.** For any recipe under 18 the evaluation has exactly the base vertex
  count; `anatomy` is rejected under 18 and stripped by `withAge`; the variant is
  never in `ready`'s topology; the adult-layer and state-morph gates of phase 1
  still hold. A property test over ages and signals, as `agePolicy.test.ts`
  does for modifiers.
- **Permutations.** The figures this library must hold are a cross, not a list
  of presets: every adult age (18 to 90), every gender position (0 to 1 in
  quarters), every combination of the shape features each absent, reduced or
  enlarged (so a female-macro figure with a penis, a male-macro one with a
  mound only, testes with no penis, and every in-between that
  hermaphroditic and intersex variation needs), the weight and muscle
  extremes, skin tones across the range, and both states, flaccid and aroused,
  for the male anatomy now and the vulvar anatomy as it lands.
  `tests/adultPermutations.test.ts` evaluates the full cross at the control
  level and a representative slice on the refined surface (all finite, the age
  gate held, exactly the anatomy the modifiers name), and checks the state
  monotonically in the shaft for every gender position and at every shaft
  size. A new feature is added to the pack's list and joins the cross with no
  test edit. The female state is pinned as absent until the vulva sculpt
  exists (its target, its magnitude from the primary text in
  `ADULT-ANATOMY-DATA.md`, section C); that test then becomes a measurement.
- **Pages.** `scripts/check-pages-build.mjs` learns the new pack files (by
  SHA-256) and the feature, target and graft names, and still fails the build
  on any of them; the mutation check is adding one to a built site.
- **Seen.** Contact sheets from `scripts/contact-sheet.mjs` with `?adult`, local
  only, at both ends of the tone range and at the extremes of every control,
  clothed and unclothed, read against the base figure for seams, tearing and
  shading breaks.
- **Cost.** Per-figure cost for a figure with no anatomy applied is unchanged
  (measured by `scripts/measure-load.mjs`); the variant build is paid only with
  the pack.

## 10. Order of work

1. **Research** (section 8, items 1 and 4), in parallel with 2.
2. **The empty patch**: cut the region, rebuild it at the refined resolution with
   no features, add the variant surface, the age-gated evaluation and the
   geometry swap. Proof: the variant looks the same as the base to the eye and
   to the structure and age tests, so the swap is shown correct before any
   anatomy depends on it.
3. **One feature at a time**, each its own target file, zone, controls, tests and
   contact sheet: `mound` first (it replaces today's only visible target), then
   `penis`, `testes`, the vulvar features. Status: the `mound` is built, as a
   generated control target (`scripts/lib/control/mound.ts`, sized from
   ADULT-ANATOMY-DATA.md section E; a broad swell is low-frequency, so control
   level suits it and detail is for what needs finer cells). The rest draw on reservoirs (section 6b),
   which are built: the engine (`src/build/reservoir.ts`), linear detail
   subdivision, and a phallic and a labioscrotal pair placed in the pack
   (`scripts/lib/adultReservoirs.ts`); the phallic organ is drawn on the phallic
   one (section 6c; the CC0 `genitals/penis-*` sliders are hidden and the engorgement
   state morph is replaced by the detail's own arousal drives); the scrotum and
   testes on the labioscrotal pair, then the labia, are next.
4. **Skin fields on the patch** and the layers' remap, so the phase 1 layers
   show.
5. **State morphs on the patch** (engorgement moves from `helper-genital`).
6. **Pages and package checks**, the pack format's additive entries, the
   examples in docs/API.md.

## 11. Risks

- **A visible seam** where the patch meets the base despite shared boundary
  vertices (normals, UV stretch, the subdivision limit at corners). Mitigation:
  merged-variant normals, boundary vertices on base edges, a seam test in the
  contact sheets, and a fallback ring one quad wider if the first cut shows one.
- **Apparent age.** An adult recipe can still be shaped to look young with other
  sliders, and the age policy checks the recipe's age macro, not appearance
  (docs/AGE-POLICY.md). The sculpt adds no new control over body proportions
  and offers no feature that depends on or implies youth; apparent age remains
  the application's responsibility, as the policy states.
- **Authoring volume.** Six features with zones and priority masks is a lot of
  sculpting; the zone parametrisation is what keeps it additive, and the order
  of work above ships `mound` alone first.
- **Frozen contract pressure.** Appended vertices and a surface variant are
  additive but touch what every lane reads. Raise them with the integrator
  before step 2, not after.
