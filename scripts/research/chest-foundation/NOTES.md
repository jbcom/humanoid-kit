# Chest foundation lab notes

Research only: nothing here ships. The generator is `tissue.ts`; the gates are
`tests/chestFoundationLab.test.ts`; the numbers come from `tissue-probe.ts` and
`age-probe.ts`; close-ups from `pinch-check.ts` and `fold-check.ts`; renders go to
`~/.cache/humanoid-kit/chest-foundation/candidate-<sha>/` and are never committed.

## Decisions

- **Data first.** Every breast the generator draws is MakeHuman's own CC0 breast
  contribution, composed by the kit's evaluator and carried by vertex index. The
  procedural dome (`chest.ts`) is kept only as a rejected diagnostic.
- **No gender input.** The generator reads the evaluated control mesh, the library
  and per-side size and firmness. The tissue a frame already carries is measured
  from the mesh, never inferred from a frame value.
- **Carried tissue is a two-shape fit.** The frame's support relief is fitted on the
  library's average mound and its bare relief (MakeHuman's figure that carries no
  breast tissue, whose breast weight is 0); the mound coefficient is the share. The
  first version projected on the mound alone: it read the masculine frame's broad
  pectoral relief as 78 % tissue, removed that much of the average mound and dug a
  14 mm crater at the nipple (the size-0 pinch). With the bare shape in the basis the
  masculine frame measures 0 and keeps its own chest at size 0, and frames between
  measure close to 1 - g, MakeHuman's own breast weight, without reading g. The
  library's bare cell is built from a frame recipe, like its tissue cell: constant
  data, never a generator input.
- **Flat baseline keeps frame relief.** Only the tissue leaves; the rest of the
  relief (pectoral relief, rib shape, the frame's own nipple) stays. On the masculine
  frame that is its whole chest relief (10.4 mm RMS over the support). That relief
  arrives only through the frame macro: an independent chest-frame/pectoral amount is
  proposed, not built.
- **Age selects the library.** MakeHuman's breast targets exist for its child,
  young and old bodies (none for the baby) and the evaluator weights the age bodies
  linearly in years between the kit's anchors (1, 10, 25, 90, MakeHuman's own). Every library
  quantity is linear in the evaluated vertices, so cells at the anchors with linear
  interpolation reproduce MakeHuman at every age; the review ages are knots too, so
  each can be checked. Age is a development stage the caller states, not a frame
  trait: like size and firmness, it is an input to the generator's library choice.

## Watched failures (each gate seen to fail on a deliberate break)

| gate | deliberate break | seen |
| --- | --- | --- |
| legacy identity, adult | size 0.6 asked against the 0.5 legacy | fails (> 1 mm) |
| identity at every age | `libraryAt` returns the upper knot instead of interpolating | 7, 15, 33, 60 y fail |
| identity at every age, ages differ | `libraryAt` always returns the 25 y cell | every non-adult age and the age-difference gate fail |
| wrong-age library | the 25 y library used on a 13 y figure | fails (> 1 mm), as the test asserts |
| bare frame keeps its chest (pinch) | the bare shape zeroed, back to the mound-only fit | fails: share 0.97 at 13 y |
| no gender input | (byte-identity across frame evaluations) | holds; a recipe read would break it |
| simplex corners hit (sampler) | normalised uniforms instead of the area-preserving map | 2 to 3 tiles per pure vertex, fails (>= 5) |
| simplex corners hit (sampler) | independent per-coordinate LHS instead of the 2D low-discrepancy set | 3 asian tiles at seed 7, fails |
| neighbours apart (sampler) | separation target 0 (no swaps) | every seed fails the 0.2 gap |
| custom target applied (kit) | scale off by 1 % | the value and replacement tests fail |

## Sheets

`sheets.ts` writes a job for the Playwright `sheets` project
(e2e/sheets/render.sheet.ts): copy the candidate's `job.json` to a CLEAN worktree's
`.sheets/job.json` and run `pnpm exec playwright test --project sheets` there.
Install Chromium and use the platform/GPU settings documented in
[CONTRIBUTING.md](../../../CONTRIBUTING.md). The generator's output for each tile is a MakeHuman custom target
the page registers before the figure is evaluated (`$customTargets`), so skin, rig
and subdivision all come from the kit. Rows are ages, columns frame directions; every
other axis is sampled (`sampler.ts`), the seed and the condition list go to
`<sheet>.conditions.json`, and `label-sheet.ts <candidate> <renders>` prints each
tile's values under it. `plot.ts` draws relief against age from the same samples.

Decision: every figure is shown uncovered at every age. The lab exists to verify the
chest's development across ages 5 to 70, which a garment would hide; rulings 4 and 6
(DECISIONS.md) put breast development on MakeHuman's data at every age and do not
restrict a child's natural form. The sheets stay in the private cache, never
committed. (The age montage keeps its own cover; this is the lab's choice only.)

Decision: side views use the `relaxed` pose and turn 7 degrees to the front. Probed
on the real renderer: at rest and abducted the near arm still crosses the breast's
profile; overhead clears it but lifts the breast (the ptosis the sheet is there to
read); MakeHuman's T-pose clears it, but the near arm then points at a camera under a
metre away and the near plane cuts it open on 8 of 72 scatter tiles; relaxed hangs
the arms down the mid-axillary line behind the profile, and the whole side scatter
reads with no arm over a breast.

Decision: two extremes sheets. `chest-extremes` corners the chest's own axes (size,
firmness, melanin, undertone, ethnic vertex) and holds muscle, weight, height and the
face mid-range; `body-extremes` corners everything. Cornering every axis at once
buried the chest under body-wide failures (tube arms, belly rolls at weight 1),
filed as issue #74.

