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
definitions, seed and ticks gives the same lifecycle.

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

`session.trackTime(role)` returns the normalized current time for that role's
active clip. A renderer or animation system can use the target and track time
to drive its own neutral motion layer. The runtime deliberately has no
dependency on React, DOM, WebGL, a physics engine or a specific rig.

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
- Automatic placement, inverse kinematics, clothing response, injury
  rendering and animation-frame callbacks are separate contracts. Track them
  independently rather than inferring them from this session API.
