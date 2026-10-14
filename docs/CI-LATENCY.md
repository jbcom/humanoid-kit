# Performance Report – codex/ci-latency-repair (2026-10-14)

## Executive Summary

This repair targets the observed worker and collar-test failures in
[CI run 38584382238](https://github.com/jbcom/humanoid-kit/actions/runs/38584382238)
(commit `30328f4c`). It changes test responsibilities, not production geometry,
solver ceilings, timeouts, coverage thresholds or skip policy.

| Metric | Before | After | Change |
| --- | --- | --- | --- |
| Instrumented worker fold test, render Mac | 27.918–28.766 s | 2.512 s lifecycle + 1.818 s transport | 84–85% less test time |
| First real computed flexion, instrumented | Not separately observed | 0.630 s | Cancellation now starts after real source work |
| Collar numeric test, headless Metal | No equivalent separate numeric run | 9.284 s | All numeric assertions active |
| Collar numeric + explicit PNG review, headless Metal | Required on every run | 10.100 s | Available through explicit capture mode |

These are bounded test observations, not P50/P95 estimates. Throughput, cloud
cost, CPU utilization and peak memory were not measured. The hosted failure
is not directly comparable to the render Mac timings.

## Bottlenecks Addressed

1. The worker test completed an entire second hip/knee solve to test handler
   scheduling and transfers. Its original supersession happened before the first
   solve started. It now observes the unchanged source generator after its first
   computed flexion, awaits a real evaluation while the original request remains
   incomplete, then checks actual `AbortError` supersession and that the source
   generator did not resume. A separate explicitly labeled serialization fixture
   checks the returned surface, hip/knee order, rows, slots and transferred buffers.
   Full source geometry, projection, yield-count and cache assertions remain in
   `tests/hipFold.test.ts`; full default solver quality remains in
   `tests/foldQuality.test.ts`.
2. The collar diagnostic read GPU pixels successfully but blocked on mandatory
   element screenshots in all three failing hosted jobs. Node 26 reached the
   300 s test timeout; Node 24's screenshot log waited for element stability.
   PNG capture is now opt-in through `--mode collar-capture`. Both modes retain
   every pixel-contribution, GL-error, camera, dual-bone, atlas-isolation and
   sampler-budget assertion. No error is caught or suppressed in capture mode.

## Verification

- Removing only the worker handler's post-yield `superseded()` call produced
  RED: a completed `folds` response instead of the required `AbortError`
  (remote job `render-3e8d9fcc7e9e4ace9c1db5704e7f1c58`). The source file was
  then restored byte-for-byte.
- Forcing the collar normal map to remain enabled in every ablation produced
  RED in ordinary numeric mode: `pore-normal contribution: expected 0 to be
  greater than 0` (remote job `render-19d00ece95ed4c2baa0ccbe1ef012545`). The
  test was restored exactly before its final run.
- Capture mode passed with five actual Canvas screenshots, using the same main
  camera as readback (remote job `render-2fa37e1494f44a988da495480e6e572f`).
- Focused instrumented worker assertions passed. Their command exit remained
  red because a single test file cannot satisfy whole-library coverage.
  `heavy-slot` does not forward the caller's `VITEST_COVERAGE_SHARD` variable;
  these runs are timing diagnostics, not complete coverage-gate evidence.
  Canonical CI retains the existing explicit shard environment and merged
  coverage thresholds.

The images and full phase logs are retained under `.heavy-slot/remote-artifacts/`
for the listed jobs in the isolated checkout. Screenshots are diagnostic
artifacts; numerical feature assertions remain the acceptance gate.

## Recommendations

- Immediate: run the unchanged required CI chain on the integrated commit.
- Next sprint: compare hosted shard timing after this repair with the failing run.
- Long term: collect repeated timings before claiming percentile or cost gains.

For a fresh review capture, run:

```sh
heavy-slot --render-host 192.168.1.201 pnpm exec vitest run \
  --project browser tests/browser/collarSurfaceIsolation.test.tsx \
  --mode collar-capture
```

The five PNGs are returned under the remote job's
`test-results/collar-surface-isolation/` directory. Ordinary browser runs omit
these diagnostic PNGs without omitting any test or assertion.
