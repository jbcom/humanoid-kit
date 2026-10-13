# Continuous Work Directive — humanoid-kit

**Status:** ACTIVE
**Owner:** Claude (owner ruling 2026-10-12: Claude owns humanoid-kit to completion; Codex is halted)
**Mandate:** "make sure your directives reflect the full and true scope of work" (2026-10-13). The queue below is the whole scope; GitHub issues carry the detail and the evidence. Where an item and its issue disagree, the issue is current.

## What CONTINUOUS means

Work continuously. A finished item is the cue to start the next one in the same turn. Do not stop for status, scope, summaries, context pressure or size. The only stops are an owner halt, red CI that is yours to fix, or one of the true blockers in `~/.claude/CLAUDE.md` (credentials, a purchase, hardware, remote state you triggered).

## Standing rulings (docs/DECISIONS.md, never re-argued)

1. One human model. `gender` is only a skeletal-frame blend and never gates or multiplies another trait.
2. Assets first (graft CC0 and MakeHuman data), procedural last.
3. MakeHuman parity is the contract. The kit adds no restriction or clamp of its own.
4. Age line: follow MakeHuman at every age 1–90. Only the adult anatomy pack and pubic hair density are gated at 18.
5. Adult interaction is all-adult with explicit consent, with region-distinct channels derived from actual anatomy.
6. Judge by intent and by what MakeHuman already adjudicated.

## How this repo works

- The shared line is the LOCAL `integration` branch. Lanes land through `hk-integrate` (merges integration into the lane, typecheck and Biome, compare-and-swap). It has no `--help`: running it lands. `gh pr create` and CI are blocked from lanes. Publishing `integration` is #69 and waits on the owner and on #22.
- Heavy work goes to the Mac pool through `heavy-slot` (`--remote-test`, `--remote-render`, `--remote-run`), hosts `.201` and `.202`. Pin to the host with free slots. Sheets run through the Playwright `sheets` project from a clean detached worktree. Never run a heavy job locally.
- **Visual bar is extreme** ("every follicle of hair, every fold"). Root reads every render itself before a lane is accepted. The image viewer caches by path, so copy PNGs to a new filename before each Read.
- **Orchestration:** every lane agent posts a progress comment on its issue at least every 30 minutes, and the idle watchdog flags any lane with no commit or file change for 5 minutes. An idle lane is an orchestration defect: nudge it the same minute. Hand a lab to the owner only after root has verified that it shows what it promises.
- Gates: a new gate is watched failing before it counts (inject the defect, see red, restore, see green).

## Queue — humanoid-kit to completion

### A. Lanes in flight (agent, branch, acceptance)

- [x] A0 #13 Period garments landed on integration (466949c): hats over hair, layering contract, wear/dust/colour looks, boots-through-jeans, toenail mask. Remainder is #88.
- [ ] A1 #14 Facial hair layer (agent aab735df, `feat/facial-hair`): moustaches and beards incl. very large beards, CC0 hair pieces, drape in the #71 forward fold; sheets read by root.
- [ ] A2 #21 Explicit regional body hair (agent ac0a7235, `fix/body-hair-render`): diagnose why hair renders pale without strands, then make armpit, pubic, arm, leg and chest hair visible and gender-free; check #68 first.
- [ ] A3 #22 Female anatomy gate (agent a655e4b4, `fix/female-anatomy-gate`): source-to-pack reproducibility, NIH CC-BY attribution, permutation matrix over builds/skins/sizes, underside and oblique views; spawns #75–#83.
- [ ] A4 #25 Paired hand contact (agent abd5b3e7, `feat/paired-hand-contact`): rig constraints, inspected alignment proof, ARCHITECTURE.md contract.
- [ ] A5 #27 Chest tissue productisation (agent a614e6dc, `claude/independent-chest-foundation-20261012`): finish age-table regeneration (18≠25), docs → tests → code, remove the `(1-gender)` breast coupling, legacy-identity gate, body-lab sheets.
- [ ] A6 #67 Overhead pose shoulder chain (agent a9333e85, `fix/overhead-shoulder-skin`): fix the tear and smeared upper arms; include forward fold at rest.
- [x] A7 #72 Four unit failures on integration: kneeFold, nailPlates and browserArrayComparison fixed at the root (73bb2039, 5c696f48, 4128a86d); the fourth is E13 (#94).
- [ ] A8 #86 Adult age surface (agent aa1eb596, `feat/age-surface`): forehead banding, faint hands at 70; wrinkles that read as skin.
- [ ] A9 #15 Period animation clips: musket drill and fire, kneel-and-pray, march cadence, colour-bearer (lane `feat/period-clips-qa`). Packed and on integration; the lane renders each clip on three bodies, reads every sheet, fixes defects and asserts contact geometry.
- [ ] A10 #84 Two e2e specs red on integration (lane `fix/e2e-presence-permutations`); same item as E1.
- [ ] A11 #68 and #79 hairFields BVH index and braids01 reproducibility (lane `fix/hairfields-bvh-index`); same items as C9 and B11.
- [ ] A12 #32 Observer lifecycle (lane `feat/observer-lifecycle`), #41 age gate (lane `fix/age-gate-fail-closed`), docs reconcile (lane `docs/scope-reconcile`); same items as D1, C8, F2–F8.

### B. QA pose and anatomy validation (owner request 2026-10-13)

