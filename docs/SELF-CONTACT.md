# Self-contact: a figure touching its own body

Status: **specified, slice 1 in progress** (#117). Nothing here is implemented
until its slice's tests are green; each slice says what it proves.

A figure that can only pose is a mannequin. People touch themselves all the
time: they scratch, rub an eye, tug an ear, pick their nose, rest a chin on a
hand, hug their knees. Adults also touch their own nipples, genitals and anus.
These are the contacts developers queue most (several at once for an idle
state). They are also the foundation for touching anyone else. Reaching a point on
another figure's body is the same constraint with the target on another
presence, so getting self-contact right is most of partner contact
(`docs/DECISIONS.md` 11, multi-party coordination).

## Use cases

1. **Idle fidgets, all ages.** Scratch the scalp, rub an eye, tug an ear
   lobe, pick the nose, touch the chin or cheek, bite a nail, rub the hands
   together, scratch an arm, hug the knees (seated), touch the toes (folded).
2. **Layered on any base motion.** A fidget plays over standing, seated,
   walking or breathing motion. Several are queued in turn for an idle
   state, and the two arms can carry different ones at once.
3. **Any body.** The same clip lands on a child, a slim adult, a heavy adult
   and an elder, on that figure's own surface, with no per-body tuning.
4. **Held through motion.** The contact holds while the body sways and
   breathes, and while the head turns.
5. **Contact drives the figure's own state.** A touch reports where it lands,
   how hard and how long (`RegionalContact`). A region-owned response profile
   may turn that into signals: for an adult, nipple or genital contact can raise
   `arousal` and `genitalMoisture` over time, and rhythm matters.
6. **Openings respond.** A finger at the mouth parts the lips and opens the
   jaw to fit. An adult's finger or object at the vagina or anus opens that
   canal to fit. The part inside is hidden (clipped), and an edible object is
   `consumed`.
7. **The same constraint on another figure.** A hand on a partner's
   shoulder, cheek or genitals is a site contact whose site is on another
   presence (later slice; it shares every part below).

## Requirements

- **R1, sites.** A target is a named surface site resolved on the figure's
  posed, skinned surface every frame, as a position, an outward normal and a
  tangent. It is resolved by the landmark machinery (`landmarkFrameInto`),
  never by presence anchors, which are coarse and refresh every 3 frames.
  Core sites are landmarks: the existing ones (`nose-tip`, `chin`,
  `ear-lobe.X`, `nipple.X`, `navel`, `crown`, `lower-lip`, …) plus added ones
  (`brow.X`, `cheek.X`, `eye.X`, `knee.X`, `toe-tip.X`, `scalp`). Adult sites
  (clitoris, introitus, perineum, anus, glans, scrotum) are declared by the
  adult pack on its detail lattice, the way its piercing sites are, so the
  core names none.
- **R2, effectors.** The touching point is a landmark of the hand: a finger
  pad (`finger-pad-N.X`), the palm, or the knuckles, and for the feet a toe or
  the sole. The arm is solved so that the skinned effector, not the wrist,
  reaches the site (`createArmSkinnedFrameSampler` with an effector parameter).
- **R3, contact, not penetration.** The effector's skin surface meets the
  site's: its point sits on the site, offset along the site's normal by the
  pad's half thickness (`PAD_REST`, measured). The contact passes when the gap
  is within 5 mm and no part of the hand is inside the body by more than the
  foundation's penetration limit.
- **R4, the target moves with the arm.** A site's skin can be weighted to arm
  bones (the nipple's to `shoulder01`, the cheek's to none). So the site is
  re-measured in each candidate pose. The solver alternates site resolution
  and the arm solve until both settle, at most 4 rounds.
- **R5, no stretching.** As for hand contact: the evaluated segment lengths
  are kept and no joint is translated. An unreachable site is reported
  (`status: "unreached"`, with the measured gap), and the arm keeps the closest
  pose found.
- **R6, hand shapes.** A contact names a hand shape (`point`, `pinch`, `flat`,
  `cup`, `claw`, `fist`). The shape is a finger-bone pose composed into the
  source before the arm solve. The fingers belong to the shape and the arm to
  the solver.
- **R7, posture is a clip's.** Folding to the toes or sitting to hug the knees
  is posture, which a body clip supplies. The constraint only closes the arm
  onto the site from that posture. The head may turn toward a hand at the face
  (a neck pre-pass, slice 3); the spine is never bent by the solver.
- **R8, blend and release.** These behave as for hand contact: in over
  `blendIn` on the interaction's phase clock, held while the contact is active,
  and out on release. At weight 0 the pose is the source, byte for byte.
- **R9, one pose for every reader.** `<Humanoid>` composes the constrained
  rotations before the skeleton, occlusion keys, dual quaternions and presence.
  This is the seam the documented hand contact also needs and which is not
  built yet (#112).
- **R10, age policy.**
  - Every site is an affordance with an `adult` flag. Core sites are
    registered as non-adult `contact` affordances: a landmark id unknown to
    the registry counts as adult (`audienceOf`), so without the registration a
    child's nose-pick would be refused. Pack sites are adult by default.
  - Nipple contact is adult content. The core's `nipple.X` affordance is
    non-adult for body art, but no all-ages self-contact definition, child
    fixture or child sheet names it. All-ages chest contacts use
    `sternum-notch` or `chest.X`. Nipple self-contact lives in the adult
    package with an explicit `audience: "adult"` and a refusal test for a minor.
  - A self-contact definition naming an adult site is adult (`audienceOf`) and
    is refused for a figure under 18 at proposal and on every tick.
  - Signal writes go through `assertSignalPolicy`.
  - Adult definitions and clips live in the age-gated adult package (#105),
    never in the core source.
- **R11, regional responses stay region-owned.** The constraint emits a
  validated `RegionalContact` each frame it is in contact. It maps no response
  itself. A response profile (core for the mouth's opening, the adult package
  for genital, anal and nipple arousal) is selected by the consumer, as
  `docs/REGIONAL-CONTACTS.md` requires. There is no universal dispatcher.
- **R12, own-body clipping.** A figure's own finger inside its own mouth,
  nostril or canal is clipped like any other occupant. `channelClip` today
  clips only other objects.

## Options considered

1. **Extend `createHandContact`** with a site target kind. It already owns
   blending, the phase clock, claims and refusal reasons. But its pole, palm
   orientation, world-space target and the runtime's `gripMeeting` target
   are all hand-to-hand.
2. **A separate `createSiteContact`** that shares the solver, the sampler and
   the blend code with hand contact through extracted helpers, and takes its
   target from the figure's own sampled surface.
3. **Authored clips only.** Pose the arm by hand for each fidget. This breaks
   use case 3: a clip authored on one body misses the nose of every other
   body.

**Decision: option 2.** The hand-to-hand path stays as it is. A site contact
is a second constraint kind with its own target, effector, pole and
orientation rules. The shared machinery is extracted rather than branched:
blend state, the sampler with an effector parameter, and the solve loop. Two
constraints on one figure chain (`out` of one is `source` of the next), so the
two arms carry two contacts. Option 3 is still how *posture* is supplied (R7).

## Slices and their proof

| Slice | Delivers | Proof (red first) |
| --- | --- | --- |
| 1 | Core sites registered as non-adult contact affordances (plus new landmarks); effector parameter; the `point` hand shape and an approach orientation (finger axis along the reverse of the site normal); `solveSiteContact` (alternating site/arm solve), headless | `tests/selfContact.test.ts`: index pad to nose, chin, ear lobe, crown, sternum notch, navel, knee. Gap ≤ 5 mm and no hand vertex inside the body, on a child, a slim woman, a heavy man and an elder, standing and seated. The penetration check is shown to fail with the goal pushed 1 cm into the nose. Unreachable sites are reported. Weight 0 is identity. Audience: a child fidget is "all" and runs on a child; a definition naming a pack site is "adult" and is refused for the child. |
| 2 | The other hand shapes; pole per target region | Shape tests (finger bones only). Each shape's contact passes R3 at its sites. |
| 3 | `<Humanoid siteContact>` and the `handContact` seam (closes the React half of #25 too), neck pre-pass, playground self-contact lab, sheets | Browser test: the rendered pad and site agree with the CPU reference. Sheets read on four bodies per fidget. |
| 4 | `RegionalContact` emission; response profiles; the core oral profile (lips part, jaw opens to fit a finger) | Profile lifecycle tests. A minor's adult signals stay 0, and an adult definition is refused (`interactionAgeGate`). |
| 5 | Own-body clipping; adult apertures (vagina, anus) declared by the pack, opening to fit an occupant | Clip test with the figure's own finger. Canal aperture follows the occupant radius; the inside part is clipped; `consumed` is written for edible objects. |
| 6 | Idle clip set (all ages), layering, two arms, queueing | Each clip on four bodies: contact ≤ 5 mm through its loop; sheets read. |
| 7 | Adult package: adult sites' response profiles and adult clips | Age-gate refusals. Arousal and moisture rise with contact and decay after it. Sheets read. |
| 8 | Partner contact: the site on another presence | The same contact gates between two figures. |
