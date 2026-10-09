# Presence: what a figure tells the world

Status: being implemented (`src/presence`). It is the shared foundation for the
milestone 8 animation work (awareness and interactions) and for
environment-driven lighting and shadows.

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
   Nothing is computed for a channel nobody subscribes to.
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
- **Face metering reports; it does not expose.** Following
  `research/SKIN-RENDERING.md` §4.4, `faceMetering` gives each face's metering
  region, measured reflectance and intended zone (`skinZoneEV = log2(Y /
  0.18)`), weighted by apparent size, and names the deepest face. A scene
  exposes for grey and adds light where a face falls short; it never pulls every
  face to one luminance.
- **Presence carries placement, not a full matrix**, for now: ground position,
  facing and bounds. A transform matrix arrives with posing.
