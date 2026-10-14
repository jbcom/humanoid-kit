# Regional contact and injury contract

Status: **contact payload validation and neutral injury-state validation are
implemented.** Regional response, visual rendering, posed anchor evaluation and
garment coverage are still separate work. This note keeps those states apart so
a caller cannot mistake an affordance frame or visual scar for a physiological
simulation.

## What exists now

| Concern | Current support | Deliberate limit |
| --- | --- | --- |
| Core openings | The mouth, ear canals and nostrils are `aperture` affordances with posed frames, measured curved channels, `place()` queries and clipping. | The channel only establishes an entry path and clearance query. It does not emit a sensory or physiological response. |
| Opening motion | Oral occupancy can drive the existing jaw opening. | Ear and nasal channels do not widen from occupancy. No contact may infer a shared `dilation` response. |
| Surface contact | Finger-pad and grip capsule gaps are available through `contact()` and `gripContacts()`. | There is no general external-region registry, contact-event stream, pressure solver or tissue deformation. |
| Adult canal geometry | The adult lane has a separately authored, age-gated canal-closure model; its resting wall contact is geometry validation. | It is not a core regional-contact response, and it does not grant an application an interaction, sensory signal or animation. |
| External adult regions | No external adult region is registered in the core. | A future adult-pack surface region is distinct from its canal and from ear contact; it needs its own registration and response profile. |
| Persistent skin marks | Recipes can already contain stable, base-surface-anchored scars as body art. | They are authored appearance, not runtime injuries, and they do not alter collision, affordances or clothing. |
| Time response | `SkinStateFilter` can filter application-provided signals. | It has no regional contact mapping and must not be used to imply one. |
| Runtime injury records | `RegionalInjuryState` validates neutral record classes, compatible base-mesh vertex anchors, explicit lifecycle calls and saved-only snapshots. | It does not infer records from contact, render an effect, evaluate a pose, alter collision or alter affordances. |

`canalClosure` and `closedLoop` are specifically a rest-geometry operation in
the adult lane. They close a named canal loop against its own wall and classify
that named lumen contact for geometry checks. They do not model an external
region, a core aperture response, or a general-purpose wound.

## Implemented payload boundary

`RegionalContact` is a plain, framework-free report. It names the registered
region and supplies exactly one world or figure-space sample:

```ts
type RegionalContact = {
  region: string;
  topology: "surface" | "aperture-entry";
  location: readonly [number, number, number];
  normal: readonly [number, number, number]; // unit direction
  force: number;       // newtons, non-negative
  duration: number;    // seconds in the current contact, non-negative
  contactPhase: "begin" | "sustain" | "end";
  depth?: number;      // metres, required only for aperture-entry
};
```

`assertRegionalContact(contact, own)` checks finite geometry and time values,
a unit normal, a known region, and its topology against the figure's own
affordances. A `surface` sample cannot name an aperture. An `aperture-entry`
sample must name an aperture and include a non-negative depth. It validates
input only: it neither applies state nor alters the model.

This distinction is structural. A surface contact has no channel and never
becomes an opening. An aperture entry must use that opening's own channel and
clearance query; it does not turn arbitrary surface contact into an entry.

## Inputs, intent and responses

The next layers have separate owners and are **not implemented**:

1. A consumer may translate a validated `RegionalContact` into a
   `RegionalPhysiologyInput`. This is evidence and timing, not a presentation
   command.
2. A consumer independently chooses `RegionalAnimationIntent` for clips, jaw
   poses, gaze or other presentation. Animation intent cannot be inferred from
   contact alone.
3. A region-owned response profile may accept specific physiology inputs,
   enforce its own lower and upper bounds, and define its own transient
   recovery. There is no global response profile and no universal
   contact-to-response dispatcher.

The categories are intentionally different: mouth motion is jaw and lip
control around the oral rim; ear and nasal openings retain their own anchored,
curved clearance; adult canals retain their own adult-pack, wall and
age-policy semantics; an external region, once registered, is surface contact
unless that pack declares a distinct aperture. Numerical response calibration,
medical limits and tissue laws are not approved by this contract and belong in
separate evidence-backed work.

## Implemented neutral injury-state contract

`RegionalInjuryState`, `RegionalInjury`, `RegionalInjuryAnchor` and
`RegionalInjurySnapshot` are exported today. They are a bounded neutral data
contract, not a solver, medical calibration, or a particular visual effect.
The record routes only through a caller-owned renderer hook.

### Record classes

A record must choose exactly one class, keep its class through its lifecycle,
and carry a schema version, stable body-space anchor, consumer-owned identity,
consumer-authored creation and update time, opaque source category, opaque
non-empty severity band, explicit lifecycle transition and persistence policy.
Times are in the consumer's own coordinate; the kit supplies no global clock.
The source category groups local source semantics only, and the severity band
has no kit-defined threshold, ordering, anatomy or gameplay meaning.

