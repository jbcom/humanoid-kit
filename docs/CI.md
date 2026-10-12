# Continuous integration topology

`pnpm verify` remains the complete local gate: lint, documentation lint,
typecheck, coverage, build and package checks. The hosted workflow separates
coverage from the Node support matrix so that it proves the same thing once
instead of timing out while proving it three times.

## Required gates

- **Node 24 and 26** each install from the lockfile, run lint and documentation
  lint, typecheck, the complete uninstrumented Vitest suite (unit, browser and
  bake), build and package validation. This keeps source, runtime and published
  package proof on both supported Node releases.
- **Coverage shards 1/3, 2/3 and 3/3** run the unit and browser projects with
  V8 coverage. Vitest shards test *files*, and every shard writes a labelled
  blob artifact. A partial shard cannot meet suite-wide coverage by itself, so
  it deliberately defers threshold evaluation to the required merge job.
- **Coverage merge and threshold gate** downloads every named artifact
  separately. A failed shard or a missing artifact stops this job. It merges the
  blobs under the unchanged thresholds in `vitest.config.ts` (90% lines,
  functions and statements; 85% branches), emits `coverage/lcov.info`, and
  uploads that exact file.
- **SonarCloud** depends on the merged-LCOV gate and scans that artifact; it no
  longer starts a second coverage run.
- Docs, end-to-end, Lighthouse and pre-commit remain independent required
  checks. The final `CI / gate` requires Node validation, the merged coverage
  gate, and every applicable check to succeed.

## Why the split exists

Before this topology, Node 24, Node 26 and Sonar each ran `pnpm coverage`.
Sonar's 15-minute job expired during the coverage command before its scanner
started, while the two Node jobs also reached their 20-minute limit. The new
flow retains the same coverage thresholds and test projects but distributes the
instrumented unit/browser work across three required jobs. Bake remains part of
the complete uninstrumented Vitest validation on both supported Node versions.
No timeout, assertion or coverage threshold was raised or relaxed.
