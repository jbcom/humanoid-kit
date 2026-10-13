# The figure battery

Every visual feature is calibrated and judged against one fixed set of figures,
`scripts/sheets/battery.json`, so a feature tuned on one body and one skin
cannot pass while failing on the rest of the people the kit draws.

## The sets

- **tones**: six skin tones from melanin 0.05 to 0.9, on the average adult
  body. Colour, contrast and fairness are read here.
- **bodies**: eighteen figures at a mid tone (melanin 0.5): slim, average,
  heavy and muscular women and men, an androgynous average, tall and short,
  elders of both sexes, a teen, a child, and the three ancestry anchors. Shape,
  placement and scale are read here.
- **cross**: the shape extremes (slim and heavy women, muscular and heavy men,
  an elder, a child) at four tones (light, mid, dark, deepest). Anything placed
  on an area is read here, because a placement or mask that holds on one body
  can drift off another and a contrast that reads on one tone can vanish on
  another.
- **scatter**: thirty adults spread over the whole ethnic simplex, melanin,
  undertone and six facial features (nose width, lip volume, chin width,
  epicanthic fold, ear scale, cheekbones), each drawn independently over its
  range (`src/foundation/scatter.ts`). The tones, bodies and cross sets hold
  one ethnic mix (MakeHuman's equal thirds) except the three pure anchors at
  one tone, so they cannot show a face the mix makes different. Each of the
  simplex's seven anchors (the three pure vertices, three edge midpoints and the
  centre) is a figure twice, one of each gender, one on lighter skin and one on
  deeper; the rest fill the simplex. Anything that depends on a face, a nose,
  an eye shape or a skin's undertone is read here too. `tests/foundationScatter.test.ts`
  holds its coverage.

## The rules

1. **A base area before what sits on it.** Marks, tattoos, piercings, hair and
   garments are judged only on areas whose own evidence has passed on the
   battery. A layer placed on an area that does not yet render correctly is
   not judged, and its evidence is not accepted.
2. **Evidence shows the battery.** A feature's approval needs its sheet over
   the bodies set and the tones set; a placed feature also needs the cross
   set. A sheet of one figure is a diagnostic, never evidence.
3. **Calibration constants come from the battery.** A tuned number (a mask
   radius, a placement offset, an ink depth, a contrast floor) is fitted
   across the battery, and its test samples the battery's extremes rather
   than the default figure.

## Using it in a sheet request

`hk-sheets request` expands `{"$battery": "tones" | "bodies" | "cross"}` in a
request's `recipes` into the set's recipes, merging the request's `"$with"`
object (the feature under test, as recipe fields) into each one; cells are in
the set's order and their names go in the request's `why`. The scatter set is
`scatter.figures` in the same file; until the tool expands `"scatter"` too, a
request takes its figures as `recipes` (each is `createRecipe` input).
