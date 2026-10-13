# Labioscrotal root-continuity diagnosis — 2026-10-11

## Scope and candidate

This is a bounded diagnosis of the frozen adult-anatomy candidate
`540e5dbe24f1` plus its declared source overlay.  It was run in the isolated
`fix/labioscrotal-root-continuity-20261011` worktree.  No source-pack files,
generated pack data, browser code, or publication files were changed.  The
candidate's inherited dirty overlay remains deliberately separate from this
lane.

The target is intentionally narrow: male static detail, age 30, gender 1,
phallus 0.65, vulva 0, anal canal 1, while testes vary.  The control is the
same recipe with testes 0.  The required result is no testis-induced inverted
or squashed faces beyond that control in the abducted pose, before and after
the hip fold.  This note makes no claim about the independently observed
female appearance fault or the combined-form overlap.

## Reproduction

The red test was created and run from this worktree with:

```sh
heavy-slot --remote-test --render-host <render-host> \
  pnpm exec vitest run tests/labioscrotalRootContinuity.test.ts
```

The first failing assertion was `T0.01: expected 15 to be less than or equal
to 1`.  Candidate counts in the abducted pose were:

| testes size | inverted faces | control delta |
| --- | ---: | ---: |
| 0 | 1 | 0 |
| 0.01 | 15 | +14 |
| 0.1 | 42 | +41 |
| 0.6 | 28 | +27 |
| 1 | 108 | +107 |

At `T=0.6`, witness triangle 123994 is render vertices `64431`, `64414`,
and `64415`.  The first two are labioscrotal reservoir vertices with root
shares `0.080605179` and `0.133066803`; the third is adjacent unowned skin
with share zero.  Their corresponding pushes are `0.000784373 m`,
`0.000963324 m`, and zero.

## What the decomposition proves

The baseline evidence's split is reproduced: static detail is clean, and the
first failure is after evaluated skinning.  Replacing the `T=0.6` evaluated
skin with the no-testes topology skin reduces the count from 28 to 5.  Thus
23 of the 27 added inversions need an evaluated-skin solution, but four added
inversions remain in the drawn geometry even with all labioscrotal root
shares removed.

The mean labioscrotal root is not a neutral pelvis-only attachment.  Its four
influences are `spine05` (0.6427767), `upperleg01.R` (0.1552858),
`upperleg01.L` (0.1530853), and `pelvis.L` (0.0488521).  In abduction,
changing that spatially varying attachment to one averaged row creates a
large incompatible motion field across the sac.

## Falsified bounded runtime changes

Every experiment below was reverted before this report was written.

| Experiment | Result at `T=0.6` unless noted | Why it is rejected |
| --- | ---: | --- |
| Delay root onset to the existing 5–20 mm carriage interval | `T=0.1`: 238 inversions | It moves the discontinuity deeper into the organ. |
| Give the immediate unowned triangle neighbours the mean reservoir root share | 34 inversions | It pushes a discontinuity out over 113 surrounding skin vertices. |
| Start labioscrotal carriage at zero push | `T=0.01`: 23; `T=0.6`: 12 | Early carriage changes the small control semantics and still fails. |
| Scale every labioscrotal root share | best tested result: 3 inversions | No tested factor reaches the control's one inversion; a fitted factor would be arbitrary. |
| Blend reservoir rest geometry toward the no-testes body by the same share used for skinning | 39 inversions | A pose-independent rest correction cannot compensate the pose-specific LBS transform. |
| Restore low-share collar vertices to the no-testes geometry while retaining their original skinning | 5 inversions | It exposes the geometry-only residual, rather than removing it. |
| Use `spine05` as the whole root | 175 inversions | The model cannot collapse the attachment to a single trunk bone. |

These results reject global bandwidth/onset/collar/simple-exterior-share
changes and a local constant search.  They also reject treating the witness
triangle as the whole cause: the evaluated failure includes interior reservoir
faces as well as root-boundary faces.

## Exact remaining stage

There is no justified runtime-only repair within this lane's scope.  A valid
fix must do both of the following:

1. Re-author the labioscrotal root geometry so that its first mobile rings
   have a positive, non-folding shape under the copied loop weights; this is
   the four-inversion residual present with evaluated root skinning disabled.
2. Replace the single averaged root row with a spatial attachment field, or
   add a pose-dependent skinning corrective that makes the field continuous
   across the reservoir and adjacent body triangles.  A rest-space multiplier
   cannot reproduce that correction across abducted, seated, and squat poses.

The first option requires the prohibited source-pack/repack lane (including
`scripts/lib/detail/scrotum.ts` and regenerated adult data).  The second
requires a renderer/CPU pose-corrective design outside this lane's allowed
`reservoirSkin`/`detailCarry` scope.  Either next lane must preserve the
measured sac sizes and then run the full required matrix: `T=0.01, 0.1, 0.6,
1`, before and after hip fold, seated, squat, and the other feature controls.

No tolerance was relaxed, no baseline was blessed, and no feature was removed.
