# `braids01` plait candidate: root and silhouette diagnosis

**Status:** rejected private comparison; no pack, manifest, endpoint, or product change follows from this document.

**Scope.** This is a read-only diagnosis of the private three-strand candidate against the current `braids01` binding and carrier. It records the source-level cause of the rejected root silhouette and the limits of the geometric proof. It is not a visual acceptance claim.

## Compared evidence

The comparison used the same adult female, age-30 balanced recipe and the same body-bound camera for the candidate's front capture: target `y=1.4478564858436584`, target `z=0.043688733130693436`, camera `z=0.9207594842766442`, zoom `1.5`, field of view `35`.

The reviewed records were the matched front, side, and back private candidate captures. The review found a spiky crown/root region and a side/back mass that read as fine vertical streaks rather than distinct box braids. The matching camera eliminates framing drift as the explanation for that comparison. It does not make the candidate visually acceptable.

## What changed and what did not

| Component | Current style | Private candidate | Consequence for the diagnosis |
| --- | --- | --- | --- |
| Bound scalp carrier | Existing `ropeGrid` roots and `combRope` path | Unchanged | The carrier remains the controlled constant; the evidence does not implicate the body binding or its source data. |
| Braid body | One five-sided, texture-stencilled tube | Three four-sided tubes on an alternating over/under path | The candidate introduces physical strands but changes their root placement and aggregate silhouette. |
| Root density | 179 generated root sections | Same 179 root sections | A lower density did not hide the problem. |
| Material and atlas | Existing opaque `braids01.webp` atlas | Same atlas with strand V offsets | The candidate did not prove a new material path. |
| Crossings | Painted V bands only | Seven alternating crossings over 21 segments | Crossing validity is a geometry property, not a screen-space readability proof. |

## Root-spike cause

The candidate retains the carrier intentionally. `combRope` first puts its centerline 2 mm below the bound root, then makes its first departure over a 6 mm segment in the mixed comb/scalp-normal direction. That is a sensible single-rope anchor.

The candidate calls `ropePath` first and then `threeStrandPlait`. `threeStrandPlait` applies each strand's permanent lateral lane offset at its first ring: `-laneRadius`, `0`, and `+laneRadius`, where `laneRadius` is 5.6 mm. The strands themselves have a 2 mm radius. There is no shared-root or aggregate-to-three-strand transition before this full separation.

This creates three physically offset tubes as soon as the short, rising carrier leaves the scalp. At the crown, the lateral fan is large compared with that first 6 mm departure. The result is the observed radiating/bristly root pattern. This is an authored offset-transition problem after the unchanged carrier path, not evidence that the carrier or the bound body mesh is wrong.

The prior single-tube style has a different issue: its large collar makes crowded root clumps. It does not have the candidate's immediate three-lane split, so it cannot validate or refute the candidate's spike mechanism.

## Why valid crossings still did not read as box braids

The candidate's focused geometry checks establish an alternating crossing order, continuity, and nonintersection. Those tests are necessary safety checks, but they do not establish recognition at the intended view.

At the reviewed figure framing, 179 simultaneous three-tube braids form a dense curtain. Each braid has only seven crossing periods along its length, and the three tubes share the old opaque atlas. The result has no deliberate screen-space bundle envelope or root-to-braid transition: it resolves as parallel fine lines in the side and back captures. Four-sided strand tubes may contribute visible faceting at close range, but the rejection is primarily a scale and silhouette failure rather than evidence of an alpha or texture-loading defect.

## Bounded next visual experiment (not implemented)

The next candidate should be admitted only after a short visual design brief is recorded with a real box-braid reference and its provenance. The reference is for analysis only; it must not be traced, sampled, packed, or shipped unless its licence separately permits that. Existing provenance is insufficient here because `braids01` is an authored style and the imported CC0 `braid01` is a different straight side-braid style.

The experiment should keep the present scalp carrier and root count, and compare only two representations at the same recipe and camera:

1. the current private candidate; and
2. a root-aggregated plait candidate whose three strands begin from a single, clearance-safe shared root profile before separating into the alternating braid.

Before any implementation, the design brief must state measurable review criteria:

- **Root criterion:** the first visible segment leaves each parting as one coherent bundle; no radial spike longer than the aggregate root transition and no accidental scalp gap created by an immediate lane offset.
- **Silhouette criterion:** front, three-quarter, side, and back views at the normal whole-figure framing show separated braid bundles rather than a uniform line curtain; a close framing shows alternating over/under structure without relying on painted stitches.
- **Motion criterion:** the same evidence is captured in a small head/neck motion so the bundle does not collapse into a flat card or intersect itself.
- **Cost criterion:** report vertices, faces, draw calls, texture bytes, and frame-time deltas against the current style before promotion. A geometry-budget pass alone is not acceptance.

Root must personally inspect that evidence before any release candidate is generated. This document does not authorize further groom tuning.
