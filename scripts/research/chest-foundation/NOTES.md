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
  linearly in years between the kit's anchors (1, 10, 18 to 25, 90). Every library
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

`sheets.ts` builds hk-sheets requests (the integrator renders them on the real
playground): the generator's output for each tile is a MakeHuman custom target the
page registers before the figure is evaluated (`$customTargets`), so skin, rig,
subdivision and the cover garment all come from the kit. Rows are ages, columns frame
directions; every other axis is sampled (`sampler.ts`), the seed and the condition
list go to `<sheet>.conditions.json`, and `label-sheet.ts` prints each tile's values
under it once the sheet returns. `plot.ts` draws relief against age from the same
samples. Every figure under 18 wears the sheets' cover garment (asserted).

## Findings

- 18 y and 25 y give identical tissue: the kit holds the adult body from 18 to 25
  (`AGE_ANCHORS`), a documented deviation from MakeHuman's 10-to-25 blend.
- Identity off the knots is 1e-7 m or better at every age checked.
- MakeHuman's own data gives a child figure tissue at size 1 (age 5: 44 mm peak), from
  its child breast targets weighted by the age interpolation. That is parity, not drift.
- The hard line under the breast at firmness 0 is MakeHuman's own: on the
  average-tissue frame at size 1, firmness 0 the generator matches MakeHuman's figure
  to 1.9e-9 m, and both turn the same 146 faces past 90 degrees from the average cup
  (the underside folding against the chest wall). Left as upstream data.
