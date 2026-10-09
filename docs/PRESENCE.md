# Presence: what a figure tells the world

Status: design, not implemented. It is the shared foundation for the
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

## Sketch

```ts
interface FigurePresence {
  id: string;
  /** World transform, bounds and velocity. */
  transform: Matrix4Like;
  bounds: Box3Like;
  velocity: [number, number, number];
  /** Named anchors in world space. */
  anchors: Record<"head" | "face" | "chest" | "leftHand" | "rightHand" | "leftFoot" | "rightFoot", [number, number, number]>;
  /** Ground contact: foot positions and an approximate footprint radius. */
  footprint: { points: [number, number][]; radius: number };
  /** Measured skin appearance (linear). */
  appearance: { albedo: [number, number, number]; luminance: number; specular: number };
  adult: boolean;
}

const registry = createPresenceRegistry();
registry.subscribe("proximity", { radius: 1.5 }, (e) => { /* enter / leave */ });
const field = groundOcclusion(registry.all()); // pooled contact shadows
const exposure = faceExposure(registry.all(), camera); // face-priority metering
```

In React, `<Humanoid presence>` registers the figure; `usePresence()` and
`useProximity()` read it.

## Open questions

- Footprint from the evaluated mesh (accurate, per evaluation) or from the
  skeleton once posing exists (cheap, per frame). Likely both: mesh until
  milestone 2, skeleton after.
- Velocity needs a clock; the registry should take time from the render loop
  rather than keep its own.
- Group detection (who is "together") is useful to cameras and audio alike;
  it belongs in the registry if it stays a pure function of positions.