## Findings

- 18 y and 25 y give different tissue: the age axis is MakeHuman's 10-to-25 blend,
  so an 18-year-old is about 47% child (owner ruling, 2026-10-13, reversing an
  earlier hold of the adult body from 18).
- Identity off the knots is 1e-7 m or better at every age checked, including every
  corner of the size and firmness grid at 19, 21, 22 and 24 years, inside the blend.
- MakeHuman's own data gives a child figure tissue at size 1 (age 5: 44 mm peak), from
  its child breast targets weighted by the age interpolation. That is parity, not drift.
- The hard line under the breast at firmness 0 is MakeHuman's own: on the
  average-tissue frame at size 1, firmness 0 the generator matches MakeHuman's figure
  to 1.9e-9 m, and both turn the same 146 faces past 90 degrees from the average cup
  (the underside folding against the chest wall). Left as upstream data.
- The white blotch at the raised arm's armpit and the streak along the clavicle and
  trapezius are the studio stage's rim light, not the skin's specular and not the lab.
  Toggled one at a time on the overhead tile and a rest front tile: the mark survives
  skin specular 0, sheen 0, no normal map, roughness 1, no environment, no colour map,
  no layer channels, no body art, no scalp tint, no subsurface scatter, skin only, no
  body hair and no custom target (the plain figure has it too), and goes with all
  lights off. Lit by one light at a time, only the third directional light makes it:
  `StudioStage`'s unshadowed rim at (-1.2, 2.4, -3), intensity 1.6, which reaches
  the up- and back-facing planes of the shoulder and the raised arm's inner side from
  behind, through the body, and its hard terminator draws the streak's edge. A kit
  render defect (src/react/StudioStage.tsx), issue #63, not patched in the lab.
- Posed: the twisted and seated reads carry the tissue with the rig; the breast turns
  with the rib cage under the twist and stays at rest when seated, with no tear or
  seam at the support's edge on any of the 14 posed tiles.

## Per age on the sheets

Relief is RMS/peak in mm of the added tissue at size .5 and size 1 (firmness .5) on
the average-tissue frame; neighbours' difference is the pairwise RMS at size 1.
The 18, 21 and 25 reads come from the age strips (below); 21 is not a scatter row.

| age | what the sheet shows | relief .5 / 1 | vs next age |
| --- | --- | --- | --- |
| 5 | child torso; flat to a soft bud at high size, areola faint | 4.6/15 · 16.5/44 | 14.8 mm: clear |
| 9 | budding at low size; at size near 1 a full, low breast | 5.8/18 · 31.2/82 | 4.3 mm: clear |
| 13 | small to full adolescent breast, rounder, higher | 7.0/21 · 35.3/94 | 2.6 mm: subtle |
| 18 | about half child: narrower shoulders, small sizes still near-flat in profile | 8.7/26 · 36.2/98 | 1.5 mm: subtle |
| 21 | between: the mid sizes (.4 to .8) gain projection, size 1 nearly as at 25 | 9.7/29 · 36.9/101 | 2.1 mm: subtle |
| 25 | adult body: broadest shoulders, a small mound already at size .4 | 11.2/33 · 37.8/105 | 3.5 mm: subtle |
| 40 | adult; low firmness starts to drop the lower pole | 11.1/33 · 37.3/104 | 3.5 mm: subtle |
| 55 | lower, longer lower pole at low firmness | 11.0/32 · 37.1/103 | 3.5 mm: subtle |
| 70 | most ptosis; long, low breast at low firmness | 11.0/32 · 37.2/102 | n/a |

The age strips (`chest-age-strips`: the g0 and g50 frames at 13, 18, 21 and 25,
each swept over size and firmness) show MakeHuman's 10-to-25 blend row by row.
Front, the frame carries most of the change: the shoulders and the rib cage widen
steadily from 13 to 25, and the breast keeps its place on the chest. At size 1 the
mound is nearly the same at every age (36 to 38 mm RMS), so it reads relatively
larger on the narrower 13 y and 18 y chests. Side, the change is at the small and mid
sizes: at 13 y sizes 0 to .4 are flat with a point at the nipple, at 25 y size .4
is already a small mound. Firmness 0 gives the same low, long lower pole at every
age, and firmness 1 the same high round form. No seam, fold or tear on any of the
176 tiles; skin and areola tone hold across ages for each figure.

From 13 on, neighbouring ages read apart only side by side on matched size and
firmness (the strips), not across the scatter, where size and firmness swamp an
age step of 1.5 to 3.5 mm. The 9 y figure at size 1 carries 31 mm RMS of MakeHuman's own child
targets; that is parity (above), and it is the tile a reviewer will question first.
