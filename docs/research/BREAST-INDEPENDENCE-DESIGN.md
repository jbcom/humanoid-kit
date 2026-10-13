# Breast independence design

**Status:** proposal for issue 27. This document makes no source, recipe, schema,
asset, numeric-range, or visual-quality change.

## Problem observed at the integration baseline

`macroTargetWeights` in `src/makehuman/macro.ts` emits the upstream
`breast/female-*` targets only after multiplying them by `1 - gender`.
The same function therefore makes both `breastSize` and `breastFirmness` exact
no-ops at `gender: 1`. This is a coupling between a frame macro and chest
traits, even though the recipe and regional system already represent the two
breast macros independently.

The supplied target family cannot be made independent merely by deleting that
multiplier. It contains no target for
`female-*-averagecup-averagefirmness`: upstream treats that combination as the
base of its **female** body. The family is a delta around that female reference,
while the male-frame base has a different chest. Applying those deltas directly
to a male or mixed frame would have no verified tissue baseline and would make
the apparent result depend on an accident of the source targets.

The body pack does have six local `breast/*` shape modifiers (translation,
distance, point, vertical volume, nipple size and nipple point). They are useful
fine adjustment after a coherent chest is present. They are not a replacement
for an all-frame size and firmness foundation: there is no full projection/
tissue-volume modifier and their current targets do not establish a matching
base or softness response.

## Geometry witness

The following was measured on the committed integration body pack at age 25,
with `HumanoidModel(..., { subdivision: 0 })`. For each axis, the control mesh
was compared with the same frame at `breastSize: 0.5` and
`breastFirmness: 0.5`. `max` and `mean` are per-vertex Euclidean displacement in
metres; `moved` counts vertices whose displacement exceeds `1e-7` metres.

| Frame macro (`gender`) | Axis | Endpoint | Max | Mean | Moved |
| --- | --- | ---: | ---: | ---: | ---: |
| 0 | size | 0 | 0.025078 | 0.000266 | 534 |
| 0 | size | 1 | 0.092430 | 0.001078 | 700 |
| 0 | firmness | 0 | 0.016519 | 0.000152 | 334 |
| 0 | firmness | 1 | 0.008182 | 0.000072 | 280 |
| 1 | size | 0 | 0 | 0 | 0 |
| 1 | size | 1 | 0 | 0 | 0 |
| 1 | firmness | 0 | 0 | 0 | 0 |
| 1 | firmness | 1 | 0 | 0 | 0 |

This is a geometry witness, not visual acceptance. It proves the current
coupling and shows that the female source family contains active size and
firmness deltas. It does not prove that either endpoint is anatomically
credible on every frame.

For a direct, independently repeatable probe, construct each recipe with
`age: 25`, evaluate the control mesh at subdivision zero, and compare three
float components per vertex. The current left nipple landmark also demonstrates
the suppression: at size 0, 0.5 and 1 its positions are respectively
`[0.09799, 0.43839, 0.13936]` for frame 1, while frame 0 moves from
`[0.09036, 0.33553, 0.13930]` to `[0.11726, 0.29783, 0.20110]`.

## Smallest credible implementation direction

Add an **opt-in independent chest trait layer**, separate from the existing
MakeHuman-compatible macros:

```ts
// Sketch only: names and numeric bounds require their own review.
chest?: {
  breast?: { size: number; firmness: number };
}
```

A missing `chest.breast` keeps the present macro path byte-for-byte in effect,
which preserves old saved recipes and their expected MakeHuman result. When the
field is present, the evaluator must use a new, explicit target family that
maps a flat/base chest to the selected size and firmness on every frame. Its
contribution must not read `gender` as a gate or multiplier. Existing
`regionalMacros.breastL` and `.breastR` remain legacy regional controls until a
separate compatibility migration deliberately maps them; they must not silently
change meaning.

The new target family needs these authored components per age/body support
policy:

1. **Base-to-average tissue**: a continuous, chest-local delta that establishes
   the intended average volume on any frame.
2. **Average-to-size endpoints**: size deltas relative to that common average,
   not relative to the old female source base.
3. **Firmness response**: its own shape/support deltas at a fixed size. It must
   not be inferred by scaling a size target.
4. **Frame-safe anchoring**: targets must move the same chest landmarks and
   preserve the sternum, clavicle, shoulder and arm joins on female, male and
   mixed skeletal frames.

This adds data and a narrow evaluator branch rather than changing the meaning
of `gender` or reusing the source-only female family outside the reference it
was made for. It also means size zero can mean an explicitly reviewed flat/base
chest, rather than the current `mincup` source endpoint. The female
average-cup source baseline and the new flat/base chest are distinct concepts;
neither should be disguised as the other.

## Required lab comparison before accepting an implementation

The lab should hold frame, age, weight, muscle, height and pose fixed while it
compares these cases side by side:

| Case | Frame | Independent chest | Purpose |
| --- | --- | --- | --- |
| A | female endpoint | absent | legacy reference; must retain its current result |
| B | male endpoint | absent | legacy reference; must retain its current result |
| C | female endpoint | flat/base, average, high size; low/average/high firmness | verifies the new layer can replace a legacy-looking chest without a seam |
| D | male endpoint | flat/base, average, high size; low/average/high firmness | proves traits respond without a gender lock |
| E | mixed frame | the same C sweep | catches source-frame interpolation artefacts |
| F | each of C–E | left/right differences | proves side-specific regional blending, if that extension is accepted |

At minimum, the lab needs front, both three-quarter, profile, raised-arm,
twist, seated-bend and clothing-overlay views. It must record each case's
recipe and the following geometry checks before any visual claim:

- finite positions and normals;
- nonzero size and firmness response at every frame where the explicit trait is
  present;
- continuity at the sternum, upper chest, axilla and under-breast transition;
- left/right isolation for a one-side case;
- no intersection with arm or torso in the motion poses; and
- legacy recipes with no new trait matching their pre-change control meshes.

The lab is the acceptance surface for target quality. The numeric range and
final UI control type are intentionally outside this proposal.

## Compatibility and test contract for a later implementation

A later source change should add tests that establish all of the following:

1. A legacy recipe without the new field yields exactly its existing
   contributions and control positions.
2. Explicit independent size and firmness each produce a finite, nonzero
   change for female, male and mixed frame values.
3. Changing the frame macro does not remove an explicit chest trait.
4. A one-side trait changes the intended side while preserving the other side
   within a stated seam tolerance.
5. Pack absence has a clear failure or pending-data outcome; it must not quietly
   fall back to the old gender multiplier.
6. Save/load preserves an explicit zero, an absent trait, and the distinction
   between flat/base and the legacy female-average baseline.

No numeric extrema, UI widget, target-generation method, or migration policy is
approved by this document.
