# Runtime attachment occlusion CPU cost and error

Measured 2026-10-14 on source `f8c43f33`, with the existing
`ModelOptions.runtimeOcclusionRays` setting. This pairs actual CPU cost with
field error for the same shipped `eyes/high-poly` custom worn set used by
[the renderer evidence](runtime-occlusion-quality.md). Full fidelity defaults
remain eight skin influences, 60 fold passes and 32 runtime occlusion rays.

## Measurement

[The script](../../scripts/research/runtime-occlusion-cost.ts) loads the source
body pack and targets once before measurement. All models use subdivision 0
and only the source eyes; the set differs from the packed full attachment set,
so `occlusionBakeRecipe()` must request a real runtime bake. Every pair builds
fresh models with 32 and 16 rays, alternating their order. Nine pairs completed
in an 18-second run after discarded full-path omitted, 32 and 16 warmups.

Each model separately measures construction, first `topology()` (cold model
rest cache), second `topology()` (cached rest rays, with field allocations),
and complete `bakePosedOcclusion()` after rest. The last stage recomputes all
seven non-rest corners with the rest baseline, then projects to render
vertices. It is not a cached full posed bake. Source hashing, output hashing,
correctness assertions and asset loading stay outside the timed calls.

The runner used an Apple M2 Max, Darwin arm64 and Node 26.11.1; the command
exited 0. Private routing and job identifiers are omitted from this public report;
the exact originals are retained in private recovery storage. This shared-runner observation
is not uncontended: one-minute load average was 9.66 before and 11.03 after on
12 logical CPUs. Scheduling, JIT and allocation/GC effects are included.
Process CPU is user plus system CPU from `process.cpuUsage()`; it can exceed
wall time when the process uses additional threads.

## Observed cost

Times are milliseconds. P50 and P95 use nearest-rank quantiles over nine
samples per setting; at this sample size P95 is the maximum observed sample,
not a tail-latency estimate for production. There is no timing pass threshold.

| Stage | 32 wall P50 / P95 | 16 wall P50 / P95 | 32 CPU P50 / P95 | 16 CPU P50 / P95 |
| --- | ---: | ---: | ---: | ---: |
| Construction | 75.00 / 113.79 | 73.59 / 93.30 | 102.71 / 144.97 | 91.61 / 132.73 |
| Cold rest topology | 170.51 / 180.49 | 118.39 / 126.47 | 186.38 / 221.34 | 123.42 / 147.94 |
| Cached rest topology | 1.48 / 1.72 | 1.36 / 1.47 | 1.50 / 3.57 | 1.44 / 1.79 |
| Seven posed corners | 776.47 / 819.49 | 421.59 / 454.82 | 784.43 / 830.72 | 423.01 / 484.57 |

For this observation, 16 rays reduced cold-rest median wall cost by 30.6%
and posed median wall cost by 45.7% (1.84 times faster). Posed median process
CPU fell 46.1%. These compare medians from matched alternating samples; raw
pair samples remain in [the receipt](runtime-occlusion-cost.receipt.json).
Construction and cached-rest differences do not establish a ray-driven gain:
neither stage casts rays that vary with this setting.

The cost does not halve with the ray count. Each bake still constructs the
occluder geometry and BVH; posed corners additionally skin the body and check
which targets can reuse the rest baseline. The changed ray loop is in
`src/surface/occlusion.ts`, with the model option passed by
`HumanoidModel.bakeOcclusionAt`. No shader ray count changes.

## Error and fidelity checks

The omitted option and explicit 32 produce byte-identical rest and posed
fields. All repeated fields match their setting's output hash. SHA-256 checks
confirm that the source manifest, body, attachments, body occlusion and every
loaded source target buffer remain unchanged. Each comparison contains 8,608
render-corner components on the same source attachment.

| 16 against 32 field | Mean absolute component error | Maximum component error | Changed components |
| --- | ---: | ---: | ---: |
| Rest repeated across eight corners | 0.0342123606 | 0.1875 | 5,616 |
| Actual posed corners | 0.0341579054 | 0.1875 | 5,656 |

These are visibility field differences in [0, 1], not position errors. The
rest result reproduces the existing renderer receipt's source field error.
That receipt independently proves material consumption and front/oblique
pixel differences; this CPU run adds no new image or GPU timing evidence.
The full 32-ray default retains its existing output. Sixteen rays is an
explicit lower quality choice for this custom set, not a universal
recommendation for every attachment set or pose.

## Reproduction and scope

```sh
node scripts/research/runtime-occlusion-cost.ts \
  f8c43f33bed8ee535a87e0fe1d31eb9b24359443
```

Use Node 26 on macOS arm64 for a platform-matched comparison, with the repository
source packs available. Pass the exact checked-out source commit as the argument.
The original run used a source snapshot without Git metadata. The public receipt
retains script and source-buffer hashes, platform details,
load context, raw wall/user/system CPU samples and all assertions. A 180-second
sample budget stops after a completed pair if the requested nine pairs become
too costly; this run completed all nine. An earlier run failed receipt
finalization when it attempted Git metadata in the remote snapshot; its
measurements are excluded here.

Biome and strict TypeScript pass for the added script, and markdown lint passes
for this document. No runtime implementation, public API, source geometry,
pack bytes, quality default or geometry tolerance changes. This is bounded
CPU cost/error evidence, not a full verification, release or visual acceptance.
