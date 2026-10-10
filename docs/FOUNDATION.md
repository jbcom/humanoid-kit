# The nude-form foundation

Everything that sits on the body (hair, body hair, fur, garments, drapery,
body art, piercings, attachments, animation retargeting) is built against one
contract: the **foundation**, the set of nude-form permutations the body is
proven correct on, with stable landmarks layers attach to. No layer above the
skin is designed, tuned or judged before the foundation passes, and every such
layer is tested by iterating the foundation rather than by picking figures of
its own.

## Why

Layers tuned on a default figure in a rest pose fail on the bodies and poses
nobody looked at: a waistband that sits right on an average standing body cuts
into a heavy seated one, a navel stud drifts on a heavy belly, a garment
ignores where the nipples and genitals actually are, hair clips through an
elder's ears. Every such edge case is a foundation defect found late. The
foundation finds them once, at the layer that owns them.

## What a permutation is

A permutation is a body, a skin tone, a pose and an anatomy setting:

- **bodies**: the battery's eighteen bodies (`scripts/sheets/battery.json`):
  slim, average, heavy and muscular women and men, an androgynous average,
  tall, short, elders of both sexes, a teen, a child and the ancestry anchors.
- **tones**: the battery's six tones (melanin 0.05 to 0.9).
- **poses**: one fixed pose set covering the body's working range, not just
  the T-pose:
  - rest (A-pose) and relaxed standing;
  - arms overhead and arms crossed over the chest;
  - reaching across the body, a twisted spine, a side bend;
  - seated on a chair, seated cross-legged, kneeling, a deep squat, the tuck
    (hips flexed 120°);
  - lying supine and prone;
  - walk and run contact and passing frames (from the animation pack);
  - a fist and an open spread hand.
- **anatomy**: for adults, with the adult pack at its default and at its size
  extremes; never for anyone under 18.

