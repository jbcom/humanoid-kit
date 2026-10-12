# Continuous integration topology

`pnpm verify` remains the complete local gate: lint, documentation lint,
typecheck, coverage, build and package checks. The hosted workflow separates
coverage from the Node support matrix so that it proves the same thing once
instead of timing out while proving it three times.

## Required gates

- **Node 24 and 26** each install from the lockfile, run lint and documentation
  lint, typecheck, unit tests, build and package validation. Bake has its own
  uninstrumented job on both Nodes. Browser validation has six software-rendered
  jobs per Node; Vitest assigns every browser test file to exactly one shard.
  The GPU affordance readback has its own required standard `macos-15` Metal job
  on both Nodes, after it rejects a non-Metal renderer. This keeps every source,
  runtime and published-package check on both supported releases without asking
  SwiftShader to complete hardware readback work.
- **Coverage unit shards 1/3 through 3/3**, **coverage browser shards 1/6
  through 6/6**, and the required **GPU affordance Metal** job run their projects
  with V8 coverage. The software shards exclude only
  `tests/browser/affordanceGpu.test.tsx`; the required Metal job runs that exact
  file and uploads its blob. Every job writes a labelled blob artifact and the
  normal terminal reporter, so a failed test retains its witness in the job log.
  A partial shard cannot meet suite-wide coverage by itself, so it deliberately
  defers threshold evaluation to the required merge job.
- **Coverage merge and threshold gate** downloads every named artifact
  separately. A failed shard or a missing artifact stops this job. V8 stores
  absolute source URLs in each blob, so the merge maps the macOS checkout root
  to its own Ubuntu checkout before Vitest verifies that source files exist. It
  also requires exactly one labelled blob for each unit/browser shard and the
  Metal proof before merging. It then merges the blobs under the unchanged
  thresholds in `vitest.config.ts`
  (90% lines, functions and statements; 85% branches), emits
  `coverage/lcov.info`, and uploads that exact file.
- **SonarCloud** depends on the merged-LCOV gate and scans that artifact; it no
  longer starts a second coverage run.
- Docs, end-to-end, Lighthouse and pre-commit remain independent required
  checks. The final `CI / gate` requires Node validation, the merged coverage
  gate, and every applicable check to succeed.

## Why the split exists

Before this topology, Node 24, Node 26 and Sonar each ran `pnpm coverage`.
Sonar's 15-minute job expired during the coverage command before its scanner
started, while the two Node jobs also reached their 20-minute limit. A current
hosted-run witness measured the uninstrumented unit project at 448 seconds and
`sphereParity.test.ts` at 568 seconds under SwiftShader. The new flow retains
identical test projects and coverage thresholds, but keeps the six browser
shards independent from unit and bake work. Bake remains uninstrumented on both
supported Node versions. No timeout, assertion or coverage threshold was raised
or relaxed.

## Standard macOS Metal evidence

The 2026-10-11 capability probe on the free standard `macos-15` runner recorded
`ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)`
and ran all five `affordanceGpu.test.tsx` checks in 49.793 seconds (56.72 seconds
for the Vitest process). The required jobs repeat the renderer assertion; they do
not infer GPU availability from the runner label. The paid larger macOS runners
are not used.
