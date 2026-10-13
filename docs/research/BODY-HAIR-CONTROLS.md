# Regional body-hair controls

Status: the independent-control contract is accepted as a bounded API fix, but
the renderer is not visually accepted for issue #21. This document records the
compatibility contract before it changes the public recipe.

Candidate worktree: `<worktree>/humanoid-kit-body-hair`, branch
`fix/body-hair-independent-controls`, based on integration
`ed8cd260ad168da5e464704575c048aaf04ff555`. The bounded API milestone is
`a84cb31`; no integration merge has occurred.

## Problem

At integration `ed8cd260ad168da5e464704575c048aaf04ff555`,
`bodyHair.density` is a multiplier on a gender-derived physiological default.
That preserves a useful default when a recipe omits a region, but it also means
that an explicit chest or facial-hair choice cannot work at every gender value:
a zero default remains zero after multiplication. It also combines two distinct
facts under one name: how many follicles grow a terminal hair and how closely
the follicles are spaced. At high baseline coverage, the multiplier clamps at
one, making 1 and 2 almost indistinguishable in the shell coat.

## Contract

The recipe will have three independent regional controls:

| Field | Meaning | Compatibility |
| --- | --- | --- |
| `density[group]` | Legacy multiplier on the physiological default coverage, in `[0, 2]`. | Existing serialized recipes retain their result. It is not renamed or reinterpreted. |
| `coverage[group]` | Explicit mature terminal-hair coverage, in `[0, 1]`. It replaces the gender-derived baseline for that group, while the age maturation and senescence factors still apply. | New optional field. An explicit coverage works at every gender value. |
| `follicleDensity[group]` | Multiplier on the region's physical follicles-per-cm2 value, in `[0.25, 2]`. It changes strand spacing, not coverage. | New optional field; absent is `1`. |

`coverage` and legacy `density` are mutually exclusive for the same group.
This prevents a saved multiplier from silently acquiring a new meaning. Either
may be combined with `follicleDensity`.

An omitted group retains the existing age- and androgen-derived physiological
default. An explicit `coverage` is still subject to maturation and senescence:
it cannot produce terminal hair before the existing age ramp would allow it.
The adult-only pubic group remains unavailable below 18: legacy `density` and
explicit `coverage` may only name zero, and `follicleDensity` may not name the
group. `withAge` removes every one of its regional values on a transition below
18.

## Rendering consequence

The model exposes coverage and follicles-per-cm2 separately. Strand and coat
paths pass coverage to the stochastic occupancy/alpha calculation and physical
follicle density to cell spacing. A visual acceptance run must prove that, at a
fixed coverage, follicle-density `1` and `2` have distinct resolved structure
without becoming a continuous dark mask. It must also inspect coverage values
below the historical `.85`/`.95` saturation range.

No shader or material adjustment belongs in this change unless that isolated
response matrix shows that separate values arrive at the renderer and still
collapse. The next visual gate is a root-reviewed close-up plus whole-body
matrix at fixed tone and lighting, across coverage `.1`, `.25`, `.5`, `.75`,
`.85`, `.95`, `1` and follicle density `1`/`2`, followed by a cross-gender
explicit-coverage check. This branch does not claim that acceptance.

