# Runtime fold solve pass ceiling

Measured on 2026-10-14 against source base `8e4387ae`, with the optional
`ModelOptions.foldSolvePasses` change. The setting is an integer from 1 to 60,
default 60, copied once into a model. It caps only the first contact-push round
at every hip and knee key and opening. The existing 15-pass later rounds,
smoothing, press-back, keys, openings and source fields remain unchanged.

## Deterministic checks

`tests/foldQuality.test.ts` compares omitted and explicit 60 on the actual source
mesh, byte for byte, for vertex ids, slots, displacement, normal correction,
sides and strain. It rejects invalid values, including non-integers, non-finite
values and out-of-range integers, before an empty skeleton could hide them.
It also verifies that mutating a caller's options after construction does not
change the model's ceiling, and that repeated shape requests reuse its cache.

A synthetic unresolved contact executes 75 real contact queries at 60 passes
and 35 at 20: the first round's ceiling plus the unchanged 15 later passes.
Real edge-crossing queries decrease by the same 35/75 ratio. The contact probe
returns no separating direction deliberately, so early convergence cannot
hide the ceiling. This is loop-work evidence, not a timing or geometry result.

## Source body observation

The packed source body uses age 25, weight 1 and muscle 0.3, with other recipe
traits at their defaults. It uses all eight source skin influences. Direct
solvers measure the complete control-mesh hip and knee tables, including every
key and opening. An omitted-option solve precedes the timed explicit 60 solve,
then the explicit 5 solve. Node 26 runs without coverage instrumentation on a
Mac execution host under concurrent pool load.

| Joint | 60 passes observed CPU wall time | 5 passes observed CPU wall time | Displacement component MAE | Maximum component error |
| --- | ---: | ---: | ---: | ---: |
| Hip | 7.471–8.742 s | 7.410–9.216 s | 0.0854 mm | 8.5032 mm |
| Knee | 1.733–2.068 s | 1.721–2.033 s | 0 mm | 0 mm |

These two observations establish no reliable speedup; the 5-pass hip was
slower in the repeat. The setting does not
change shader work, so these timings establish no GPU gain. Another observation
at 20 passes produced byte-identical hip and knee fields; a cap above natural
convergence can change neither quality nor useful work.

Across all keyed hip fields, the 5-pass normal-correction components differ by
0.002826 on average and 1.858167 at most. Strain differs by 0.001873 on average
and 0.248470 at most. These are absolute field-component differences, not
normal angles or position-vector distances. All knee fields are identical in
this observation. This source hip's changed displacements guard against a
wrapper silently dropping the pass ceiling.

The existing contact measure samples hip flexions 90°, 120°, 135° and 140° at
openings 0°, 10° and 20°, and knee flexions 90°, 120°, 135° and 155°. The deepest
measured penetration is 0 mm at both ceilings for this body at those poses;
crossing counts differ (for example hip 120° closed: 3 versus 4). This small
sample is not a guarantee for every body, key or interpolated pose. Lower caps
can change contact sharing, displacement, normals and strain, and may increase
penetration in other figures. Five passes is an explicit quality tradeoff,
not a recommended universal setting.

## Real worker and renderer

`tests/browser/foldQualityInspection.test.tsx` constructs real module Workers
with 60 and 5 passes, requests folds through `HumanoidWorkerClient`, and renders
both through `<Humanoid>`. The subdivision-1 source body is tucked, so both hip
and knee folds reach geometry slots and `DualBones` textures before settlement.
Both keep more than 50 fold slots per joint and populated fold textures.

The browser uses muted headless Chromium through ANGLE Metal. Four 512×512
render-target views share exactly the same cameras and lighting. Frozen pixel
readbacks are displayed together in a complete four-camera comparison capture.

| Camera | RGB mean absolute difference, 8-bit units | Maximum channel difference |
| --- | ---: | ---: |
| Front | 0.001831 | 69 |
| Side | 0.000889 | 50 |
| Above | 0.001054 | 94 |
| Below | 0.001738 | 50 |

Small image averages do not bound every keyed field's error: the tucked pose
samples only part of the full solved table. The comparison is evidence that
the option traverses the actual worker and renderer, not whole-body visual
acceptance for every lower ceiling.

## Gates

The quality unit checks pass, and the real-worker renderer inspection passes.
The existing `tests/hipFold.test.ts` and `tests/kneeFold.test.ts` pass all 26
checks at the default, with their geometry tolerances unchanged. Lint,
markdown lint, typecheck, build and package checks also pass. No source packs,
closure fields, sampling density, geometry tolerances or coverage thresholds
were changed.
