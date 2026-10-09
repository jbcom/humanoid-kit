# Presence: what a figure tells the world

Status: being implemented (`src/presence`). The registry, the helpers,
`presenceFromEvaluation` (presence derived from a figure's evaluation), the
React bindings (`PresenceProvider`, `<Humanoid presence>`, `usePresence`,
`useProximity`) and the first consumer, the studio stage's pooled ground
contact shadow, are done and tested (unit, browser and a Playwright spec with
two walking figures). Presence follows the pose, from the posed skeleton. Face metering has no consumer yet. It is the shared
foundation for the milestone 8 animation work
(awareness and interactions) and for environment-driven lighting and shadows.

## Why

A figure knows things about itself that the scene around it needs: where it
stands, how big it is, where its face and hands are, how reflective its skin
is, and who is near it. Today an application would have to dig these out of
geometry. Presence publishes them as plain, typed state that anything can
subscribe to.

The figure **describes**; it never **prescribes**. A figure never asks for
more light or a different camera. The scene, which alone knows its goals and
every figure in it, decides. That keeps lighting, shadows, cameras, audio and
game logic in the application's hands, informed by the figures rather than
dictated by them.

## Use cases

| Consumer | Needs | Example |
| --- | --- | --- |
| Lighting | Face position and size, skin reflectance (albedo luminance, specular level) | Face-priority exposure that keeps deep skin readable; a key light aimed at the speaker |
| Shadows and ambient occlusion | Ground footprint (feet, contact area), height | Contact shadows of figures walking together pool into one field and separate as they part, instead of double-darkening where they overlap |
| Other figures (awareness) | Transform, velocity, anchors (head, hands, feet), proximity | Look at whoever approaches; match a walking partner's pace; reach for a hand |
| Interactions (animations) | Anchors plus a participant contract | Handing an object over; running together; intimate animations (adults only, enforced by the adult animations package) |
| Cameras | Bounds, face anchors, groups | Frame a conversation; keep a group in shot |
| Game logic and audio | Proximity enter/leave events, groups | Trigger dialogue on approach; mix footsteps of a crowd |

## Rules

1. **One registry, many channels.** Awareness, lighting and shadows are all
   subscribers to the same presence registry, not separate systems.
2. **Measured, not categorical.** Appearance is published as measured
   reflectance (linear albedo, luminance, specular level). Never ethnicity:
   MakeHuman's ethnic macros only change shape and stay separate from skin
   colour.
3. **Descriptive, never prescriptive.** No "please brighten me". Consumers
   combine every figure's state and decide.
4. **Cheap by default.** Continuous state is read on demand (pull);
   discrete changes (enter/leave proximity, joins a group) are events (push).
   Nothing is computed for a channel nobody subscribes to. The per-frame path
   allocates nothing once figures have joined: a figure's presence is derived
   once per evaluation and re-placed in place each frame, the registry keeps
   those objects, proximity pairs are keyed by number, and the shadow's
   contacts are a reused array. Published objects therefore change under you:
   copy what you keep.
5. **Combining is the consumer's job, with helpers.** The library ships
   helpers for the common combinations, for example a ground occlusion field
   that merges footprints with `max` (so overlapping figures darken the floor
   once) and a face-weighted exposure meter.
6. **Age policy travels with presence.** A figure's published age bracket
   (adult or not) lets interaction contracts refuse what the policy forbids,
   exactly as the adult animations package will.

## API

```ts
interface FigurePresence {
  id: string;
  /** Placement: ground position, facing, bounds (world space, metres). */
  position: Vec3;
  facing: Vec3;
  bounds: { min: Vec3; max: Vec3 };
  /** Named anchors in world space. */
  anchors: Record<"head" | "face" | "chest" | "leftHand" | "rightHand" | "leftFoot" | "rightFoot", Vec3>;
  /** Ground contact: foot positions and an approximate footprint radius. */
  footprint: { points: [number, number][]; radius: number };
  /** Measured skin appearance (linear). */
  appearance: { albedo: Vec3; luminance: number; specular: number };
  faceRadius: number;
  adult: boolean;
}

const registry = createPresenceRegistry();
registry.set(presence);                  // publish; velocity is measured on tick
const stop = registry.onProximity(1.5, (e) => { /* e.type: enter | leave, e.ids */ });
registry.tick(clock.elapsedTime);        // from the render loop
const groups = presenceGroups(registry.all(), 1.2);
const contacts = groundOcclusion(registry.all()); // pooled contact shadows
sampleGroundOcclusion(contacts, x, z);   // 0 open … 1 shadowed, max-combined
const meter = faceMetering(registry.all(), { position: cameraPosition });
```

In React, `<Humanoid presence>` registers the figure; `usePresence()` and
`useProximity()` read it.

## Decisions (2026-10-09)

- **Footprint and anchors come from the evaluated mesh** (joint centroids of
  the morphed control mesh, moved by the figure's placement) until milestone 2
  gives a posed skeleton; then from the skeleton, per frame.
- **The registry keeps no clock.** `registry.tick(seconds)` is called from the
  render loop; velocity is the position change since the previous tick, and
  proximity events are evaluated there.
- **Proximity has hysteresis.** A pair enters at the subscribed radius and
  leaves at 1.1 times it, so two figures standing at the edge do not flicker.
- **Groups are a pure function** (`presenceGroups(presences, distance)`, single
  linkage on ground positions), not registry state.
- **Ground occlusion pools with `max`.** `groundOcclusion` turns every
  footprint into contact points; the ground is darkened by the strongest point
  that reaches it, never the sum, so figures walking together share one shadow
  that separates as they part.
- **The stage pools the shadow in a ground shader, not a texture.**
  `StudioStage` draws every figure's contact shadow as one quad whose fragment
  shader evaluates the same smoothstep and `max` as `sampleGroundOcclusion`
  over a uniform array (128 contacts), refreshed right after the registry
  ticks. The alternative was a `DataTexture` filled each frame by sampling
  `sampleGroundOcclusion` on a grid. The shader is resolution independent (no
  texel blur or grid to size to the ground), uploads one uniform array per
  frame (128 × vec4 = 2 KiB; three uploads the whole array) instead of a
  texture, and the browser test can compare its pixels with the
  framework-free function exactly; a texture needs a grid fine enough for a
  foot-sized contact over a studio-sized ground, re-sampled on the CPU every
  frame. Contacts beyond the 128 slots are ignored (two feet per figure, so 64
  figures), documented and reported by `setContacts`. Without a provider the
  stage keeps drei's `ContactShadows`.
- **The stage shadows its own floor, for the figures that publish.** The quad
  sits at the stage's height and is resized each frame to the contacts, so it
  needs no fixed extent. A contact carries the height of its figure
  (`ContactPoint.y`), and `groundOcclusion`'s `floorY` fades a figure's contacts
  out as it rises (or sinks) off that floor and drops them beyond 0.3 m, so a
  figure on a platform leaves the floor below clean. Under a provider a figure
  without `presence` casts no stage shadow: the alternative, drei's
  `ContactShadows`, shadows every object and would darken the published figures
  twice.
- **A figure with nothing to publish leaves the registry.** Hidden (the group or
  an ancestor is not `visible`), tipped so far over that it has no heading on
  the ground, or not yet evaluated: the publisher returns null and the provider
  removes the figure, rather than leaving its last placement stale. A hidden
  figure is not in the world, so it does not shadow, pair or meter. It rejoins
  when shown again.
- **A pack without the joints is tolerated.** The worker reports
  `presenceJoints: null` rather than failing `ready`; such a pack renders, and
  `<Humanoid presence>` reports the cause through `onError` and publishes
  nothing (a thrown render error would take the canvas down).
- **Face metering reports; it does not expose.** Following
  `research/SKIN-RENDERING.md` §4.4, `faceMetering` gives each face's metering
  region, measured reflectance and intended zone (`skinZoneEV = log2(Y /
  0.18)`), weighted by apparent size, and names the deepest face. A scene
  exposes for grey and adds light where a face falls short; it never pulls every
  face to one luminance.
- **Anchors are joint centroids; the footprint is the soles.** Head is the
  middle of the head bone, face the middle of the eyes and mouth, chest the top
  of the spine bone, hands the middle of wrist and middle-finger knuckle, feet
  the middle of ankle and toe. The footprint is not the foot joints but the
  extent of the rendered body within 3 cm of the lowest point on each side: its
  centre, with half the longer side as the radius, so it is a real foot length
  and follows a morphed foot.
- **Placement is a pure transform of one rest presence.** The evaluation is in
  the figure's own frame; `placePresence` rotates about the ground position by
  the heading and translates. A walking figure re-places its rest presence each
  frame (cheap), and is re-derived only when its recipe is re-evaluated.
- **The scene graph is the source of truth for placement.** `<Humanoid
  presence>` reads the group's world transform every frame instead of taking
  position and facing as per-frame props, because a walking figure is moved by
  `useFrame`, a parent or physics, and re-rendering React per frame to tell the
  registry would be wrong. `position` and `facing` in the prop are shorthand
  that place the group once.
- **With `presence`, the group's origin is the ground.** The figure lifts its
  own meshes by `groundOffset` (an inner group), so the declared and published
  position is where the soles meet the floor and callers never lift the group.
- **Hooks pull.** `usePresence` returns a live accessor to read in a frame
  callback or handler, not a value that re-renders on change; only discrete
  events (`useProximity`) are subscriptions.
- **The worker reports the joints.** The main thread has no packs, so
  `ReadyInfo.presenceJoints` carries the small static vertex lists presence
  reads, and presence is derived on the main thread from each evaluation.
- **Presence follows the pose** (`presenceFromPose`). A posed figure's anchors
  are the same joint centroids over the control mesh skinned by the pose, lifted
  by the posed ground offset; the footprint is whatever of that body is within
  3 cm of the floor (a lunge touches with one foot: one contact, not two soles);
  bounds are the posed body's box. It is derived when the evaluation or the pose
  changes, and re-placed (not re-derived) as the figure moves, so a held pose
  costs nothing per frame and an animated one about 0.7 ms a frame.
- **The posed bounds come from the control mesh, widened by the rest inset.**
  The rendered surface (subdivided, with the attachments) is not skinned per
  pose: that would skin about four times the vertices to move a box by a
  centimetre. Skinning the control mesh is already paid for, because grounding
  needs the lowest point of exactly that mesh, and the two share one pass
  (`posedControl` caches it on the evaluation and the pose). The box of the posed
  control vertices is widened per side by how far the rest surface sits inside
  the rest control mesh's box, measured once per evaluation, so a pose that
  rotates nothing reports exactly the rest figure's bounds (a test holds it) and
  a pose moves them as the body moves. The cost is that a pose that bends the
  subdivided skin out past its control mesh by more than the rest inset is not
  seen, which is millimetres, not the limb-scale error of the old rest bounds.
- **Presence carries placement, not a full matrix**, for now: ground position,
  facing and bounds. A transform matrix arrives with posing.