The root-run, silent test artifact is
`e2e/sheets/body-hair-response.sheet.ts`. It writes only to its Playwright test
output and optional `HK_BODY_HAIR_RESPONSE_OUT`, never to the historical
coverage baseline directory. It tests the exact response matrix above, female
and male endpoints with matching explicit face/chest/axillary/pubic coverage,
and tall/short whole-figure cameras sized to each endpoint. Before capture,
every cell asserts adult age, an adult surface with triangles, no garment, and
a non-empty `coatPaintFor` response. Its fixed neutral tone mapping, exposure,
mid skin tone and brown hair make the cells comparable. This is the visual gate
for [GitHub issue #21](https://github.com/jbcom/humanoid-kit/issues/21): root
decides from it whether a renderer change is warranted.

The sheet's Node fixture imports the coat assertion from the documented pure
ESM path `src/surface/coatPaint.ts`, never from `src/react/CoatMesh.tsx`.
This prevents its Node process from traversing React Three Fiber's package
root, whose CommonJS `main` can load `three.cjs` outside Vite's ESM resolver
and emit `THREE_CJS_DEPRECATED`. This is a dependency-boundary change, not a
warning suppression.

## Root visual result and renderer probe

Root personally reviewed all four sheets from response job 5222. Explicit
female face coverage creates visible strands, proving the independent-control
semantics work. The visual result is **not accepted**: chest and axillary hair
remain barely legible, the pelvis reads as a broad opaque-looking dark mask at
coverage `.1` with only modest density variation, and full-body hair is nearly
absent. The tailored tall/short cameras improved those figures, although hand
tips and the title still crop.

`tests/coatResponseProbe.test.ts` is an isolated no-WebGL probe for the next
renderer decision. It proves all 14 coverage/density pairs enter the actual
`CoatMaterial` uniform rows. The adult render surface has non-empty masks for
face 5,950 vertices (mean mask `.03823`, 36,900 painted index entries), chest
5,057 (`.02427`, 30,798), axillary 2,262 (`.00367`, 14,112), and pubic 9,842
(`.10945`, 59,874). Therefore the pubic mask really is materially broader than
the other requested groups, although that fact alone does not explain an
opaque-looking result at explicit coverage `.1`.

The same probe exposes the physical explanation for the weak density response:
chest's normalized radius is `.04925` at density 1 and `.06965` at density 2,
both clamped to the shader minimum `.08`. Axillary changes `.10457` to
`.14789`; pubic changes `.09487` to `.13416`. At a normal view the current alpha
equation predicts only about `.00283` total pubic alpha at coverage `.1`, so the
opaque-looking pelvis cannot be explained by the intended normal-view shell
accumulation alone. The next change must diagnose actual compiled-fragment
alpha/blending and projected footprint before altering radius, shells, masks,
lighting or thresholds.

There is also a distinct, confirmed **placement** fault. `adultCoat.ts` measures
`hair-pubic` on the base-mesh mons, but `HumanoidModel.coatOn` had carried that
field through the adult surface's complete stencil. Reservoir rings copy their
root stencil rows. An isolated reconstruction of the shipped adult surface
found full pubic-mask inheritance on every reservoir-copy vertex: `phallic`
1,472 of 1,472 nonzero (minimum `.999999`, mean `1.000000`), and
`labioscrotal` 1,792 of 1,792 (minimum `.997780`, mean `.999800`). Those
reservoirs draw phallic shaft/glans and genital/canal surfaces, which are not
the base-mesh mons. The broad result is therefore not solely a shell-alpha
question.

The bounded mapping now keeps `hair-pubic` on the original body surface,
including the authored mons/perineal area, and removes it from copied reservoir
walls and cap vertices. It touches only that region's mask channel: other coat
groups and any explicit fur regions retain their own fields. This is a
topology-placement rule, not a gender lock or a ban on adult hair. A refined
surface regression constructs the shipped reservoirs and proves both that mons
coverage remains and that every wall/cap render vertex has zero pubic mask.
On the resulting refined surface, the requested pubic region has 5,957 masked
vertices, mean mask `.05101`, and 37,386 painted indices. The earlier 9,842 /
`.10945` / 59,874 measurement is retained above as the pre-correction witness;
it included copied reservoir walls and caps.

Whether and where outer scrotal or labial surfaces should carry hair is
intentionally deferred. It requires a separately authored regional mask and a
placement decision; it must not be obtained by allowing the mons stencil to
coat every copied reservoir surface. Root screenshot review remains the next
acceptance gate for this mapping, and no shader/radius tuning is included here.

## Root-run runtime capture

The response sheet now opens each existing response camera with `coatprobe=1`.
That query is QA-only. It asks the live `CoatMaterial` to compile under a
separate `|qa-alpha` program key and records, beside each PNG, a
`*.runtime.json` artifact. It does not alter a normal material, its normal
program key, or its fragment path.

Each runtime record is a fresh observation of the rendered response cell:

- material transparency, depth-write/test, one-pass and blend fields;
- live coat geometry index/instance counts and effective shell uniform;
- every live coat row's coverage and physical follicle-density values, checked
  against the recipe's pure paint table;
- a captured patched fragment alpha section containing `hkBases`, `hkSides`,
  `hkFar` and `diffuseColor.a = hkCover`, plus whether that program is live in
  Three's renderer;
- camera-facing cosine distributions for every coat region, including the
  count whose raw cosine reaches the shader's `.2` clamp.

The angle readback applies the current skinned surface and current camera, then
names its limit as `skinned-normal-no-dual-correction`; it does not pretend to
duplicate the shader's dual-quaternion branch. It is sufficient to show whether
the response camera's actual angles make `hkSides` materially different from
the normal-view calculation. A visual or renderer change still needs a new
root-inspected sheet and this JSON evidence; neither changes lighting or a
visual threshold.

Root inspected the post-placement capture
`$HOME/.cache/hk-coverage/root-pubic-placement-fix-20261011/02-gender-endpoints.png`
and its adjacent runtime record. All 20 response cells used the QA alpha
program, seven shell instances, transparent normal blending, disabled depth
writes, and the expected coverage/density rows. At explicit coverage `.75`, the
capture records chest's camera-facing clamp on 1,575 of 5,057 female samples
and 2,275 of 5,057 male samples; pubic is 2,206 of 5,957 and 945 of 5,957,
respectively. Those values rule out a purely normal-view alpha estimate as a
complete explanation for the sheet, while they do not justify changing shader
constants.

The next bounded visibility investigation is therefore measurement, not a
render adjustment: add a close-up, fixed-camera projected-footprint readback
that compares current fragment alpha and resolved pixel coverage at density 1
versus 2 for chest and axillary regions. The existing source probe already
identifies a clean falsifiable first hypothesis: chest raw radius moves only
`.04925` to `.06965`, so both values clamp at `.08`. The runtime record supplies
the second: enough samples hit the `.2` angle clamp that the actual fragment
path must be measured before adjusting radius, shells, masks, or lighting.
If that measurement shows equal pixel coverage after the radius clamp, an
isolated radius-response change can be proposed; if it shows materially
different coverage but an unreadable sheet, the next candidate is camera/LOD
framing rather than a body-hair shader change.

Root runs the existing silent command in the sheet header. The optional output
directory receives `01-coverage-response.runtime.json` through
`04-short-whole.runtime.json`, next to the PNGs. The sheet fails if a requested
coat has no live program, no compiled alpha capture, a different runtime paint
row, fewer than four shells, or missing angle samples.

The ESM extraction has a deliberately fresh-process red/green boundary proof
in `tests/threeSingleCopy.test.ts`: direct Node import of React Three Fiber's
package root is the red witness and emits `THREE_CJS_DEPRECATED`; direct Node
import of `src/surface/coatPaint.ts` is green and emits none. This avoids a
cached Vitest module falsely passing the fixture boundary. `tests/coatRuntimeProbe.test.ts`
separately proves that QA capture compiles the alpha section under its distinct
key and clears it when disabled.
