# Chest foundation lab notes

Research only: nothing here ships. The generator is `tissue.ts`; the gates are
`tests/chestFoundationLab.test.ts`; the numbers come from `tissue-probe.ts` and
`age-probe.ts`; renders go to `~/.cache/humanoid-kit/chest-foundation/candidate-<sha>/`
and are never committed.

## Decisions

- **Data first.** Every breast the generator draws is MakeHuman's own CC0 breast
  contribution, composed by the kit's evaluator and carried by vertex index. The
  procedural dome (`chest.ts`) is kept only as a rejected diagnostic.
- **No gender input.** The generator reads the evaluated control mesh, the library
  and per-side size and firmness. The tissue a frame already carries is measured
  from the mesh (its support relief projected on the library's average mound),
  never inferred from a frame value.
- **Flat baseline keeps frame relief.** Only the mound-shaped component of the
  frame's relief leaves; the orthogonal remainder (pectoral relief, rib shape) stays.
  On the masculine frame about 5 mm RMS remains. That relief arrives only through
  the frame macro: an independent chest-frame/pectoral amount is proposed, not built.
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
| no gender input | (byte-identity across frame evaluations) | holds; a recipe read would break it |

## Findings

- 18 y and 25 y give identical tissue: the kit holds the adult body from 18 to 25
  (`AGE_ANCHORS`), a documented deviation from MakeHuman's 10-to-25 blend.
- Identity off the knots is 1e-7 m or better except between 13 and 18 y (3 µm at 15 y),
  inside the 10 µm gate.
- MakeHuman's own data gives a child figure tissue at size 1 (age 5: 44 mm peak), from
  its child breast targets weighted by the age interpolation. That is parity, not drift.
