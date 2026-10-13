# Effective adult defaults lab: 2026-10-12

`?adult&muted&lab=effective-adult-values` is a development-only diagnostic
route. It is not a claim that the general creator or adult anatomy is ready.
The adult pack stays out of the production Pages build.

## What the lab proves

The route loads the pack's own slider taxonomy and anatomy defaults, then
shows the raw saved modifier separately from `withAnatomyDefaults`' effective
value. Its three finite adult anchors are feminine (`gender: 0`), mixed
(`0.5`), and masculine (`1`), all at age 30. The loaded defaulted controls are:

| Control | Feminine | Mixed | Masculine |
| --- | ---: | ---: | ---: |
| Phallus size | 0.080 | 0.365 | 0.650 |
| Testes size | 0.000 | 0.300 | 0.600 |
| Vulva | 1.000 | 0.500 | 0.000 |
| Anal canal | 1.000 | 1.000 | 1.000 |

An explicit zero remains a saved override. Reset removes that raw override so
the loaded default applies again; undo restores the exact preceding recipe.
The lab uses the shared recipe-history reducer, so a run of discrete actions
always derives the next recipe from the reducer's present state.

## Accepted diagnostic evidence

The owner checked the narrow contract in a live Chrome session at a 1040 × 433
viewport:

1. Each named control recorded raw `0.000` after its explicit-zero action.
2. Each named reset returned its raw cell to absent and the mixed anchor to
   `[0.365, 0.300, 0.500, 1.000]`.
3. Eight actions created eight history steps; undo restored only the anal-canal
   zero and left seven history steps.
4. After scrolling the controls panel to its bottom, the rendered canvas still
   occupied the viewport, the whole figure remained visible, the root scroll
   position was zero, and only the controls panel scrolled.

The post-render receipt measures the figure's actual projected `Box3` bounds;
it fits the Canvas camera to the measured figure before reporting bounds. This
is visibility evidence for the diagnostic stage, not a sculpt-quality verdict.

The same flow passes on the render pool with silent headless Metal:

```text
heavy-slot --remote-render --render-host _gitea_render@192.168.1.202 --context gate -- \
  pnpm exec playwright test --project=adult-defaults-lab e2e/effective-adult-defaults.spec.ts
```

Receipt: `render-fd8bd9fb0b2d4b54b24c3f663df7cc33` (1/1, 6.6 s).

## Limits

This does not accept anatomy topology, sculpt quality, deformation, interaction,
body-art, clothing, broad creator controls, or public release behavior. Those
need their own labs and visual review. The dev-only Playwright project exists
because public production builds deliberately omit the adult pack.
