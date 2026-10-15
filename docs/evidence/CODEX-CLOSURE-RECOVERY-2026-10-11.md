# Interrupted closure recovery: 2026-10-11

Codex took over the owner's interrupted Claude work on `feat/female-form`
from `d04feba`. This is a recovery checkpoint, not foundation acceptance.
The prior integration ref remains `4504756`; no publication is implied.

## Recovered transition

Claude stopped after changing closure from a shape string to a gap plus
optional finite slit length. Four type errors and two NaN test failures
reproduced the incomplete test transition. The updated tests check shortened
skin curvature, gap, no unwanted lengthening and per-figure displacement.

The pack was regenerated successfully with:

```text
pnpm pack:data <makehuman-data> <adult-sysassets>
```

The vaginal slit uses its own loop's length; the anal slit is 3 mm long. The
revised harmonic solver and all other interrupted lane edits are preserved.

## Verification and limits

| Check | Result |
| --- | --- |
| Typecheck | Pass after API transition |
| Changed-file Biome checks | Pass |
| Full unit suite on a macOS runner | 1,615 passed, two failed, one skipped; 166 files |
| Canal visibility within that suite | Six adult body variants passed from below and front-low |
| Corrected placement/closure tests on a macOS runner | 15/15 passed |
| Fresh close-up on a macOS runner, retries disabled | 1/1 passed |

The full suite had two failures:

- `adultReservoirs`: a placement comparison included the closure stencils
  added later by the packer. Placement still compares exactly; a separate
  check now validates target, gap, length, loop binding and finite CSR weights.
  The focused rerun passed.
- `foundationSmoke`: f-slim seated squashed area was 83.8818878027986 cm²
  against a baseline of 83.84622203957953 cm² (plus 0.001 rounding slack).
  The baseline and tolerances were not loosened. The diagnostic rerun uses soft assertions and found
  13 regressed checks across nine posed rows. Failures remain failures.

| Body and pose | Regressed checks |
| --- | --- |
| f-slim seated | Squashed area |
| f-slim squat | Penetrating area, squashed area, folds |
| f-heavy seated | Inverted triangles, squashed area |
| f-heavy squat | Inverted triangles |
| m-muscular seated | Penetrating area |
| m-muscular squat | Inverted triangles |
| m-heavy seated | Inverted triangles |
| m-heavy squat | Inverted triangles |
| f-elder squat | Squashed area, folds |

The first close-up job was flaky:
its first attempt returned two Vite `504 Outdated Optimize Dep` responses
before passing on retry. Its trace showed late discovery of
`three-mesh-bvh` and `three/examples/jsm/environments/RoomEnvironment.js`,
invalidating the R3F and Three shared chunks. Those exact dependencies are now
prebundled; the fresh job passed with `--retries 0`. Errors were not suppressed.
The configuration follows the official Vite dependency-optimization contract.

## Visual ruling

The fresh close-up still shows pinched/radiating seams at the closure and
bright segmented highlights along the midline. A closed mathematical opening
and a clean render job do not establish the required surface quality. This
lane must not land on integration until those seams and the no-worse-row
regressions are resolved and the poses are freshly judged.

Complete phase logs, PNG sheets, original routing receipts and the first-run
trace remain in private recovery storage; they are not public attachments.
Every browser job used the silent harness;
these were headless Metal review renders, not final headed gameplay proof.

## Concurrent work discovered

Another session changed the architecture, visibility test and game takeover
record while these jobs were running. Those edits were preserved. The results
above identify their exact pool snapshots; they do not certify later concurrent
changes. Shared-source mutations and a combined checkpoint commit were paused
pending confirmation of a single implementation owner. No library branch was
merged, pushed or published by this recovery session.
