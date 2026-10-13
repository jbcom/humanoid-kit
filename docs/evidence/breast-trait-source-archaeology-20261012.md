# Breast-trait source archaeology — 2026-10-12

**Status:** read-only design and provenance assessment. This document does not
approve a mesh, asset, numeric range, UI control, recipe schema, or release.
It records why issue-27's private foundation witness is not an acceptable
independent chest implementation and defines the smallest evidence-bearing next
lab contract.

## Scope and repository state

The canonical checked-out line at the time of review is `origin/main` at
`12d367092dd2217abca3547c251b4085da5bbe18`. Its body data is the CC0 MakeHuman
hm08 asset set: 19,158 vertices, one topology and one rig. The body manifest
records upstream commit `a8bc2d54ff0ac92e78ff71431b1023eda42bf482` and its
provenance file records the body binary hash
`33e8502236f56d532abbaa2d0adbffb28af56a3f5313763feb9881c9ede668df`.

Two related lines are not in canonical `main`:

| Line | State | Relevance |
| --- | --- | --- |
| `codex/issue-27-breast-contract-20261012` (`2519745`) | descendant of `main`; not merged | carries the private issue-27 design and witness script under review. |
| `b3c7c41` (`feat(adult): transfer the male form from breast_fix and Heal1 sculpts`) | not an ancestor of `main` | contains work on adult male anatomy sources. It is not evidence for breast-trait independence, and must not be silently incorporated into this work. |

This distinction matters. A source checked out in an old or side branch is not
part of the shipped pack merely because its name contains `breast`.

## What the canonical MakeHuman source can actually do

### Macro family

`src/makehuman/macro.ts#macroTargetWeights` builds macro chest contributions
only under `breast/female-*`, then multiplies every contribution by
`1 - gender`. At the masculine endpoint (`gender: 1`) both `breastSize` and
`breastFirmness` have exactly zero geometric effect. At mixed values the same
female-source deltas are merely attenuated. This is a source-frame gate, not
independent chest authoring.

The packed body manifest has 228 `breast/*` targets:

| Family | Count | What it establishes |
| --- | ---: | --- |
| `female-child-*` macro deltas | 72 | female-reference deltas around the child anchor |
| `female-young-*` macro deltas | 72 | female-reference deltas around the young/adult anchor |
| `female-old-*` macro deltas | 72 | female-reference deltas around the old anchor |
| local modifier targets | 12 | six paired fine-shape controls |

For every age anchor, muscle anchor and weight anchor, the source omits the
`averagecup-averagefirmness` target: 27 missing combinations in total. That
combination is embedded in the upstream female reference body, rather than
being a transferable delta. No male-anchor counterpart is packed. Therefore:

- removing the `1 - gender` multiplier would apply a female-reference delta to
  a different base chest without a verified tissue baseline;
- an interpolation of that delta is not a mixed-frame tissue model;
- the source does not contain a frame-independent zero, average, size, or
  firmness basis.

The six paired modifiers are `breast-trans`, `breast-dist`, `breast-point`,
`breast-volume-vert`, `nipple-size`, and `nipple-point`. They are useful local
adjustments after a coherent chest exists. They do not supply a tissue
foundation, a breadth/projection basis, or an independent firmness response.

### Policy inconsistency that must be resolved before implementation

The repository's `AGENTS.md` says that under-18 breast size/firmness, regional
values and fine breast controls are rejected. The canonical source does not do
that: the current `agePolicyViolations` checks only adult-pack modifiers, while
`macroTargetWeights` deliberately evaluates the upstream child, young and old
female-source macro targets. The current body manifest also marks all six fine
breast/nipple modifiers `adultOnly: false`. The current test suite documents
the macro behaviour as "breast development follows MakeHuman."

Commit `106f52d` briefly made those six modifiers adult-only. It is in the
history of canonical `main`, but the later `c0c6ae2` return to MakeHuman age
handling removed that chest-specific gate. The current source and manifest,
rather than either historical commit message, are the evidence of runtime
behaviour.

The owner has already approved bounded **adult young-anchor lab authoring**.
This documentation/runtime conflict does not block that authorized private lab
or ordinary source archaeology. It must be reconciled before any public recipe
schema, public control, or non-lab age behaviour is accepted. The new layer
cannot inherit an ambiguous policy by accident.

### Surface and adult packs do not fill the geometry gap

The current body source has an areola colour/relief layer and the nipple
modifiers above. Those are surface or local-shape facilities, not a validated
chest-volume foundation. The canonical adult-anatomy manifest contains adult
genital, bulge and pregnancy targets; it does not contain a chest trait family.
Its MakeHuman asset inputs have CC0 provenance. The unmerged `b3c7c41` adult
source work likewise cannot be treated as a chest foundation without a separate
topology, provenance and deformation review.

## Why the private issue-27 witness is rejected

The witness at
`scripts/research/issue27-breast-foundation-witness.ts` is provenance-aware but
not independent reconstruction:

1. For the feminine frame it defines `neutral = baseline - field` and then
   `foundation = neutral + field`. The foundation is consequently the original
   baseline again (the recorded direct comparison reaches roughly `7e-9 m`),
   not a separately authored target.
2. For the masculine frame it adds a fixed analytic forward field to the
   existing pectoral/ribcage baseline. It provides neither an independently
   authored average tissue state nor separate size and firmness fields.
3. It implements two hard-coded amplitudes, no mixed-frame construction, no
   age-anchor family, no side-specific trait, and no clothing or motion proof.
