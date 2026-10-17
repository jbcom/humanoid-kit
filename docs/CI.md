# Continuous integration topology

`pnpm verify` remains the complete local gate: lint, documentation lint,
typecheck, coverage, build and package checks. The hosted workflow separates
coverage from the Node support matrix so that it proves the same thing once
instead of timing out while proving it three times.

The `CI` workflow runs for pull requests and for pushes to both `integration`
and `main`. Only a normal milestone merge may advance `main`; Pages and release
automation remain tied to that branch.

## Required gates

- **Node 24 and 26** each install from the lockfile. On each Node, one static job
  runs lint, documentation lint, typecheck, build and package validation, and
  four unit jobs run the unit project in Vitest file shards (`--shard=N/4`).
  Every shard is required, so together they run every unit file exactly once.
  Bake has its own uninstrumented job on both Nodes. Browser validation has six
  software-rendered jobs per Node; Vitest assigns every browser test file to
  exactly one shard. The **Metal lane** has its own required standard `macos-15`
  job on both Nodes, which first rejects a non-Metal renderer. It runs the browser
  files SwiftShader cannot finish within the job ceiling:
  - `affordanceGpu` (hardware readback);
  - `coatPlacement` (every authored facial asset's jaw matrix: 827 s on a hosted
    SwiftShader shard);
  - `creatorHosting` (the creator's hosting flows: every click waits out
    software frames, and one test reached 130 s against its 120 s budget).

  This keeps every source, runtime and published-package check on both
  supported releases.
- **Coverage unit shards 1/6 through 6/6**, **coverage browser shards 1/6
  through 6/6**, and the required **browser Metal lane** coverage job run their
  projects with V8 coverage. The software shards exclude exactly the Metal lane's
  files; the Metal coverage job runs those files and uploads their blob.
  `tests/ciGate.test.ts` checks that the two lists are the same, and that every
  sharded job runs shards 1 to N of the N it names. Every job writes a labelled blob artifact and the
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
  checks. The end-to-end suite runs on the standard `macos-15` runner's Metal
  at the GPU budgets, and its skip ledger runs as the GPU lane, so a GPU-lane
  skip fails it. Under hosted SwiftShader it was cancelled at 45 minutes on
  every run. On the `.202` Metal render host the whole suite finishes in
  2.8 minutes. The final `CI / gate` requires Node validation, the merged coverage
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

By 2026-10-16 the integration line had outgrown that split. Integration had not
had a green CI run since. These were the measurements:

- the uninstrumented unit project took 1021 seconds on one hosted runner
  (`selfContact.test.ts` alone took 413 seconds), and Node 24 hit the 20-minute
  ceiling;
- two of the three instrumented unit shards hit it as well;
- the browser shard holding `coatPlacement.test.tsx` was cancelled after 827
  seconds in that one file.

The unit project therefore runs as four shards per Node, coverage as six, and
the Metal lane takes the browser files that need a GPU's frame rate. Per-test
timeouts and assertions are unchanged. The Metal job ceiling rose from 10 to 20
minutes because the job now runs three files instead of one, and it stays the
same ceiling as every other job.

## Standard macOS Metal evidence

The 2026-10-11 capability probe on the free standard `macos-15` runner recorded
`ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)`
and ran all five `affordanceGpu.test.tsx` checks in 49.793 seconds (56.72 seconds
for the Vitest process). The required jobs repeat the renderer assertion; they do
not infer GPU availability from the runner label. The paid larger macOS runners
are not used.

## Hair fixture timing evidence

The 2026-10-12 coverage-unit failure was a real V8 instrumentation cost, not a
weakened assertion: the independent braids and twists builds took 19.777 and
16.065 seconds, respectively, against the unchanged 10-second hook budget.
The settlement loop performed nearest-body queries for every projection and
friction sample, allocating a result and three vectors at each query. Its
caller-owned probe result and bounded friction query retain the 60 settlement
passes, four projection passes, physical thresholds and mesh determinism
checks. On the `.201` remote test host, the focused V8 run completed all 36
hair checks; the independent braids rebuild took 9.998 seconds and twists took
8.143 seconds. A one-file coverage run still fails the repository-wide
aggregate threshold by design; the required merged coverage job remains the
coverage verdict.