The full product is large, so the foundation names **tiers**: a smoke tier
(the cross set's shape extremes × tones 1/3/6 × rest, seated, overhead, squat),
used by every unit and browser test; and the full tier, used for evidence
before a layer is approved.

## What the foundation proves (its invariants)

Each is a measured test over the permutations, not a look at a sheet:

1. **No interpenetration**: skin does not pass through skin beyond 2 mm,
   except named contact pairs (thigh on calf in a squat, arm on chest when
   crossed), which must stay continuous.
2. **No collapse**: no triangle inverts or loses more than 70% of its rest
   area; volume near each joint stays within a band of rest.
3. **Smooth surface**: no dihedral angle between adjacent faces above a bound
   outside named creases; creases stay soft (no slit, no ridge).
4. **Skin continuity**: no colour, relief or normal step across UV seams,
   region masks or layer boundaries, at every tone.
5. **Fair rendering**: contrast of every skin detail reads at every tone
   (deepest at least 60% of the lightest), and no specular or shadow artefact
   differs by tone.
6. **Anatomy correct** (adults): forms, sizes and placement within measured
   ranges at every adult body, rendered with real volume.

## What the foundation gives layers (the contract)

- `foundationPermutations(tier)`: the typed list of permutations, the one
  place bodies, tones, poses and anatomy are enumerated. Tests and sheets
  iterate it; no layer keeps its own list.
- **Landmarks and frames**, evaluated on the posed, morphed surface for any
  permutation: nipples, navel, pubic point and genital root (adults), sternum
  notch, shoulder points, elbow and knee centres, hip points, ankles, the
  hairline and scalp frame, ears, the face's anchors. Each landmark is a
  position, a surface normal and a tangent frame that follows the skin. Garments
  anchor to these, so a waistband follows the hips and a garment's chest
  follows the nipples and genital root of the body wearing it.
- **Surface queries** on the posed body: closest point, signed distance and the
  local body frame, so draping and collision use the body as it actually is.
- **The sheet set**: `hk-sheets` expands `{"$foundation": "<tier>"}` into the
  permutations, so evidence for any layer is one line.

## Affordances: a body that can interact, not a solid statue

A body whose mouth, nostrils, ears, hands and genitals are only surface
decoration is a solid statue: a developer who wants a figure to eat an apple,
hold a sword, wear an earring or couple with another figure would have to hack
the mesh or ship a clip for every case. The kit instead exposes the body's
**affordances**: every place another object or another figure can enter, grip,
hang from or rest against. Each one carries its own geometry, signals its state
and deforms to what it holds. Interactions are then composed by manipulating
the model space at runtime, not anticipated as animations.

### Kinds

- **Apertures and channels**: the mouth (lips, oral cavity, throat entrance),
  nostrils, ear canals; in the adult pack only, the vagina and anus (and the
  urethral meatus as a landmark). An aperture is a rim on the skin plus a
  channel behind it: a path with a measured radius profile and depth, scaled
  by the figure's macros, ending in a real interior surface. It is geometry
  that exists and renders, not a painted mark.
- **Grips**: each hand (palm, finger pads, thumb opposition), the mouth's bite
  (teeth and lips), the feet's plantar surfaces, the arms' crook and the
  knees' hollow for clasping.
- **Mounts**: where things hang or are worn and must follow the skin: ear
  lobes and helix, nose, brow, lips, navel, neck, wrists, fingers, waist,
  shoulders, back; the genital mounts in the adult pack.
- **Contact surfaces**: where the body rests on or against something (seat,
  back, palms, soles, knees, another body), which drive soft deformation.

### What each affordance gives a developer

- **A frame** that follows the posed, morphed skin (from the landmarks).
- **State** the developer can set and the kit reports, as plain values:
  - aperture: opening 0..1 (driving the rim and the channel's entrance), and
    occupancy: what is inserted, to what depth, with what cross-section;
  - grip: closure 0..1, the held object, contact points and pressure;
  - mount: what is attached, and its load (a hanging earring swings, a heavy
    one pulls the lobe).
- **Response**: the body deforms to the state:
  - a channel widens to an inserted object's cross-section along its depth (a
    parametric deformer along the channel's path, with the rim and the tissue
    round it following), within measured tissue limits;
  - a grip closes the fingers onto the object's surface by inverse kinematics
    against its closest points, with finger pads flattening at contact;
  - contact surfaces compress soft tissue against what they rest on.
- **Occlusion and consumption**: whatever passes inside an aperture is clipped
  at its rim and hidden inside the channel (a clip volume per aperture), so a
  developer makes a figure eat by moving an apple into the mouth and
  advancing a `consumed` fraction that dissolves the held part, with no new
  animation.

### Interacting with other objects and other figures

- A **solid model** joins an interaction by registering as an insertable,
  grippable or mountable object: a cross-section profile and grip surfaces,
  derived automatically from its mesh or declared by the developer.
- **Two figures** interact through matched affordances (an aperture with an
  insertable part, a grip with a limb, contact surface with contact surface),
  through the same API, each figure signalling and responding to its own
  state.
- **Age policy**: genital and anal affordances exist only in the adult pack;
  any pairing that involves them refuses a participant under 18, and the core
  pack names none of them.

### In the foundation

Affordances are part of the foundation, not a later layer: an anatomy that
passes as a closed surface and is reopened later is rebuilt twice. The
foundation's adult figures render with the adult pack, so a female or male
body is anatomically one; apertures are built with their channels when the
anatomy is built; and the invariants extend to them (a channel never
self-intersects or punches through the body wall at any opening or pose; a
grip never lets fingers pass into the held object).

## Order of work

1. The harness: `foundationPermutations`, the pose set, landmarks, surface
   queries, the `$foundation` sheet expansion and the invariant test suite,
   and the affordance registry with its state and frames.
2. The foundation passes: deformation and correctives, adult anatomy with its
   channels, the mouth and hands as working apertures and grips, skin and its
   details, across the full tier.
3. Only then layers above the skin, each tested by iterating the foundation.
