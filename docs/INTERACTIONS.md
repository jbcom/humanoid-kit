# Interactions: how figures, objects and places act together

Status: being built (2026-10-11). Slice 1's framework-free core is in
`src/interaction/` and `src/presence/presence.ts`: `ObjectPresence` and
channels in the registry, definitions with validation and the fail-closed
audience (`audienceOf`), offers filtered by the age policy, proposals with role
kinds, tags and the age check before anyone is asked, explicit consent for
adult definitions, all-or-nothing body-part claims, the phases on the presence
clock with beats and object-state effects, `repeatWhile` (the apple's bite
loop), cancel on a participant leaving, and the per-tick age re-check. Still to
come in slice 1: the rendered bite (the mouth's `occupancy` reaching the
figure's `AffordanceStates` through `applyChange`) and its browser test. Two
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

### Stimuli and reactions

Any participant can be **stimulated**, inside an interaction or not:

- `touch`: a contact affordance or a body region touched, by whom, how hard
  (from `contact()` distances the kit already evaluates for running
  interactions, or reported by the application for anything else);
- `approach`: from the proximity events presence already raises;
- `look`: a figure's gaze target landing on another's face;
- `custom`: anything the application reports.

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
2. **Audience is derived as well as declared.** A definition whose contacts or
   couplings name any affordance marked `adult` (the adult pack's) is adult,
   whatever it declares.
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
| `humanoid-kit/react` | `<Interactable>`, `<Interaction>`, event props on `<Humanoid>`, hooks |
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

```tsx
<PresenceProvider interactions={{ definitions: [...everyday], seed: 42 }}>
  <Humanoid
    recipe={ada}
    presence
    affordances={adaHands}
    onInteractionStart={(e) => {}}
    onInteractionBeat={(e) => {}}
    onInteractionEnd={(e) => {}}
    onStimulus={(s) => {}}
    acceptInteraction={(i) => i.definition.audience === "all"}
  />
  <Interactable id="apple-1" tags={["food.fruit.apple"]} offers={["eat"]}
    frames={{ bite: biteRef }} state={{ stage: 0 }}>
    <Apple />
  </Interactable>
  {/* Declarative: proposed on mount, cancelled on unmount. */}
  {eating && <Interaction definition="eat" roles={{ eater: "ada", food: "apple-1" }}
    onEnd={() => setEating(false)} />}
</PresenceProvider>
```

- `useInteractions()` returns the runtime (`propose`, `offersFor`, `stimulate`).
- `useInteraction(id)` is a live accessor to read in `useFrame`
  (`signal("contact:0.depth")`), as `usePresence` is; it does not re-render.
- `useInteractionEvents(participant, listener)` and `useStimulus(participant,
  listener)` subscribe to discrete events.
- Event props are named and shaped like R3F's pointer props; the event names
  the participant receiving it and its role, as R3F's `eventObject` names who
  handles a pointer event. Events reach participants only; they do not bubble
  to scene ancestors.

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
3. **React bindings.** `<Interactable>`, `<Interaction>`, the event props,
   `useInteractions`, `useInteraction`, `useInteractionEvents`; tests that
   reading signals does not re-render.
4. **Reactions.** Stimuli (touch from contact distances, approach from
   proximity), reaction rules, gaze with VRM-style range maps; flinch and turn
   to look in `humanoid-kit-animations`.
5. **The chair.** Fixture slots, approach targets, the align warp, contention
   for one chair by two figures (a deterministic loser), a sofa's three slots.
6. **Signal routes.** Routes into skin signals through `SkinStateFilter`
   (exertion from a dance), the per-frame cost measured and held allocation-free.
7. **The adult package.** `insertable` in the core, the adult pack's
   affordances (the canals' channels and insertables, which the affordance
   work lists as next), `humanoid-kit-adult-animations` with its definitions,
   and one test per age-policy enforcement point showing a figure under 18
   fails closed; `check:pages` extended to the package.
8. **glTF.** `HK_interaction` import and export, and the `KHR_interactivity`
   custom-event bridge.
