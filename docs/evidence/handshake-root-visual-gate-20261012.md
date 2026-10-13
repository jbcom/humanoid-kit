# Tall / short handshake root visual gate

Status: **ready for root visual diagnosis; not accepted as physical contact.**

This isolated presenter is based on `feat/interaction-handshake` at `83f8cd2`.
It exists to preserve the interaction branch's valid lifecycle, consent,
presence, target and hand-frame evidence while making the remaining animation
gap visible. It does not change interaction runtime behavior, add a game
integration, create any anatomy-specific interaction, or invent hand motion.

## Route

Run the playground from the isolated worktree, then open the silent route:

```sh
pnpm dev -- --host 0.0.0.0
# http://<host>:5173/?scene=handshake&clothing=1&muted=1&stage=grip&view=side
```

The route refuses to mount without `muted` and `clothing`. It uses one neutral,
clothed adult tall/short pair, and the two fixture participants each register a
positive interaction policy rather than relying on the runtime's default
acceptance of an all-audience definition.

## What root should inspect

The presenter includes stage buttons (`approach`, `grip`, `release`,
`cancel`) and front, three-quarter and side views. `stage` and `view` are
preserved in the URL, so each review state can be linked directly. **Inspect
hold** is the default: after the selected actual runtime phase is reached, it
stops copying runtime values into the review surface. The panel therefore keeps
that phase's `trackTime` and contact target while the underlying runtime stays
attached, so the next requested stage begins a fresh interaction. **Play once** is separate and deliberately runs through its normal
lifecycle. The panel occupies a dedicated sidebar on desktop and a separate
lower row on narrow screens; it never overlays a figure. The camera fits the
full clothed pair in the remaining stage. Its panel reports:

- current requested stage, actual runtime phase, inspect/play state and frozen runtime clock;
- independent clothing, settled-geometry and animation-source readiness signals;
- the yellow shared `contactTarget` and the live RGB right-hand frames;
- each live hand-frame-to-target gap in centimetres;
- settled/binding failure state.

The gaps are a diagnostic, not a pass claim. The package still uses `idle1` as
the shared-clock source because no authored handshake clip or hand IK exists.
Therefore a visible gap proves the known missing target-to-hand closure rather
than being hidden by moving a group, marker or presence anchor. Do not accept
the physical-contact milestone until a future source changes rendered arm and
hand bones from `trackTime` and `contactTarget`, each grip gap is at most
1 cm, all review views contain both full clothed figures and the target, and
root records a fresh review conclusion.

## Automated presenter checks

`e2e/sheets/handshake.sheet.ts` remains an explicit review command. It checks
the mute marker, adult/clothed source, explicit fixture-consent state, a mounted
R3F canvas, absence of the visible boot-error boundary, the direct-link
stage/view restore and URL updates, the diagnostic region, runtime target, both live hand frames and finite gaps for the non-cancelled
stages, and a held actual phase for all four stages and three views. The
cancelled state asserts that it has no stale target. The canvas probe publishes
snapshots to the DOM panel through an external subscription; the panel never
calls an R3F hook. It intentionally does
**not** accept a gap as physical contact while the real clip/IK is absent.

```sh
heavy-slot pnpm exec playwright test e2e/sheets/handshake.sheet.ts --project sheets
```

The command is silent through `openSilentGame`; root should use the headed
route above for personal visual QA after the isolated branch is wired.

## Wiring dependencies

This presenter must land only with the dependency sequence below:

1. `feat/interaction-handshake` (`83f8cd2`): `createInteractions`, expanded
   presence registry/object support, affordance frames/state and the neutral
   regional-contact validator.
2. Published animation and clothing packages already used by the lab:
   `humanoid-kit-animations` (the diagnostic `idle1` source) and
   `humanoid-kit-clothing` (the two required outfits).
3. This presenter branch:
   `chore/handshake-root-visual-gate-20261012`, whose only production-facing
   files are `playground/src/HandshakeLab.tsx`, its explicit sheet fixture,
   and this evidence note.

Do not wire this route into `live-review`, a game, or a public release until
the interaction branch itself is reconciled with the chosen integration tip
and the root visual gate is reviewed. The branch has no consumer workaround
for the missing React interaction boundary, stimuli, regional response or
injury state.
