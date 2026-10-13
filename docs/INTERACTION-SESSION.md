# Interaction sessions

An interaction session is a framework-free coordination channel attached to a
presence registry. It gives applications deterministic lifecycle events,
claimed body parts, named contact targets and clip time. It does not animate a
model, solve inverse kinematics, mutate a renderer, or decide application
policy.

## Lifecycle

Create the runtime with `createInteractions(registry, { seed, clipLength })`,
register definitions, then call `registry.tick(seconds)` from the simulation
clock. Subscribe with `runtime.on(participant, listener)`. Listeners receive
`accepted`, `declined`, `phase`, `beat`, `cancelled`, and `ended`
events. The event and session carry no wall-clock values, so replaying the same
definitions, seed, consent-policy answers at the same tick boundaries and ticks
gives the same lifecycle.

Applications choose their own animation, audio, UI and gameplay reactions to
these events. The subscription returns an unsubscribe function; calling
`runtime.detach()` cancels every active session, releases its claims and stops
the channel. Detach is idempotent; a detached runtime cannot propose another
session. A cancelled session is removed from `running()` before
`cancel()` returns.

## Contacts and motion consumers

Definitions can name a contact between role-local body parts. During a phase
listed in that contact, `session.contactTarget(name, role)` returns the
shared world-space target for the named role. The current public solve supports
a hand-to-hand target. `gripMeeting(a, b, out)` places that target using each
figure's measured reach, hip height and shoulder height; `armStretch` lets a
consumer assess the resulting reach fraction.

`session.trackTime(role)` returns elapsed seconds for that role's active
clip, not a normalized fraction. It scales registry time by the track rate,
wraps looping tracks at their clip length and holds a non-looping track at its
end. A renderer or animation system can use the target and track time to drive
its own neutral motion layer. The runtime deliberately has no dependency on
React, DOM, WebGL, a physics engine or a specific rig.

## Presence measurements

`FigurePresence.measures` contains `reach`, `shoulderHeight`,
`hipHeight` and `eyeHeight` in world metres. Values produced by
`presenceFromEvaluation` are derived from the evaluated control mesh.
Manually constructed presences must supply the same values so contact solvers
remain deterministic across figures of different proportions.

## Guarantees and limits

- A contact target is an instruction for a consumer, not collision, attachment
  or an animation result.
- The runtime only reports contacts while its definition is in a matching
  active phase.
- A missing or unsupported contact yields `null`; consumers must retain their
  own safe idle behavior.
- Automatic placement, inverse kinematics, clothing response and injury
  rendering are separate contracts. Track them independently rather than
  inferring them from this session API. Animation frames are the next section's
  contract.

## Animation frames

A figure that plays a clip publishes one evaluated frame per rendered (or
simulated) frame: the clip and its time, the root carry, the ground lift, the six
sole contacts with their FootLock ownership and hold, and the transform that
places the figure-local frame in the world. Consumers receive it through an
observer channel that needs no React, DOM or renderer.

### Who consumes a frame, and when

