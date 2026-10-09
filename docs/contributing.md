---
title: Contributing
description: Set up humanoid-kit, validate a change and contribute through the protected workflow.
---

## Local workflow

```sh
mise install
pnpm install --frozen-lockfile
pnpm verify
pnpm docs:build
```

`pnpm verify` is the library gate: Biome, Markdown linting, strict TypeScript,
the unit suite with coverage thresholds on the pure core, the build, package
validation (`publint`, Are The Types Wrong) and a clean-consumer check that
installs the packed tarball into an empty project. `pnpm docs:build` validates
and renders the Sourcey site. `pnpm test:e2e` runs the Playwright suite against
the playground; install the browser once with
`pnpm exec playwright install chromium`.

Branch from `main`, make a focused Conventional Commit, open a pull request, and
keep the branch current by merging `main` into it when necessary. The protected
path uses automated checks rather than a routine human approval; merge commits
preserve the constituent history. Do not hand-edit versions or `CHANGELOG.md`:
Release Please owns them.

Read the repository [contribution guide](https://github.com/jbcom/humanoid-kit/blob/main/CONTRIBUTING.md)
and [agent instructions](https://github.com/jbcom/humanoid-kit/blob/main/AGENTS.md)
before changing public APIs.
