# Body-hair direct-control lab

Status: planned direct-control lab; it is an acceptance surface, not a creator
panel and not a release claim.

The lab is reached locally with `?bodyHairLab&muted`. It keeps the figure at
age 30 and offers the three existing macro endpoints: feminine (`gender: 0`),
mixed (`gender: .5`) and masculine (`gender: 1`). These are probe subjects,
not gender locks: the recipe's existing explicit `bodyHair.coverage[group]`
continues to replace the physiological baseline at every macro value.

## Controls

The lab deliberately uses finite named choices instead of an unbounded bank of
sliders:

| Choice | Recipe effect |
| --- | --- |
| Region: face, chest, axillary, legs | Selects one independently authored group and its camera/pose. |
| None, sparse, medium, full coverage | Sets the selected group's explicit coverage to `0`, `.25`, `.5`, or `1`. |
| Sparse, standard, dense follicles | Sets that group's `follicleDensity` to `.25`, `1`, or `2`. |
| Feminine, mixed, masculine | Sets only `macros.gender` to `0`, `.5`, or `1`; age remains 30. |

The face probe also sets the existing `beard: "full"` shape because the coat
uses beard style to select its face geometry. The other regions use only their
existing coverage and follicle-density fields. The lab does not edit legacy
`density`; it exists to make the direct controls' independent semantics
inspectable without hiding a zero anchor or a saturation plateau.

## Acceptance contract

1. Every probe is an adult age 30 figure with exactly one selected explicit
   coverage and follicle-density entry.
2. Region and form choices change the rendered recipe, not just a label. The
   currently selected values remain visible beside the controls.
3. The lab frames face, chest, raised axilla, and legs deliberately. The
   control column scrolls independently of the model canvas, so selecting a
   lower control cannot make the figure disappear.
4. A browser contract exercises all four regions, every form endpoint, `None`
   and `Full` coverage, and the follicle-density endpoints. It waits for the
   figure's own settled marker and reads the selected recipe from the lab.
5. The browser test only proves routing, selection and renderer handoff. Root
   must inspect captured PNGs before accepting hair readability, strand
   spacing, masks, or regional placement.

The lab is non-persistent and uses the playground's `?muted` silent-QA mode.

## Current visual finding

The lab frames every declared region and sends the direct control values to the
canonical recipe. That is **not** renderer acceptance. The current full-coverage,
dense-follicle evidence is rejected for production use: face output contains
long, disconnected dark filaments; chest and axillary output do not communicate
readable terminal hair; and leg output does not show readable terminal strands.
Those are renderer-quality defects, not a reason to restore the legacy density
multiplier or add a gender baseline. The next renderer owner must preserve this
lab and make the existing direct `coverage` and `follicleDensity` API visibly
meaningful for each region.