| Consumer or moment | Requirement |
| --- | --- |
| Gameplay observer of one figure (footsteps, decals, stamina) | Subscribe by figure id and keep the subscription across remounts of that figure; stop with the returned function. |
| Interaction consumer (a motion layer comparing a session's `contactTarget` with where the figure actually is) | Receive frames of a role's figure only while the session runs; the subscription ends by itself on `ended`, `cancelled`, `declined` and `detach`, with no call after `cancel()` or `detach()` returns. |
| Mount and unmount of a figure | A frame is published only while a producer is bound. Unmount releases the binding and tells observers once (`released`). |
| Client replacement (a new `HumanoidWorkerClient`, a remount under the same id, a second producer claiming the id) | Binding a figure supersedes the previous producer: its later `publish` calls are dropped and return `false`, its observers are told `superseded`, and `generation` rises, so no stale frame reaches a consumer after the change. |
| Worker evaluation (a new recipe evaluated asynchronously) | The producer rebinds its rest skeleton and `generation` rises; every later frame carries the new value. |
| Pose change with no clip | No frame: frames describe a playing clip, not a static pose. |
| Clip start, stop, seek and pause | Start publishes from the next frame. Stop (no clip) releases the binding. Seek moves `time` (it may go backwards) without carrying the root; the next frame's `delta` is only that frame's carry. A paused clip still publishes, with zero carry. |
| Frame skip (a slow frame) | One frame per producer frame, never interpolated catch-up frames; `delta` holds that whole frame's carry. |
| Two figures in one session, N figures in one scene | Frames are routed by figure id: an observer of one figure never receives another's. Each figure's producer, binding and generation are independent. |
| Dispose | Releasing every binding and unsubscribing every observer leaves the channel holding nothing; a session observer is removed by the session's own end. |
| Worker or headless evaluation (Node, a server, a test) | The same frame writer runs outside React; only the place the producer runs differs. |

### The frame

`HumanoidAnimationFrame` (from `humanoid-kit`):

- `figure` is the figure's id; `generation` rises on every binding and every
  rebinding of that id and never falls.
- `clip` and `time` (seconds into the clip) describe the pose; `root` is the
  cumulative figure-local carry (x across, z forward) and `delta` this frame's.
- `lift` is the metres the figure was raised onto the ground this frame.
- `contacts` holds six entries in a fixed order (heel, inner ball, outer ball;
  left before right for each): a figure-local `position` after the ground lift
  and before root carry, heading or any parent transform, `owned` (the real
  FootLock owner) and `hold` (1 fully planted, fading to 0 through rollover and
  release; 0 when not owned).
- `toWorld` is the 4 × 4 column-major matrix (three.js `Matrix4.elements`
  order) from figure-local to world space after this frame's carry.
  `frameContactWorld(frame, index, out)` applies it, so a contact compares
  directly with a world-space `contactTarget`.

Units are metres and seconds throughout.

### Ownership and invocation

- The frame object is the producer's and is reused every frame: it is valid only
  during the callback. Copy what you keep (`copyAnimationFrame`), as with
  presence. Nothing is allocated per frame once a figure is playing.
- In `<Humanoid>` the frame is published from the figure's own `useFrame` step,
  after its pose, lift, root carry and presence source are complete, before a
  caller's `useFrame` at priority 0 and before the presence registry ticks the
  interaction runtime for that render frame.
- Observers subscribed during a delivery start with the next frame; one
  unsubscribed during a delivery receives nothing further, not even the rest of
  that delivery. An observer may drive the clock again (reentrancy): the inner
  frame is delivered completely before the outer delivery continues.
- An observer's exception does not starve the others: every observer receives
  the frame, then the first exception is rethrown to the producer, synchronously.

### API

- `createAnimationFrames()` makes a channel; every `PresenceRegistry` owns one
  as `registry.frames`, so figure ids are presence ids.
- `frames.observe(figure, onFrame, onRelease?)` returns the unsubscribe
  function. `onRelease(reason)` is called with `"released"` when the producer
  stops and `"superseded"` when another producer binds the id.
- `frames.bind(figure)` returns a `FrameBinding` with `publish(frame)`
  (`false` once the binding is not live), `rebind()` and `release()`; release is
  idempotent.
- `interaction.observeFrames(role, onFrame, onRelease?)` observes a figure
  role's frames for that session only. A frame from a different figure under
  the role's id (the participant left and another joined) is never delivered.
- `AnimationFrameWriter` assembles a frame from an `Animator` and a figure's
  rest skeleton, outside any renderer; `<Humanoid>` uses it, and so can a
  headless producer.
- `<Humanoid presence={{ id }} animation={{ onFrame }}>` publishes into its
  provider's registry and still calls `onFrame` with the same frame.