| Planned class | Meaning and hard boundary | Persistence |
| --- | --- | --- |
| Surface marking | An anchored material or decal effect on intact skin. It cannot make a passage, channel, aperture, collision volume or affordance. | Session or saved only if the consumer requests it. |
| Transient deformation | A bounded, anchored presentation displacement with a region-owned recovery policy. It returns to its resolved rest surface; this contract sets no numeric curve or tissue law. | Runtime only unless an explicit later policy makes it saveable. |
| Persistent body-space change or scar | A versioned anchored change that can survive save/reload. It is a body-space record, not a replacement mesh, and cannot be silently left behind after reset. | Saved only when the consumer stores it and supplies reset policy. |

The minimal future record contract is structural rather than anatomical:

| Required field or relation | Planned rule |
| --- | --- |
| `schemaVersion` and `id` | A loader rejects an unsupported version or duplicate identity rather than guessing migration. |
| Class and lifecycle | The class is one of the three rows above. Records hold the current lifecycle and metadata; `create`, `update`, `resolve`, `restore` and `reset` return the corresponding observable event. `resolve` and a repeated reset are idempotent. Restore is a replacement action and reports success even when the snapshot matches. |
| Stable body-space anchor | The anchor identifies one compatible body topology and resolves on the current morphed, posed, skinned surface. It cannot be an arbitrary world coordinate, UV-only point, or unversioned triangle index. |
| Consumer metadata | `createdAt` and `updatedAt` are finite consumer-authored times. `sourceCategory` and `severityBand` are non-empty opaque consumer labels. None supplies a global clock, medical threshold, source taxonomy or gameplay outcome. |
| Persistence policy | Session data is not accidentally serialized. Saved data retains its schema version and anchor. Reset removes records selected by the consumer policy. |

The existing body-art system establishes the desired anchor direction: named
sites or frozen base-mesh vertices resolve on each morphed figure, and garments
already follow the same skinned body binding. Body art's scars remain authored
appearance; they are not runtime injury records. A dynamic system will need a
new topology-stable anchor representation rather than reusing a cosmetic record
without proof.

### Anchoring, clothing and collision boundaries

A future resolver must evaluate an injury anchor after morphing and skinning so
its presentation stays with the same anatomical region during animation. A
consumer cannot attach it to a world-space point and call the result stable.
Garments and wrappings must declare how their existing base-body binding covers
the anchored region. They may occlude a record according to that coverage, but
may not drift, float above a transient deformation, or silently discard a
persistent record.

Collision and affordances remain unchanged by default. A surface marking never
creates a channel. A transient or persistent body-space record is also not an
aperture merely because it follows a projectile or blade event. Any future
collision, clearance, contact or affordance override needs an explicit,
independently validated contract; it cannot be inferred from an injury class.

### Consumer ownership

Curse and Prayers may interpret their local projectile or blade damage events,
choose visible art, decide balance and tone, and decide what to save. Those
choices stay in the games. The kit's future responsibility is limited to a
neutral, deterministic state representation and resolver. It does not classify
damage, choose an effect, create combat outcomes, or model physiology.

### Validation and remaining proof

Focused source tests cover schema, duplicate identity, compatible base-mesh
vertex anchors, opaque source-category and severity-band validation, class
isolation, transient lifetime, saved-only snapshots, exact restore and explicit
layer routing. They do **not** prove rendering,
posed/skinned placement or garment coverage. Those require separate evidence:

| Test area | Required evidence |
| --- | --- |
| Record validation | Source tests reject unsupported schema, duplicate id, incompatible topology or hash, out-of-range vertex, invalid duration and class-specific forbidden fields. Mutation proof verifies the guards. |
| Anchor resolution | A future renderer must resolve the same compatible base vertex across morphs and posed/skinned animation without changing anatomical target. It must reject topology mismatch rather than retargeting. |
| Class isolation | Source tests prove state routing does not create an aperture, collision or affordance state; no contact input automatically emits a regional response or injury record. |
| Recovery and persistence | Source tests resolve a transient at its declared duration, round-trip saved records with version and anchor intact, and prove reset removes only selected records. |
| Clothing and wrapping | Exercise bound garments and any wrapping implementation across morph and pose, verifying coverage remains coherent and does not drift or hide state without its declared coverage rule. |
| Collision and affordances | Prove defaults are unchanged. A later explicit override requires its own behavior and regression suite. |
| Renderer lab | Root must inspect marked, transient and persistent candidates through relevant morphs, animation, clothing/wrapping, save/reload and reset. This proof is currently absent. |

## Remaining implementation gates

- Register external surface regions before accepting them as `RegionalContact`
  targets; do not borrow adult canal identifiers or infer them from geometry.
- Add region-specific response/recovery implementations only with their own
  pure lifecycle tests and evidence-backed calibration.
- Connect the stable base-mesh vertex anchor to a posed/skinned renderer, then
  test morphing, animation and clothing/wrapping coverage independently.
- Root reviews any eventual rendered opening, response, injury or deformation
  change. This document is not visual acceptance evidence.
