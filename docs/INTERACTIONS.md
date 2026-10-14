# Interactions: how figures, objects and places act together

Status: being built (2026-10-11). Slices 1 and 2 are implemented in the
framework-free core: presence has `measures` (reach, shoulder, hip and eye
height); two figures can agree a handshake, claim their hands and arms, walk to
measure-relative slots around a pinned midpoint, share a clock, and pull their
hand meeting point during `act`. The remaining visual proof for slice 2 is a
tall/short capture before it is integrated. The framework-free core is in
`src/interaction/` and `src/presence/presence.ts`: `ObjectPresence` and
channels in the registry, definitions with validation and the fail-closed
audience (`audienceOf`), offers filtered by the age policy, proposals with role
kinds, tags and the age check before anyone is asked, explicit consent for
adult definitions, all-or-nothing body-part claims, the phases on the presence
clock with beats and object-state effects, `repeatWhile` (the apple's bite
loop), cancel on a participant leaving, and the per-tick age re-check. The
bite reaches the figure: `applyToAffordances` sets each beat's change on the
participant's `HumanoidAffordances`, so the mouth holds the bite (its
occupancy opens the drawn jaw) and empties at the chew; the rim clip that
dissolves what passes the lips is the affordance work's, tested in
`tests/browser/channelClip.test.ts`. Two
choices made while building: a slot's offset is in metres for now (lengths in a
body's own measures arrive with `measures`, slice 2), and the act's repeat is
the definition's `repeatWhile` rather than a beat. The build plan at the end
orders the rest. It builds on [Presence](PRESENCE.md) (what a figure
tells the world), the affordance registry, channels and response
([Architecture](ARCHITECTURE.md), "Affordances: the registry", "Affordances:
curved channels", "Affordances: the response"), the skin states
([Architecture](ARCHITECTURE.md), "Skin states") and milestone 8's animation
library ([Architecture](ARCHITECTURE.md), "Animation (milestone 8)"). The
[age policy](AGE-POLICY.md) binds every part of it.

## Why

Presence lets a figure say where it is; affordances let its body say what it
can hold, enter or rest against. Neither says how two things *do* something
together: who offers a chair and who takes it, where each hand of a handshake
goes on two bodies of different sizes, when the apple loses its first bite, or
what a partner feels when touched. Without a contract every application
reinvents it, and the age policy would have to be re-enforced by each one.

The owner's direction (2026-10-11): align to industry and React standards so
that figures, objects and the environment can signal each other in a way
developers can use, for commensal and reactive animations, from eating an
apple to intercourse.

The figure still **describes** and never **prescribes** (PRESENCE.md, rule 3).
An interaction is something a figure or object *offers* and a participant
*accepts*; the kit runs what was agreed, measures it and reports it. Whether a
figure wants to sit, eat or be touched is the application's decision.

## Use cases

| Family | Use case | What it needs from the contract |
| --- | --- | --- |
| Figure and object | Pick up a cup | The cup's grip surface, the hand's grip, a reach phase, `holding` set on the grip |
| Figure and object | Hand an object over | Two figures and one object; the object changes holder mid-act at a shared beat |
| Figure and object | Eat an apple: bite, chew, the apple changes | The mouth aperture, the apple's bite frame, beats (bite, chew, swallow), the apple's stage advancing, `occupancy` and `consumed` driven |
| Figure and object | Drink | The same as eating with a tilt and no stage change; the cup's fill level as object state |
| Figure and object | Put on or take off clothing | A garment as an object participant; the recipe's `outfit` changes at a beat |
| Figure and environment | Sit on a chair or a bed | A slot on the fixture (where the pelvis goes, which way it faces), a reservation so two figures do not take one seat, an approach target |
| Figure and environment | Lie down | A slot with a body-length extent, several bodies per bed |
| Figure and environment | Lean on a wall | A surface slot rather than a point: anywhere along it |
| Figure and environment | Open a door | The handle's grip frame, the door's own state (its angle) driven by the act |
| Figure and figure | Look at someone | No exclusive body part except gaze; an anchor target from presence |
| Figure and figure | Wave | One actor, one optional audience; no contact |
| Figure and figure | Handshake | Two roles, a meeting point that depends on both arms, hand contact held while both clips play |
| Figure and figure | Hug, kiss | Two roles, chest or face contact, height difference absorbed |
| Figure and figure | Dance, walk together | Long, looping, shared clock and tempo; locomotion still the application's |
| Adult intimacy | Caress | Finger pads moving over a partner's skin; the partner reacts |
| Adult intimacy | Oral and penetrative intercourse | An aperture and its channel (core mouth, or the adult pack's canals) with an insertable part; depth and contact force measured along the channel; both participants' arousal and skin states responding |
| Reactions | Flinch at a touch | A stimulus (who, where on the body, how hard) and a short additive response |
| Reactions | Turn to look | A stimulus (approach, sound, touch) and a gaze or head turn toward its source |
| Reactions | A partner's reaction | Every touch inside an interaction is a stimulus to the touched participant |

## Requirements

1. **Advertised affordances.** A participant (figure, object or fixture)
   publishes what it offers, with preconditions; a would-be participant finds
   offers by meaning, not by object type.
2. **Negotiation and reservation.** An interaction is proposed, each
   participant accepts or declines, and a claimed slot or body part cannot be
   taken by anyone else until it is released.
3. **Roles, slots and alignment.** Each participant has a role, and each role a
   place to stand and face, worked out on the bodies actually present.
4. **Synchronised clips.** All roles play on one shared clock through the same
   phases (approach, align, act, release), with named beats.
5. **Continuous signals.** Contact distance and force, depth along a channel,
   occupancy and intensity are measured during the act and can feed skin states
   and reactions.
6. **Interruption.** Any participant, the application or the kit can cancel; a
   cancelled interaction releases cleanly and says why.
7. **Objects are participants.** An apple has state (its stage, how much is
   eaten) that the act advances.
8. **Determinism.** Same inputs, same seed, same outcome: no wall clock, no
   unseeded choice.
9. **Age policy in the contract.** Adult interactions refuse any participant
   whose presence says it is under 18, fail closed, and their definitions live
   in the adult package so the core names none of them.
10. **Package boundaries.** The runtime in the core, everyday interactions in
    `humanoid-kit-animations`, adult ones in `humanoid-kit-adult-animations`.
11. **React developer experience.** Components, hooks and event props that read
    like R3F's.
12. **Serialisable.** Definitions and offers are plain JSON, and an object
    asset can carry its offers in glTF.
13. **Cheap by default.** No per-frame cost for an interaction nobody runs, no
    per-frame allocation for one that runs (PRESENCE.md, rule 4).

## Prior art

| Source | What it is | Adopt | Reject, and why |
| --- | --- | --- | --- |
| [glTF `KHR_interactivity`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_interactivity/Specification.adoc) | A behaviour graph in a glTF asset: event nodes (`event/onStart`, `event/onTick`), flow nodes, `pointer/set` and `pointer/interpolate` on the asset's object model, custom events (`event/send`, `event/receive`) to talk to the host | Custom events as the bridge: the kit's interaction events are sendable to and receivable from an asset's graph; `onTick` semantics (at most one per frame, ordered) match the presence tick | The graph as our runtime. It is a general visual-scripting VM; interaction semantics (roles, claims, age policy) would be conventions over it instead of types, and an age check inside an author's graph is not auditable |
| [`KHR_node_selectability`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_node_selectability/README.md), [`KHR_node_hoverability`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_node_hoverability/README.md) | Per-node flags (`selectable`, `hoverable`) and bubbling `onSelect` / `onHoverIn` / `onHoverOut` events up the node tree | The shape: interaction data as a per-node extension, so a slot is a glTF node; bubbling from a child node to the nearest ancestor that handles it | Nothing major; they describe pointer input, not participants |
| [VRM 1.0](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/README.md) (`VRMC_vrm` humanoid, [`lookAt`](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/lookAt.md), expressions), [`VRMC_springBone`](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_springBone-1.0/README.md), [`VRMC_node_constraint`](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_node_constraint-1.0/README.md) | An avatar standard: humanoid bone map, gaze with yaw and pitch range maps, named expression presets, secondary motion, aim and rotation constraints | `lookAt`'s model for gaze (a target point, yaw and pitch, per-direction range maps to eye bones or expressions) as the look-at reaction; expressions as the face channel of a reaction; aim constraints as how a head tracks | Spring bones and avatar-level metadata as part of this contract; they are secondary motion and identity, not interaction |
| [Unity XR Interaction Toolkit](https://docs.unity3d.com/Packages/com.unity.xr.interaction.toolkit@3.0/manual/architecture.html) | Interactors and interactables, states Hover, Select, Focus, Activate, an Interaction Manager that exits invalid states before entering new ones, each side notified | The two-sided notification (both participants hear every state change); the manager's ordering (exit before enter, a fixed order per update) as our tick; `hover` as "is a valid target now", `select` as "claimed" | The input-device framing (a controller is the interactor); here the interactor is a body, often driven by AI or another body |
| [Unreal Smart Objects](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview) | Definitions with slots (a transform relative to the object), user-required and activity tags, behaviour definitions; a runtime subsystem where an agent finds, claims (a claim handle), uses and releases a slot (Free, Claimed, Occupied) | Almost all of it: definition versus instance, slots with transforms, the find, claim, use, release lifecycle with a handle, and "the claimant releases" | Unreal's split of behaviour into StateTree or Gameplay Behaviors; our act is the synchronised clip and signals below |
| [Gameplay Tags](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-tags-in-unreal-engine) | Hierarchical dotted names (`Food.Fruit.Apple`) with parent matching | Tags as the vocabulary of offers and requirements, matched by prefix | A global tag table registered ahead of time; ours are strings validated by format |
| Unreal Contextual Animation ([`FContextualAnimSet`](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ContextualAnimation/FContextualAnimSet), [`FContextualAnimStartSceneParams`](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ContextualAnimation/FContextualAnimStartSceneParams), [warp points](https://docs.unrealengine.com/PythonAPI/class/ContextualAnimWarpPointDefinition.html)) | A scene asset with one track per role (a character track and a car track), variations per set, warp points (transforms that align the actors, by socket or custom), a runtime that binds actors to roles | Roles with one track each, variants chosen by fit, warp points as our alignment reference, binding actors to roles at start | Warp points baked offline from authored positions: our bodies vary, so alignment is solved at start from the bodies present |
| The Sims' advertisements ([Northwestern lecture outline, "The Sims under the hood"](https://users.cs.northwestern.edu/~forbus/c95-gd/lectures/The_Sims_Under_the_Hood_files/outline.htm); [GamesRadar, "The making of The Sims"](https://www.gamesradar.com/the-making-of-the-sims)) | Objects broadcast what they offer against needs (hunger, energy, social, fun); a Sim weighs each advertisement by its own motives and goes to the best; new objects need no change to the Sims | Objects advertise; the knowledge lives in the object, so a new prop teaches every figure | Motives and scoring in the kit: what a figure wants is the application's; offers carry an optional score the application may use |
| [R3F events](https://r3f.docs.pmnd.rs/api/events) and React patterns | `onPointerOver`, `onClick` and friends as props on any object; an event object carrying `object` (what was hit) and `eventObject` (who handles it); bubbling to ancestors and to farther objects, `stopPropagation`; context providers; hooks that read in `useFrame` | Event props on `<Humanoid>` and `<Interactable>` named `onInteraction…`; an event object with the interaction, the participant and the handler's own role; providers and hooks; continuous values read in `useFrame`, never through React state | Bubbling past the participants: an interaction event is delivered to its participants only, not to their scene ancestors |

## Options considered

**A. A behaviour graph per interaction** (`KHR_interactivity` as the runtime).
An interaction is a graph of event, flow and pointer nodes. It is general and
already serialisable. But roles, claims, phases and the age policy would be
patterns authors follow rather than types the kit checks; the age check would
live inside data authored by anyone; and TypeScript developers would author
graphs instead of calling an API.

**B. Signals only** (an event bus and React context). Participants emit events
(`touched`, `bitten`) and applications wire the rest. It is small and
React-shaped, but every application rebuilds reservation, alignment and
synchronised timing, and the age policy would be enforced wherever someone
remembered to.

**C. A declarative participant contract** (Smart Objects, Contextual Animation
and The Sims' advertisements, with R3F-style bindings). An interaction is a
data definition: roles, slots, phases, tracks, contacts and signals. A runtime
on the presence registry keeps offers, claims and running interactions,
ticked with presence. React components and hooks sit on top.

| Criterion | A: graph | B: signals | C: contract |
| --- | --- | --- | --- |
| Covers apple to intercourse with one model | Yes, by authoring | Only by application code | Yes |
| Reservation and synchronisation built in | Authored per graph | No | Yes |
| Age policy enforced by the kit, auditable | No | No | Yes, at fixed points |
| Core names no adult interaction | Yes | Yes | Yes (definitions are package data) |
| React and TypeScript experience | Poor | Good | Good |
| Deterministic | Yes | Up to the application | Yes |
| Serialisable, glTF-friendly | Native | Partly | Definitions are JSON; offers are a glTF extension |
| Cheap by default | Graph VM per asset | Yes | Yes |

**Decision: C**, borrowing A's custom events as an interop bridge and B's
event names and hooks for the React surface.

## The design

### Vocabulary

- A **participant** is anything with a presence: a figure (`FigurePresence`)
  or an object or fixture (`ObjectPresence`, new: an id, a transform, bounds,
  named frames and tags).
- A **tag** is a dotted, lower-case name (`food.fruit.apple`, `seat.chair`,
  `greeting.handshake`). A requirement for `food` matches `food.fruit.apple`.
- An **interaction definition** is data: what roles take part, what each
  needs, where each stands, what each plays in each phase, which affordances
  meet, which signals it measures, and its audience (`all` or `adult`).
- An **offer** (advertisement) is a participant saying "I can take this role in
  this definition", with slots and preconditions.
- A **claim** reserves a slot of an offer, or a part of a figure's body, for one
  interaction.
- An **interaction** is one running instance: definition, bindings of roles to
  participants, a phase, a clock, a seed.
- A **stimulus** is something that happened to a participant (touched,
  approached, looked at), whether or not an interaction is running; a
  **reaction** is a one-role interaction a stimulus starts.

### Where it lives

The interaction runtime is a channel of the presence registry, not a second
registry (PRESENCE.md, rule 1): `createInteractions(presence)` reads
participants from the registry, and the registry's `tick` advances it, after
proximity and before readers. Objects join presence as `ObjectPresence`, so a
chair, an apple and a figure are looked up, paired by proximity and grouped the
same way.

### Lifecycle

```text
offered ─ propose ─▶ proposed ─ all accept ─▶ approach ─▶ align ─▶ act ─▶ release ─▶ ended
                        │ any declines                 └──── cancel / interrupt ───┘
                        ▼                                         │
                     declined                                 cancelled (with a reason)
```

- **propose**: the initiator binds participants to roles. The kit checks the
  definition's requirements and the age policy *before* anyone is asked.
- **accept**: every participant's policy is asked (two-sided, as in XRI).
  Objects accept when their slot is free and their preconditions hold.
  Figures accept through the application's policy (below).
- **claim**: on acceptance the slots and body parts are claimed atomically: all
  or none.
- **approach**: each figure gets a target placement (where to stand, which way
  to face). Moving there is the application's (its locomotion, its pathing);
  the phase ends when every figure is within tolerance, or when the
  application says so.
- **align**: the kit blends each figure's root onto its slot over the
  alignment window, the way motion warping does, so feet do not slide.
- **act**: every role's track plays on the interaction's clock; contacts are
  held; beats fire; signals are measured.
- **release**: tracks blend out, objects detach or change holder, claims are
  freed. A cancel during act jumps to release (graceful) or, for a policy
  refusal, aborts with no blend.

### Body parts are claimed, not whole figures

A figure can walk, hold a partner's hand, talk and look around at once. Each
role says which **body parts** it uses: `locomotion`, `pelvis`, `torso`,
`arm.L`, `arm.R`, `hand.L`, `hand.R`, `head`, `gaze`, `mouth`. Two
interactions run on one figure when their parts do not overlap (walk together
uses `locomotion`; holding hands uses `hand.R`). A proposal that needs a part
already claimed either waits, preempts by priority (a definition's
`priority`), or is declined, as the definition says. Reactions use only
`gaze`, `head` or an additive layer, so they never block an act.

### Negotiation and consent

A figure accepts through the application's policy, `accept(proposal)`, which
may answer at once or later (a dialogue choice). Defaults:

- an `audience: "all"` interaction is accepted unless the figure's policy
  declines it;
- an `audience: "adult"` interaction is **never** accepted by default: each
  figure participant's policy must accept it explicitly. Consent is modelled,
  not assumed.

### Alignment on bodies of any size

A definition's slots are placements relative to a **reference frame** (a warp
point): a fixture's named frame (the chair's `seat`), a role's anchor (the
apple held at the eater's `rightHand`), or the midpoint of two roles (a
handshake). Distances may be written in units of a participant's own
measurements, so one definition fits a 1.5 m and a 1.9 m figure. Presence
gains a `measures` block for this (arm reach, shoulder height, hip height,
eye height), derived with the anchors.

After alignment, **contacts** are solved, not trusted to the clip: a contact
pairs two affordances (the initiator's `hand.R` grip with the responder's
`hand.R` grip; the mouth with the apple's `bite` frame) and the kit holds them
together during the phases it names with a two-bone solve per limb, in the
same way `FootLock` holds a planted foot. A clip says what the body does;
contacts say where it must meet.

### Clips, phases, beats and the shared clock

Each role has a **track**: per phase, a clip from an animation library by id
(any `humanoid-kit-animations` clip, or a package's own), its loop, its rate.
The clips are rotation deltas, so they play on any body. One interaction
clock, advanced by the presence tick, gives every track its time; nothing
reads the wall clock. **Beats** are named times in the act (`bite`, `chew`,
`swallow`; `grip`, `shake`, `let-go`) that fire events and apply **effects**:
data that sets an affordance's state or advances an object's stage. Variants
of a definition (a short and a long hug, a left- and right-handed handshake)
are chosen by fit to the bodies, then by the interaction's seed.

### Signals

During the act the interaction measures, on demand (pull), what its
definition names:

- per contact: the distance between the two surfaces (`contact()`), negative
  when pressing; a force estimate from that depth and the tissue's stiffness;
- per channel coupling: the insertable's depth along the channel (`place()`),
  its radius at the rim (which sets `occupancy` and so the opening), and its
  speed along the channel;
- the act's own **intensity** (0 to 1), set by the application or by the
  track, and its tempo.

A definition may **route** signals to skin states: a route maps an interaction
signal to a skin signal of one participant through a gain and the existing
first-order filter (`SkinStateFilter`). The kit evaluates a route only when the
interaction is acting and only for signals it names. Routes into `arousal` are
written only in the adult package and pass through `assertSignalPolicy` on
every write.

### Handshake runtime API

Slice 2 exposes the alignment and animation values as pull APIs. They are
ordinary framework-free methods so a renderer, an animation controller or game
logic can read them in its own frame loop without a React state update. Pass an
output object or vector on the hot path to avoid an allocation.

```ts
const interaction = interactions.propose("greeting.handshake", {
  initiator: "figure-a",
  responder: "figure-b",
});

// During approach, steer each figure to its own measured slot.
const placement = {
  position: [0, 0, 0] as [number, number, number],
  facing: [0, 0, 1] as [number, number, number],
};
interaction.slot("initiator", placement);

// During the contact's declared phases, constrain both right hands here.
const grip = [0, 0, 0] as [number, number, number];
interaction.contactTarget("grip", "initiator", grip);

// Sample a role's clip on the interaction's shared clock.
const secondsIntoClip = interaction.trackTime("initiator");

// Discrete lifecycle and cancellation notices go to each participant.
interactions.on("figure-a", (event) => {
  if (event.type === "cancelled") reportInteractionStop(event.reason);
});
```

`slot` returns `null` when a role has no slot or its reference is unavailable.
`contactTarget` returns `null` outside the contact's declared phases, for an
unknown contact or role, or when either figure has left. `trackTime` returns
`null` when that role has no track in the current phase. `on` delivers
`accepted`, `declined`, phase, beat, normal end and cancellation events to both
participants, with every cancellation carrying its reason. `endReason` is
`null` while the interaction runs and after a normal end, and the cancellation
reason after a cancel, so a reader that polls (the hand contact constraint
below) can tell a graceful cancel from an `age-policy` abort without
subscribing. The runtime stays framework-free: a consumer that needs per-pad
contact gaps wraps the returned target in its contact capsule and supplies it
to each posed hand's `HumanoidAffordances.gripContacts` call.

### Consumer patterns: figures and the environment

The runtime describes a coordinated act. A consumer owns locomotion, animation
application, object presentation and gameplay outcomes; it can react at the
same lifecycle boundary for a figure, an object or a fixture.

```ts
import type { Interaction } from "humanoid-kit";

const placement = {
  position: [0, 0, 0] as [number, number, number],
  facing: [0, 0, 1] as [number, number, number],
};
const handTarget = [0, 0, 0] as [number, number, number];
const padGaps: number[] = [];

const stopFixtureEvents = interactions.on("bench-7", (event) => {
  if (event.type === "phase" && event.phase === "act") bench.showOccupied(true);
  if (event.type === "cancelled" || event.type === "ended") bench.showOccupied(false);
});

const stopFigureEvents = interactions.on("figure-a", (event) => {
  if (event.type === "phase") animation.enter(event.phase);
  if (event.type === "beat") effects.play(event.beat);
  if (event.type === "cancelled") animation.stopInteraction(event.reason);
});

function updateHandshake(interaction: Interaction) {
  const slot = interaction.slot("initiator", placement);
  if (slot && interaction.phase === "approach") navigation.moveTo(slot.position, slot.facing);

  const grip = interaction.contactTarget("grip", "initiator", handTarget);
  if (grip) {
    const held = { from: grip, to: grip, radius: 0.02 };
    hands.gripContacts("hand.R", held, "world", padGaps);
  }

  const clipSeconds = interaction.trackTime("initiator");
  if (clipSeconds !== null) animation.sample("handshake.shake", clipSeconds);
}

// The figure itself closes its hand on the target (see "Hand contact constraint"):
// <Humanoid presence={{ id: "figure-a" }} animation={...}
//   handContact={{ interaction, role: "initiator", contact: "grip" }} />

// Remove listeners when their world objects are removed.
stopFixtureEvents();
stopFigureEvents();
```

`bench`, `animation`, `effects`, `navigation` and `hands` are consumer
objects in this example. Their inventory, combat, dialogue, sound and pathing
rules deliberately remain outside the package. A fixture gets its own listener
only when it is bound to an object role; it does not consent on behalf of a
figure. This lets a door animate its handle at a beat, a chair show reservation
state, and a figure cancel without the core choosing any game outcome.

### Slice 2 visual review recipe

This is the remaining acceptance evidence for the handshake implementation; it
is deliberately separate from the pure unit geometry checks.

1. Publish an adult all-audience pair at `(-3, 0, 0)` and `(3, 0, 0)`. Give
   the initiator `{ reach: 0.8, shoulderHeight: 1.55, hipHeight: 1.0,
   eyeHeight: 1.7 }` and the responder `{ reach: 0.6, shoulderHeight: 1.25,
   hipHeight: 0.8, eyeHeight: 1.38 }`.
2. Use the `handshake` definition from `tests/interactionHandshake.test.ts`:
   both roles claim `arm.R` and `hand.R` (or `arm.L` and `hand.L` for the
   left-handed variant), have a slot offset of `-0.7 ×` their own reach
   against the `between` reference, and use the `grip` contact during `act`
   only. Keep both figures clothed for the capture.
3. Each `<Humanoid>` is bound to the interaction with `handContact={{
   interaction, role, contact: "grip" }}`, so the figure itself closes its
   hand on the runtime's target (see "Hand contact constraint"). The lab
   supplies no arm pose, marker offset or target of its own.
4. The review fixture is `e2e/sheets/handshake.sheet.ts`. A reviewer runs it
   explicitly with `heavy-slot --remote-render pnpm exec playwright test
   e2e/sheets/handshake.sheet.ts --project sheets -g <row>`; it is not part of
   ordinary browser testing. It fails before saving a cell unless the route is
   muted, both adult recipes draw their clothes, the animation package
   supplies its source clip, the target and both hand frames come from the
   live presence registry and interaction runtime, and, in a grip row, both
   rendered hand frames lie within 1 cm of the target with both constraints
   reporting `reached`.
5. It records rest (approach), grip, release and cancel from front and side
   views, for several height pairs (`?pair=`), both handedness variants
   (`?hand=L|R`) and a moving contact (`?moving`, both figures carried
   sideways together during `act`). An inspection hold pauses the presence
   clock the lab feeds the registry, so the runtime itself is held rather than
   a copy of its values. The yellow point is the shared `contactTarget`; the
   two RGB axes are the live, posed hand frames. Capture the resulting sheet
   and record its location and reviewer conclusion before integration.
6. Accept only if both hands reach the same target within 1 cm, neither arm
   overextends, the elbows bend down and out, the palms face each other, the
   difference in body height reads naturally from every view, and release and
   cancellation return both arms to the clip.

The core does not yet ship an authored handshake clip (a shake belongs to
`humanoid-kit-animations`) or automatic stimulus/reaction rules. The fixture
samples the packaged `idle1` clip on the shared clock as the underlying
animation, and the hand contact constraint closes each hand over it.

#### Review-fixture evidence and binding gate

The first headed, silent hardware attempt on 2026-10-11 (`job5195`) failed
before visual review: `RangeError: the figure has no affordance hand.R` came
from the marker's render-loop frame query. Its raw error context and attachment
remain in the local test output for that failed job; no capture was accepted.
The lab now treats a frame as pending until that figure's `onSettled` callback,
then requires `HumanoidAffordances.has("hand.R")` before it reads the live
frame. A missing hand after settle is exposed once through `bindingFailure` and
stops the sheet before any cell is written; it is not accepted as a null frame.

A root-reviewed silent headed rerun (`job5217`) accepted that mounting repair:
there was no missing-hand error and the sheet was produced. It rejected the
physical handshake and framing. Both live hand frames remained down at the
figures' sides, far from the yellow runtime target; for the short figure the
target was near the face while the hand was substantially lower. The approach
front and three-quarter cells also crop the participants. This is evidence that
the fixture reads live state correctly, not evidence that the figures make
contact. The reviewed capture stays with that job's local review output; it is
not committed.

#### Next milestone: target-to-hand closure and uncropped review

Do not call the models physically interacting until this milestone has a fresh,
root-reviewed sheet.

1. An interaction-driven hand pose constraint (the "Hand contact constraint"
   below; an authored shake clip remains the animation package's). It consumes
   `contactTarget` and the interaction's phase clock to alter the rendered arm
   and hand bones; moving a group, marker or presence anchor is not a
   substitute.
2. Sample the final posed `hand.R` frames and the shared target on the same
   render tick. Expose each hand's target-to-frame distance in the lab state and
   make the sheet fail before capture if either exceeds **0.01 m** during grip.
   Keep the existing `bindingFailure` gate separate so a missing binding cannot
   pass as a distance of zero.
3. Frame every approach, grip, release and cancel cell so both complete
   clothed adult figures, their hands and the target stay inside the camera
   bounds in front, three-quarter and side views. Add a deterministic framing
   assertion before capturing the sheet.
4. Root reruns the silent headed sheet and accepts it only after inspecting the
   closeness, natural tall/short arm reach, release and cancellation. Record
   the result beside this evidence; until then the clip/IK/contact milestone is
   incomplete.

### Experimental arm-target primitive

`solveArmTarget` is a framework-free, local-rotation primitive for a consumer
that has already selected a target. It preserves the rest skeleton and segment
lengths; it never translates joints or claims that its current spherical
source-angle budgets are anatomical joint limits. An unreached result reports
its measured distance and reason instead of stretching an arm.

The caller supplies the complete named shoulder-to-wrist chain, a source pose,
and either a wrist-local `armTip` or an `effector` that samples the final hand
frame. A rendered contact must use the latter: a wrist head or interaction
marker is not a proof that the final skinned hand reached a target. The hand
contact constraint below is what wires it to the interaction runtime and to
`<Humanoid>`. For an orientation target, either the tip or the measured
effector frame must report an orientation. A measured orientation takes
precedence; a position-only sampler falls back to the rigid tip orientation.
Ancestor position refinement and the final wrist correction are alternated
before the measured result is reported. The rigid-tip annulus stays diagnostic
for a skinned sampler: measured position and orientation tolerances determine
whether that sampler reached its target.

`createArmSkinnedFrameSampler` is the allocation-bounded `effector` adapter for
one solve. It owns transient skeleton and skinning scratch, borrows one
immutable evaluated generation, and rejects stale generations, malformed shapes
and trial changes outside the declared arm chain. Its lower-level `Into` helpers
remain trusted rig math: callers provide finite unit rotations and independent,
non-overlapping output buffers. This seam deliberately makes an integration
choose when it has a final live hand frame to close, rather than quietly moving
a marker.

### Hand contact constraint

`createHandContact(options?)` (framework-free, `src/interaction/handContact.ts`)
turns a running interaction's hand-to-hand contact into an arm pose on one
figure. `<Humanoid presence handContact={{ interaction, role, contact }}>` owns
one and applies it every frame; a framework-free renderer calls
`update(input)` itself.

**Use cases.** Two figures of any heights shake right hands or left hands;
they hold the grip while both are carried along (a moving contact); the
interaction releases, is cancelled gracefully, or is aborted by the age
policy; a target is placed out of one figure's reach.

**Requirements.**

1. The constraint solves on this figure's own evaluated skeleton and closes on
   its final skinned hand frame (`createArmSkinnedFrameSampler`), never on a
   wrist head or a guessed point.
2. Limb segments keep their evaluated lengths and no joint is translated. A
   target the arm cannot reach is reported (`status: "unreached"`, with the
   solver's reason and the measured gap), and the arm stays at the closest
   pose found rather than stretching.
3. The elbow bends down and out, toward a pole below and behind the shoulder
   on the arm's own side, and the palm turns to face the partner: palm normal
   toward the figure's midline, fingers forward.
4. Only a figure bound to the role, whose role claims both `arm.X` and
   `hand.X` for the contact's hand, is moved. Anything else is refused with a
   reason (`not-a-participant`, `not-claimed`, `not-a-hand-contact`,
   `unknown-contact`) and the underlying pose is left untouched.
5. Blending: in over `blendIn` seconds of the interaction's phase clock from
   the start of the contact's first active phase, held while the contact is
   active (a repeating act stays held), out across the release phase on the
   same clock (`time / releaseSeconds`). A graceful cancel jumps the runtime
   straight to `ended`, so the constraint fades from the last target over
   `blendOut` seconds of the caller's clock. An `age-policy` abort
   (`endReason`) drops it in the same frame, with no blend.
6. At weight 0 the output is the source pose byte for byte: the figure is
   back on its animation.
7. One pose for every reader: `<Humanoid>` writes the constrained rotations
   before the skeleton, the occlusion keys, the skin's dual quaternions (which
   the body, garments, shadows, CPU picking and `HumanoidAffordances` frames
   read) and the presence pose, so none of them disagree.

**Decisions.**

- *The side comes from the contact, not a prop.* The role's endpoint
  (`initiator:hand.L`) names the hand, so a left-handed variant is a
  definition, not a consumer switch.
- *The phase clock, not the render clock, drives blend in and release.* A
  held presence clock holds the arm too, and two figures in one interaction
  blend identically. Only the post-cancel fade, which has no interaction
  clock left, uses the caller's step.
- *The target is converted into the figure's lifted space* (the group the
  meshes are drawn in, the space the sampler measures), so a ground lift or a
  moving parent does not offset the hand.
- *A new sampler per solve.* The sampler's source pose guard needs the frame's
  composed pose, so one is made per frame; it allocates its scratch once per
  solve, a cost bounded by the number of bound figures and paid only while a
  contact is weighted. An interaction nobody binds costs nothing.
- *Position decides contact; orientation is reported.* `status` is the
  solver's measured result, including the palm orientation within
  `orientationTolerance`; the report also carries the position gap alone, so
  a grip that closed its position but not its palm is visible as such.

`update` returns a `HandContactReport`: `state` (`idle`, `refused`,
`blending-in`, `holding`, `releasing`, `fading`), `side`, `weight`,
`status`, `reason`, `distance` (measured hand frame to target, metres),
`orientationError`, `geometricallyReachable`, `target` and `hand` (world).
The report object is reused between calls; copy what you keep.

### Stimuli and reactions

Any participant can be **stimulated**, inside an interaction or not:

- `touch`: a contact affordance or a body region touched, by whom, how hard
  (from `contact()` distances the kit already evaluates for running
  interactions, or reported by the application for anything else);
- `approach`: from the proximity events presence already raises;
- `look`: a figure's gaze target landing on another's face;
- `custom`: anything the application reports.

This is an interaction-level proposal, not a universal body-response rule. The
current core has no dispatcher from contact to stimulus, animation or skin
state. A caller must select a region-specific policy after validating its
contact evidence; see [Regional contact and injury contract](REGIONAL-CONTACTS.md).
In particular, a surface touch is never promoted to an aperture entry, and a
contact does not imply a common motion, dilation, sensory or physiological
response.

A **reaction rule** maps a stimulus to a one-role interaction: flinch (an
additive clip on `torso` and `arm`), turn to look (gaze and head toward the
source, VRM `lookAt` style: yaw and pitch, clamped by range maps), or the
application's own. Inside an intimate interaction, every touch is a stimulus
to the touched partner, so reactions and skin states respond to what the other
does, not only to the shared clip.

### Interruption and cancel

An interaction is cancelled when:

- a participant or the application calls `cancel(reason)`;
- a participant leaves presence (hidden, removed, not evaluated);
- a claimed part is preempted by a higher-priority interaction;
- a participant drifts beyond the definition's tether during act;
- a precondition stops holding (the cup is empty, the door is locked);
- **the age policy fails** at any check point (below): an abort, not a release.

Every cancel carries a reason and is delivered to every participant.

### Determinism

Every choice (variant, tie-break between simultaneous claims, beat jitter) is
drawn from a seeded generator: the runtime's seed, mixed with the definition
id, the participants' ids and the tick on which the interaction started.
Simultaneous proposals in one tick are resolved at the tick in a fixed order
(priority, then participant id). The clock is the presence tick. A saved
interaction (definition id, bindings, phase, clock, seed, object states)
restores to the same frame.

### Age policy enforcement points

The contract enforces [the age policy](AGE-POLICY.md) at fixed points, each
with its own test. Each throws `AgePolicyError` rather than skipping, as the
policy requires, and none clamps.

1. **Audience is required, and unknown means adult.** A definition without a
   valid `audience` is treated as `adult` (fail closed), as an affordance that
   does not say it is not adult is refused under 18.
2. **Audience is derived as well as declared.** A definition whose contacts,
   couplings, beat effects or role affordances name any figure affordance that
   is adult is adult, whatever it declares. An affordance is adult unless it is
   one of the core's that says it is not, so an id the core does not know (a
   pack's) is adult. The host's `affordanceAdult` predicate can only add
   adult ids: its answer is joined with that default, never replacing it, so a
   predicate that answers `false` by default cannot open an adult act to a
   minor. A contact or coupling point that is not `role:name`, or names no role,
   is adult.
3. **Offers are not shown.** A query by or for a figure whose presence is not
   `adult` never returns an adult offer.
4. **Proposals refuse.** `propose` of an adult definition with any figure
   participant whose presence `adult` is not `true` throws before any
   participant is asked or any claim is made.
5. **Every tick re-checks.** A participant whose recipe changes age during an
   interaction changes its presence; an adult interaction then aborts on that
   tick, with no blend-out.
6. **Structurally, the parts are not there.** A figure under 18 has no adult
   affordances (`affordances(recipe)`), so a coupling naming one cannot even
   resolve.
7. **Signals.** Routes to `arousal` pass through `assertSignalPolicy`.
8. **Packages.** Adult definitions, their clips and their routes are data of
   `humanoid-kit-adult-animations`; the core's source names none (the same
   source scan as `tests/adultStack.test.ts`), and `pnpm check:pages` refuses a
   build that contains the package.
9. **Objects cannot stand in for figures.** A role says whether it takes a
   figure or an object, so an adult role cannot be filled by an object to dodge
   the check, and an object role never carries an age.

The policy's limit stands: the kit sees a recipe's age, not apparent age, and
posing, framing and purpose remain the application's responsibility.

### Package boundaries

| Package | Holds |
| --- | --- |
| `humanoid-kit` (core, framework-free `src/interaction/`) | Types, tag matching, definition validation, offers, claims, the runtime on the presence registry, alignment and contact solving, signals, stimuli, the generic age checks above. No clips, no definitions of its own except test fixtures |
| `humanoid-kit/react` | Existing-runtime context, `<Interactable>` object/offer registration, and observation hooks; declarative proposals and `<Humanoid>` event props remain future slices |
| `humanoid-kit-animations` | Everyday definitions as data with their clips: pick up, hand over, eat, drink, sit, lie down, lean, open a door, wave, handshake, hug, walk together, dance; reaction rules (flinch, turn to look) |
| `humanoid-kit-adult-animations` | Adult definitions, clips and signal routes; depends on `humanoid-kit-adult-anatomy` for the adult affordances; refuses any participant under 18 at load of each definition and at every point above |

### Type sketches

These are interfaces, not an implementation; names may still move while the
first slices are built.

```ts
/** A dotted, lower-case tag: "food.fruit.apple". A requirement matches by prefix. */
type Tag = string;

/** A length in metres, or in a participant's own measurements. */
type Length = number | { of: RoleName; measure: keyof FigureMeasures; times: number };

interface FigureMeasures {
  reach: number;          // shoulder to grip, metres
  shoulderHeight: number;
  hipHeight: number;
  eyeHeight: number;
}

/** A thing in the world that is not a figure: a prop or a fixture. */
interface ObjectPresence {
  id: string;
  kind: "object";
  position: Vec3;
  rotation: [number, number, number, number]; // quaternion
  bounds: { min: Vec3; max: Vec3 };
  /** Named frames in world space: "seat", "bite", "handle". */
  frames: Record<string, Frame>;
  tags: readonly Tag[];
  /** Object state the application owns and the interaction may advance. */
  state: Readonly<Record<string, number | string | boolean>>;
}

type RoleName = string;
type BodyPart =
  | "locomotion" | "pelvis" | "torso" | "head" | "gaze" | "mouth"
  | "arm.L" | "arm.R" | "hand.L" | "hand.R";
type Phase = "approach" | "align" | "act" | "release";

interface RoleSpec {
  name: RoleName;
  takes: "figure" | "object";
  /** Tags the participant must carry (objects) or the offer must carry. */
  requires?: readonly Tag[];
  /** Affordance ids the participant must have (figures): "mouth", "hand.R". */
  affordances?: readonly string[];
  /** Body parts the role claims (figures). */
  uses?: readonly BodyPart[];
  /** Where this role stands, relative to the definition's reference. */
  slot?: { offset: [Length, Length, Length]; yaw: number; tolerance: number };
  /** Per phase, what this role plays. */
  track?: Partial<Record<Phase, { clip: string; loop?: boolean; rate?: number }>>;
}

/** Where the slots are measured from (a warp point). */
type Reference =
  | { frameOf: RoleName; frame: string }        // the chair's "seat"
  | { anchorOf: RoleName; anchor: AnchorName }  // the eater's right hand
  | { between: [RoleName, RoleName] };          // midpoint, facing each other

/** Two affordances held together while the named phases run. */
interface Contact {
  a: `${RoleName}:${string}`;   // "initiator:hand.R"
  b: `${RoleName}:${string}`;   // "responder:hand.R", "food:bite"
  during: readonly Phase[];
}

/** An insertable part travelling along an aperture's channel. */
interface Coupling {
  aperture: `${RoleName}:${string}`;
  insertable: `${RoleName}:${string}`;
}

interface Beat {
  name: string;
  /** Seconds into the act, or a fraction of the act's clip. */
  at: number | { fraction: number };
  effects?: readonly Effect[];
}

type Effect =
  | { set: `${RoleName}:${string}`; change: AffordanceChange }   // the mouth's occupancy
  | { object: RoleName; state: Record<string, number | string | boolean | { add: number }> }
  | { transfer: RoleName; from: `${RoleName}:${string}`; to: `${RoleName}:${string}` };

interface SignalRoute {
  /** "contact:0.depth", "coupling:0.depth", "intensity". */
  from: string;
  to: { role: RoleName; signal: string };   // a skin signal: "exertion"
  gain: number;
}

interface InteractionDefinition {
  id: string;
  tags: readonly Tag[];
  /** Required; anything else is treated as "adult". */
  audience: "all" | "adult";
  roles: readonly RoleSpec[];
  reference: Reference;
  contacts?: readonly Contact[];
  couplings?: readonly Coupling[];
  beats?: readonly Beat[];
  routes?: readonly SignalRoute[];
  /** Metres a participant may drift from its slot during act before a cancel. */
  tether?: number;
  priority?: number;
  /** Alternatives chosen by fit, then by seed. */
  variants?: readonly Omit<InteractionDefinition, "id" | "audience" | "variants">[];
}

interface Offer {
  id: string;
  by: string;                 // the participant offering
  definition: string;         // definition id
  role: RoleName;             // the role the offerer takes
  tags: readonly Tag[];
  /** Free slots (a sofa offers three seats). */
  slots: number;
  /** An optional appeal the application may weigh (The Sims' advertisement). */
  score?: number;
}

type CancelReason =
  | "declined" | "cancelled" | "left" | "preempted"
  | "tether" | "precondition" | "age-policy";

interface Interaction {
  readonly id: string;
  readonly definition: InteractionDefinition;
  readonly roles: Readonly<Record<RoleName, string>>;   // role to participant id
  readonly phase: Phase | "proposed" | "ended";
  /** Seconds since act began, on the presence clock. */
  readonly time: number;
  readonly seed: number;
  /** Pull a signal; allocation-free. */
  signal(name: string): number;
  setIntensity(value: number): void;
  cancel(reason?: CancelReason): void;
}

interface InteractionEvent {
  type: "proposed" | "accepted" | "declined" | "phase" | "beat" | "ended" | "cancelled";
  interaction: Interaction;
  /** The participant receiving the event, and its role. */
  participant: string;
  role: RoleName;
  phase?: Phase;
  beat?: string;
  reason?: CancelReason;
}

interface Stimulus {
  type: "touch" | "approach" | "look" | "custom";
  target: string;
  source: string;
  /** Where on the target: an affordance or a region. */
  at?: string;
  intensity: number;
}

interface InteractionRuntime {
  define(definitions: readonly InteractionDefinition[]): void;
  offer(offer: Offer): () => void;
  /** Offers a participant could take, filtered by tags and by the age policy. */
  offersFor(participant: string, tags?: readonly Tag[]): readonly Offer[];
  /** Throws AgePolicyError for an adult definition with a participant under 18. */
  propose(definition: string, roles: Record<RoleName, string>): Interaction;
  policy(participant: string, accept: (i: Interaction) => boolean | Promise<boolean>): () => void;
  stimulate(stimulus: Stimulus): void;
  on(participant: string, listener: (e: InteractionEvent) => void): () => void;
  onStimulus(participant: string, listener: (s: Stimulus) => void): () => void;
}
```

### React

The first React slice wraps an **existing** framework-free runtime. The caller
creates `createInteractions(registry, options)` from the same registry it gives
to `PresenceProvider`; `InteractionsProvider` does not make a second scheduler
or clock.

```tsx
function Events() {
  useInteractionEvents("ada", (event) => report(event));
  return null;
}

<PresenceProvider registry={registry}>
  <InteractionsProvider runtime={interactions}>
    <Interactable object={apple} offers={[eatOffer]}>
      <Apple />
    </Interactable>
    <Events />
  </InteractionsProvider>
</PresenceProvider>
```

`<Interactable>` registers its `ObjectPresence` plus offers whose `by` is that
object's id. Its id must be unique in the registry: an existing object is
rejected rather than replaced and reported through `onRegistrationError`. It
removes both when it changes or unmounts. `useInteractions()`
returns the runtime; `useInteraction(id)` is a live `{ current }` accessor for
frame callbacks and event handlers, not React state; and
`useInteractionEvents(participant, listener)` receives discrete lifecycle
events and cleans up on unmount. These bindings do not move figures, animate
clips or provide physical contact.

### glTF

Definitions are JSON. An object asset carries its offers and slots as a
node-level extension, `HK_interaction` (in the shape of
`KHR_node_selectability`): a node's `extensions.HK_interaction` lists the
offers it makes and names which child nodes are its frames (`seat`, `bite`).
Loading the asset with the kit's loader registers an `ObjectPresence` and its
offers. Interaction events can be bridged to `KHR_interactivity` custom events
(`hk/interaction/beat` and so on), so an asset's own graph can play a sound or
swap a mesh on a beat. Prefixed `HK_` because it is the kit's vendor
extension, not a Khronos one.

### Cost

- Offers and claims change only on events (push); `offersFor` is a query
  (pull) over the proximity pairs presence already keeps.
- An interaction costs nothing per frame until it is proposed, and while
  running it advances one clock, plays its tracks through the existing
  `Animator`, holds its contacts (one two-bone solve per contact limb) and
  evaluates only the signals that a route or a reader names.
- Nothing is allocated per frame once an interaction is acting: events reuse
  their objects (copy what you keep, as with presence), signals are numbers.

## Worked examples

### Eating an apple

- **Definition** `eat` (`humanoid-kit-animations`), audience `all`, tags
  `consume.eat`. Roles: `eater` (figure; affordances `mouth`, `hand.R`; uses
  `hand.R`, `arm.R`, `head`, `mouth`) and `food` (object; requires `food`).
- **Offer**: the apple's `<Interactable>` offers `eat` in role `food`, one slot.
  Its frames: `grip` (where fingers hold it), `bite` (the next bite's centre,
  which moves as stages advance).
- **Reference**: `{ anchorOf: "eater", anchor: "rightHand" }`; no approach (the
  apple is already held, from a `pick-up` that ended with the hand's
  `holding` set to the apple).
- **Contacts**: `eater:hand.R` with `food:grip` during act.
- **Track**: `eater` plays a raise-to-mouth clip, holds while chewing, lowers.
- **Beats and effects**:
  1. `bite`: the mouth's `occupancy` is set from the apple's bite radius and
     the mouth opens to fit it (`openingFor`); the clip dissolves what passes
     the lips.
  2. `chew`: `occupancy` cleared, `consumed` set to 1 for that bite; the apple's
     `stage` adds 1 (the application swaps the mesh, or a staged model helper
     does).
  3. `swallow`: the act loops back to `bite` while `stage` is below the core,
     a precondition checked each loop.
- **Signals**: none routed; `exertion` is not raised by eating.
- **Cancel**: the apple leaving the hand (`holding` changed) cancels with
  `precondition`.

### Sitting on a chair

- **Definition** `sit`, audience `all`. Roles: `sitter` (figure; uses
  `locomotion`, `pelvis`, `torso`) and `seat` (object; requires `seat`).
- **Offer**: the chair offers `sit` in role `seat`, one slot (a sofa, three).
- **Reference**: `{ frameOf: "seat", frame: "seat" }`; the sitter's slot is
  `[0, 0, { of: "sitter", measure: "hipHeight", times: 0.2 }]` in front of
  the seat's edge, facing away from the back.
- **Claim**: two figures proposing the chair in one tick are ordered by
  priority, then id; the second is declined with `preempted` and can query
  `offersFor` again.
- **Phases**: approach (the application walks the figure to the target and
  turns it), align (root blended onto the slot), act (`sitting_idle_loop`,
  looping), release (stand-up clip, claim freed).
- **Contacts**: the sitter's pelvis contact with the seat frame during act,
  so the figure sits on the seat height of this chair, not the clip's.

### A handshake

- **Definition** `handshake`, audience `all`, tags `greeting.handshake`. Roles
  `initiator` and `responder`, both figures, each uses `arm.R`, `hand.R`,
  `gaze`.
- **Proposal**: the initiator proposes with the responder bound; the
  responder's policy accepts.
- **Reference**: `{ between: ["initiator", "responder"] }`. Each slot stands
  back from the midpoint by `{ of: <its role>, measure: "reach", times: 0.7 }`,
  facing the other, so a tall and a short figure each stand at their own
  comfortable distance.
- **Contacts**: `initiator:hand.R` with `responder:hand.R` during act; the
  meeting point is the midpoint of the two grips' targets, solved per arm.
  The grips' `closure` rises at `grip` and falls at `let-go`; each hand's
  `gripContacts` report its pads on the other's hand.
- **Track**: both play the same shake clip on one clock (their phases agree to
  the frame), gaze on each other's face anchor.
- **Stimuli**: the grip's pressure is a `touch` stimulus to each.

### Adult intercourse

This example is described technically: roles, anchors, channels, phases and
signals. It lives entirely in `humanoid-kit-adult-animations`; the core names
none of it.

- **Definition**: audience `adult`, declared and also derived (its coupling
  names adult-pack affordances). Two figure roles, `receptive` and
  `insertive`, both requiring the adult affordances their coupling names, both
  using `pelvis`, `torso` and `locomotion`. A variant per position.
- **Consent**: proposed by one participant; each figure's policy must accept
  explicitly (no default acceptance for adult interactions).
- **Age checks**: at definition load, at query (minors see no such offer), at
  proposal (throws before any policy is asked), on every tick, structurally
  (a minor has no adult affordances), and on every `arousal` write.
- **Reference**: the receptive figure's pelvis frame; each variant places the
  insertive slot from both figures' hip heights.
- **Coupling**: the receptive role's aperture (an adult-pack canal, or the
  core mouth for an oral variant, which the coupling with an adult insertable
  makes adult) with the insertive role's insertable part (an adult-pack
  affordance of a new core kind, `insertable`: a base frame, an axis, a length
  and a radius profile, which a prop can declare too).
- **Phases**: approach and align as any two-figure interaction; act loops a
  pair of synchronised clips whose tempo follows `intensity`; release blends
  apart.
- **Signals**: the insertable's depth along the channel (`place()`), its
  radius at the rim (setting the aperture's `occupancy`, so the opening fits
  it), its speed along the channel, and contact distances at the pelvis.
- **Routes**: depth and speed, through gains, into both participants'
  `arousal` and `exertion`, filtered by `SkinStateFilter`; skin flush and the
  adult pack's state morphs respond through the existing skin-state channels.
- **Reactions**: each touch is a stimulus to the other participant; gaze and
  breathing reactions follow it.
- **Cancel**: either participant's `cancel`, a policy withdrawal, the tether,
  or an age-policy failure (abort, no blend).

## Decision record

**Decisions (2026-10-11).**

- *A declarative participant contract* (option C): definitions as data, offers
  and claims as in Smart Objects, role tracks and warp points as in Contextual
  Animation, objects advertising as in The Sims, R3F-style bindings. A
  behaviour graph and a bare event bus were rejected (see "Options
  considered").
- *A channel of the presence registry*, ticked with it, not a second registry.
  Objects join presence as `ObjectPresence`.
- *Body parts are claimed*, not whole figures, so interactions layer.
- *Alignment is solved from the bodies present*, in units of each body's own
  measurements, and contacts are held by a solve, not trusted to a clip.
- *Audience is required, fail closed, and derived from the affordances named*;
  the age policy is checked at nine fixed points, each tested.
- *Adult interactions need explicit acceptance* from every figure
  participant's policy.
- *`insertable` becomes a core affordance kind*, generic (a straw, a pen, a
  finger), so the adult pack declares its own without the core naming them.
- *Determinism*: seeded per interaction, ordered at the tick, no wall clock.
- *glTF*: a vendor node extension, `HK_interaction`, for offers and frames, and
  a custom-event bridge to `KHR_interactivity`, not the graph as runtime.

**Why a section here, not an ADR directory.** The repository records designs
and their decisions beside what they describe ("Decisions" in
[Presence](PRESENCE.md), the dated design sections of
[Architecture](ARCHITECTURE.md)) and has no ADR series. A lone
`docs/adr/0001` would start a second convention for one decision; this section
follows the existing one.

## Owner rulings (2026-10-11)

1. **Adult-only everyday interactions.** A romantic kiss and a caress are
   `adult` and ship in the adult package; a cheek kiss, a hug and a dance are
   `all`.
2. **Adult and minor together in `all` definitions** (a parent carrying a
   child, holding hands) are allowed: the policy restricts sexual content, and
   no `all` definition may carry any.

## Build plan

Thin slices, each with its tests, in this order. Each slice updates this
document's status and [API](API.md) as it lands.

1. **The apple.** Tags, the definition type and its validation (audience fail
   closed), `ObjectPresence` in the registry, offers, a single-figure
   interaction's lifecycle on the presence tick, beats and effects on the
   mouth's `occupancy` and `consumed` and on an object's `stage`, the contact
   holding the apple in the hand. Unit tests for validation, lifecycle and
   determinism (same seed, same frames); a browser test that the bite
   dissolves past the lips at `bite` and the stage advances at `chew`.
2. **The handshake.** Two-figure proposals and acceptance, claims on body
   parts, `measures` in presence, midpoint alignment, the shared clock, the
   hand-to-hand contact solve and `gripContacts` during act, cancel when a
   participant leaves. A Playwright spec with a tall and a short figure: the
   grips meet within tolerance and the two tracks agree to the frame.
   The framework-free implementation, unit contract and silent contact-sheet
   fixture are reviewable. `job5217` proved the fixture mounting path but
   rejected physical contact and approach framing; it is not an acceptance.
   Before integration, the target-to-hand closure and framing milestone above
   must pass a new root-reviewed tall/short capture. Authored handshake
   animation and hand pose/IK remain unfinished.
3. **React bindings** (issue 100). The existing-runtime provider,
   `<Interactable>` object/offer registration, `useInteractions`,
   `useInteraction` and `useInteractionEvents` now ship with lifecycle and
   no-re-render browser coverage. Declarative proposals and event props on
   `<Humanoid>` remain later work.
4. **Reactions** (issue 101). Stimuli (touch from contact distances, approach from
   proximity), reaction rules, gaze with VRM-style range maps; flinch and turn
   to look in `humanoid-kit-animations`.
5. **The chair** (issue 102). Fixture slots, approach targets, the align warp, contention
   for one chair by two figures (a deterministic loser), a sofa's three slots.
6. **Signal routes** (issue 103). Routes into skin signals through `SkinStateFilter`
   (exertion from a dance), the per-frame cost measured and held allocation-free.
7. **The adult package** (blocked on an owner ruling, issue 105). `insertable` in the core, the adult pack's
   affordances (the canals' channels and insertables, which the affordance
   work lists as next), `humanoid-kit-adult-animations` with its definitions,
   and one test per age-policy enforcement point showing a figure under 18
   fails closed; `check:pages` extended to the package.
8. **glTF** (issue 104). `HK_interaction` import and export, and the `KHR_interactivity`
   custom-event bridge.
