# REST-pose hip-fold elimination — CI evidence

This evidence records the narrow performance repair made from PR 24 head
`190270e7fcd69cc1537a2940388551e54afa4b46`. It is not a claim that the PR's
remaining browser, shader, or animation failures are resolved.

## Contract

`posedSurface` skips the hip-fold solve only when `pose === REST_POSE`. The
rest contract has zero hip flexion, and the fold application returns before it
reads fold data. All named body poses keep the existing solve and renderer
fold conversion.

`tests/foundationPosed.test.ts` proves this for both the core fixture and the
existing adult fixture:

- Skinned REST positions and normals are byte-identical with a fully solved,
  rendered fold and without one.
- A `model.hipFold` guard proves that the REST path does not invoke the solver.
- Existing raised, seated, and seam pose cases remain in the same focused run.

## Measurements

Commands were run on a macOS runner with the underlying Vitest commands; no
timeouts, coverage thresholds, assertions, or visual tolerances changed.

| Witness | PR 24 baseline | REST-only candidate | Change |
| --- | ---: | ---: | ---: |
| Focused coverage selection (31 behavior tests) | 341.19 s | 279.72 s | -18.0% |
| `foundationLandmarks` adult-form invariant | 185.533 s | 1.828 s | -99.0% |
| `phallus` pack target witness | 201.848 s | 198.351 s | -1.7% |

Original baseline and candidate routing receipts and artifacts are retained
privately, not distributed with this report.
The candidate's focused test selection passed all 31 behavior tests, but its
command exits 1 because a two-file selection cannot satisfy the repository's
global 90/90/90/85 coverage thresholds. That exit is expected for this
measurement and is not a green full coverage gate.

The specific REST regression was rerun separately on macOS:
6/6 tests passed in 18.76 s.

## Remaining CI work

The phallus witness remains a separate long-running cost. This repair does not
address the existing browser timeouts or the animation E2E failures, and those
gates remain required.
