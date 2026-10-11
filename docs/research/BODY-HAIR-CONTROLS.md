# Regional body-hair controls

Status: implemented candidate awaiting visual acceptance for issue #21. This
document records the compatibility contract before it changes the public recipe.

Candidate worktree: `/Users/jbogaty/src/jbcom/humanoid-kit-body-hair`, branch
`fix/body-hair-independent-controls`, based on integration
`ed8cd260ad168da5e464704575c048aaf04ff555`. It has no visual acceptance or
integration merge yet.

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
