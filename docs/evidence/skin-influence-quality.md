# Runtime skin-influence quality evidence

`ModelOptions.skinInfluences` selects 4, 5, 6, 7 or 8 retained MakeHuman skin
weights per runtime vertex. The body pack remains eight-wide and unchanged. At a
lower setting the runtime retains the heaviest weights, renormalises them and
zeros the remaining places; all CPU and GPU consumers still receive eight-wide
arrays.

The default is 8. It returns the source skin-array views unchanged and is the
only fidelity setting with zero error against the MakeHuman source weights.

## 2026-10-14 overhead-pose measurement

The following single-process CPU measurement used the shipped fixture body at
subdivision 0, the MakeHuman `overhead` pose, and 60 post-warm-up calls to
`skinPositions`. Position error is against the same pose with all eight source
weights. Times are milliseconds per body pose and are descriptive measurements,
not release thresholds.

| Retained weights | Non-zero weights | RMS error | P95 error | Maximum error | P50 CPU | P95 CPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 49,874 | 1.908 mm | 0.808 mm | 72.436 mm | 1.261 ms | 1.433 ms |
| 5 | 53,539 | 1.165 mm | 0.002 mm | 51.864 mm | 1.333 ms | 1.479 ms |
| 6 | 55,543 | 0.940 mm | 0.000 mm | 67.922 mm | 1.378 ms | 1.557 ms |
| 7 | 56,579 | 0.408 mm | 0.000 mm | 22.783 mm | 1.371 ms | 1.517 ms |
| 8 | 56,988 | 0.000 mm | 0.000 mm | 0.000 mm | 1.383 ms | 1.493 ms |

Lower settings visibly depart from full source skinning at isolated high-error
vertices. They are explicit caller choices; the runtime never drops quality
automatically.

The GPU shader deliberately still executes its eight-place loop, reading zeros
for discarded places. That preserves CPU/GPU geometry agreement but does not
promise a GPU speed-up. The 2026-10-14 Metal validation attempt could not supply
a timing: its analytic dual-shader path failed to compile before benchmarking
because `hkPlace` was absent from that test shader; the existing patched-mesh
parity cases passed. GPU timing remains unclaimed until that independent shader
test is repaired.