4. `normalContinuity` rejects collapsed or orientation-reversed quads by
   comparing each candidate face normal with its baseline normal. It is useful
   for basic mesh validity but does **not** prove C1 continuity across the
   compact-support boundary. A zero displacement at selected vertices does not
   prove a continuous first derivative through adjacent rings.

Its procedural output is labelled CC0 and it correctly avoids reading or
reweighting the `breast/female-*` targets. Those are good provenance controls.
They do not make a round trip or a compact analytic bump an anatomically
credible independent tissue family.

## Provenance and licensing boundary

| Material | Current status | Allowed role |
| --- | --- | --- |
| MakeHuman hm08 mesh, rig, skin weights and packed targets at the recorded upstream commit | CC0 evidence is recorded per source category in `packs/body/data/PROVENANCE.md` | canonical topology and legacy-reference material |
| Existing `breast/female-*` targets | CC0 MakeHuman asset data | legacy behaviour and landmark comparison only; never male/mixed output by reweighting or copying |
| Existing fine `breast/*` modifiers | CC0 MakeHuman asset data | legacy local adjustment; canonical source currently does not age-gate it |
| Issue-27 procedural witness | generated private study with a CC0 header | diagnostic only; not a shipped target family |
| NIH CC BY 4.0 reference overlay observed in the issue-27 work | not CC0 | may inform a private reference review if attribution terms are met; cannot enter the CC0-only pack pipeline or be promoted as a pack asset |
| Unmerged adult source assets from `b3c7c41` | branch-local provenance requires its own review | out of scope for this chest contract |

The packer requires source-file CC0 evidence. Any future authored target must
have a source-side CC0 dedication, exact input/output hashes, tool/version
recording, matching hm08 vertex order, and a sparse-delta export that preserves
topology, UVs, skin weights, skeleton and untouched frame landmarks.

## Bounded next lab contract

Do not change `macroTargetWeights`, reinterpret saved macro values, or promote
the current witness. The owner's approval authorizes this **private adult
young-anchor specimen** on the existing hm08 topology now; no additional policy
question is needed for that bounded lab. It should have only the following
independently authored sparse deltas:

| Frame anchor | Deltas required | Purpose |
| --- | --- | --- |
| feminine frame | neutral-to-average, low-size, high-size, low-firmness, high-firmness | establishes tissue from that frame's own neutral chest |
| masculine frame | neutral-to-average, low-size, high-size, low-firmness, high-firmness | proves the same trait exists without female-source reuse |

The mixed frame may interpolate the two **new** frame-local deltas. It must not
scale either endpoint to zero or use `gender` as a gate. Size and firmness are
separate target families; neither is a scalar multiple of the other. The lab
may show the legacy macro path beside the specimen, but it must label it as a
legacy reference rather than a target source.

The specimen is not a public control and has no approved numeric range. It must
remain private until all of these gates pass:

1. **Source gate:** emitted targets are sparse deltas from separately authored
   feminine and masculine neutral chests, with the license and exact source/
   export hashes above. No external non-CC0 mesh, texture, or data is packed.
2. **Static geometry gate:** at the young adult anchor, evaluate feminine,
   masculine and mixed frames at at least two body-composition contexts. Each
   explicit size and firmness case is finite and nonzero, and a frame change
   does not erase either response.
3. **Boundary gate:** the candidate explicitly declares a perimeter and a
   protected-frame set (sternum, clavicle, shoulder, axilla, back and arm
   attachment vertices). It proves zero displacement at the protected set and
   records area/orientation plus a discrete first-derivative or one-ring normal
   continuity measurement across the support boundary. Baseline-versus-candidate
   face-normal agreement alone is insufficient.
4. **Independence gate:** size and firmness have distinguishable displacement
   fields; optional one-side experiments prove the opposite side and centreline
   remain isolated within a predeclared tolerance.
5. **Compatibility gate:** legacy recipes with no new trait are byte-for-byte
   equivalent in contributions and control positions. Missing specimen data is
   an explicit unavailable/pending state, never a silent fallback to the old
   female-source multiplier.
6. **Visual gate:** a lab provides front, back, both three-quarter, profile,
   raised-arm, twist, seated-bend and clothing-overlay views for the full frame
   matrix. Root visual review, rather than a montage or a metric, determines
   whether the authored shapes are acceptable.

Only after this young-anchor specimen passes should the project author age
anchors and a public recipe contract. Numeric ranges, public schema, public UI
and migration of legacy regional macros remain separate acceptance decisions;
none is solved by the existing MakeHuman controls or by stale `AGENTS.md` text.

## Evidence inspected

- `src/makehuman/macro.ts` — female-only macro weighting and omitted upstream
  average reference.
- `src/recipe/agePolicy.ts`, `packs/body/data/manifest.json`, and commits
  `106f52d` / `c0c6ae2` — canonical source has no chest-specific age gate;
  the latter supersedes the former's short-lived gate.
- `packs/body/data/manifest.json` and `packs/body/data/PROVENANCE.md` — target
  inventory, topology, hashes and CC0 source evidence.
- `packs/adult-anatomy/data/manifest.json` — no independent chest trait family.
- `docs/research/BREAST-INDEPENDENCE-DESIGN.md` and the private witness script —
  proposed direction and the rejected round-trip construction.
- commit `b3c7c41` and its tree — unrelated, unmerged adult source work.
