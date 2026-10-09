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
`mound` (the phase 1 `ANATOMY_FEATURES` modifier lists), and migrate to the new
targets when the patch lands.

The age policy extends in the same three places it exists now: `ADULT_ONLY`
covers the `anatomy` record as it covers the modifiers; `withAge` below 18
deletes it explicitly; `assertAgePolicy` rejects it, never clamps it.

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
   `penis`, `testes`, the vulvar features.
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