- [ ] B1 #71 Forward-fold set (hands to toes), front and rear: glute and leg tension, spread cleft with closed and dilated posterior opening, sag, breast droop, musculature; female, male and intersex scatters; hair drape for armpit, pubic, facial and head hair from CC0 pieces.
- [ ] B2 #73 Lithotomy pose: male, female and intersex configurations, inner canals (urethra, vagina, anus), arousal state, moisture, penetration assessment.
- [ ] B3 #75 Sculpted clitoral hood and glans in place of the drawn key.
- [ ] B4 #76 Labioscrotal root flange and stretched texture.
- [ ] B5 #77 Pale wall in canal openings at rest (vestibule shard, anal bead).
- [ ] B6 #78 Vulva rim stepped edges, shading seam, pale fin on other bodies.
- [ ] B7 #80 Canal aperture state control, closed to dilated.
- [ ] B8 #81 Urethral channel in the adult anatomy pack.
- [ ] B9 #82 Regional moisture material response and vulva state response.
- [ ] B10 #83 Neutral capsule contact test for canal deformation.
- [ ] B11 #79 Hair pack braids01 regenerates from source.

### C. Body, age, surface and parity

- [ ] C1 #74 Body-wide corner combinations fold the torso and thin the limbs.
- [ ] C2 #85 Whole ethnic simplex in playground default walkers, age montage, hair and body sheets.
- [ ] C3 #48 Per-UV fields and region constants assume base-adult geometry.
- [ ] C4 #55 Pin macro-grid growth, continuous anatomy presence and undrawn adult geometry.
- [ ] C5 #58 Pack MakeHuman's body pose units and verify the expression library.
- [ ] C6 #59 Proxy meshes, teeth shapes, face and ear targets, community hair, brow and lash evaluation (asset-first program).
- [ ] C7 #60 Policy-drift cleanups (editor age checks, adult-only id source of truth).
- [ ] C8 #41 Age-gate edges fail closed and tested (NaN ages, affordance default, pack paths).
- [ ] C9 #68 hairFields: card BVH faceIndex read as quad order after MeshBVH reorders the index.
- [ ] C10 #88 Garments: hem and knee soiling that varies over the garment, wrinkle detail.
- [ ] C11 #64 `feat/upscale` KTX2 clothing experiment as its own lane.

### D. Interaction and animation

- [ ] D1 #32 Animation-frame observer lifecycle for interaction consumers, defined and proven.
- [ ] D2 #33 Persistent regional injury state and neutral renderer hooks.
- [ ] D3 #45 Assert contact geometry for interactions and animation, not only sequencing.
- [ ] D4 #89 Room and N-party proof: twenty distinct figures interacting in one scene.

### E. Gates, tests, CI and tooling

- [ ] E1 #84 Two e2e specs fail on integration (presence canvas, permutations).
- [ ] E2 #40 Foundation smoke gate ratchets against known-failing posed rows.
- [ ] E3 #44 Negative controls and a mutation check for tuned-geometry gates.
- [ ] E4 #42 Absolute-metre tolerances tuned on one figure scale.
- [ ] E5 #43 Compare evidence images with current renders and record verdicts.
- [ ] E6 #46 Stress set and fixed pose-camera grid in the review battery.
- [ ] E7 #47 Widen the coverage gate and account for environment-dependent skips.
- [ ] E8 #92 Standing scatter and pose-battery cadence on every landing (one command, sheets plus verdict).
- [ ] E9 #39 Required CI gate is red from timeouts and no check is required.
- [ ] E10 #65 heavy-slot remote-run on the third pool host exits 125.
- [ ] E11 #87 Measure `scheduler.yield` in `yieldWorkerTask` before adopting it.
- [ ] E12 #93 Lane liveness counts pool leases and issue comments, not only worktree changes; the watchdog prints state changes.
- [ ] E13 #94 contactCompression: land the hip-crease unit with its gate or narrow the test (lane `fix/contact-compression`, reads the dirty `humanoid-kit-fold` worktree read-only).

### F. Documentation and decisions

- [ ] F1 #38 Canonical branch and release path decision.
- [ ] F2 #49 Length-constant classes; rename the head-width normaliser.
- [x] F3 #50 README, llms.txt and introduction describe shipped features as unimplemented.
- [x] F4 #51 Reconcile package and modifier counts; NOTICE for eyes and animations packs.
- [ ] F5 #52 Invariants and age-policy wording match the code. Items 1, 3, 4 done; item 2 (invariant 1 versus the adult refined surface) waits on the owner (`needs-decision`).
- [ ] F6 #53 Record maintainer rulings and land research docs. Decision log, research docs and the adult-defaults semantic (ruling 7) are in; waits on the owner for the lab-authoring versus public-schema ruling and for confirming ruling 7's wording (`needs-decision`).
- [ ] F7 #54 Track or drop untracked roadmap items; settle adult animation package scope.
- [ ] F8 #56 Minor docs cleanups.
- [ ] F9 #91 Whole-project assessment report (shipped, proven, unproven, owned), regenerated per milestone.

### G. Publication (owner-gated)

- [ ] G1 #69 Publish `integration` to `origin/integration`, never `main`. Neutrality scan is clean; waits on the owner's yes and on G2.
- [ ] G2 #22 licence and provenance audit of the adult pack (CC-BY NIH-derived data) before any public push.

### H. Hygiene

- [ ] H1 #90 Retire the remaining registered Codex worktrees and old local branches (classify, land valuable work, snapshot, remove without force).
- [ ] H2 Keep `git worktree list` equal to the main checkout plus live lanes; each landed lane's worktree and branch are removed in the landing turn.

## Operating loop

while the queue has `[ ]` items: pick the items with no open dependency, hand each to its own lane (worktree, agent, issue, acceptance), keep every lane inside the 5-minute idle rule, read the renders myself, land through `hk-integrate`, close the issue with evidence, flip `[x]` in the landing commit, start the next.

## Self-assessment

At every landing: backward sweep (what shipped, which docs and tests moved with it, which gaps it exposed → file an issue and add the line here) and forward sweep (is the next item still the right one; does a decision belong in docs/DECISIONS.md). New findings go into this queue in the same turn.
