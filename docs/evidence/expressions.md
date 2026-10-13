# Expressions

The named expressions (`EXPRESSIONS`, `src/rig/expressions.ts`; ARCHITECTURE.md,
"Named expressions") and the audit of the face rig under them.

## Audit of the face units (2026-10-09)

Every unit and expression was posed on the CPU (`skinPositions`) at ages 6, 14,
45 and 75 and measured against the rest face. No rendering is involved, so each
number is the geometry the renderer skins.

| Check | Result |
| --- | --- |
| A blink (both upper lids closed, lower lids raised) | 0 to 2 % of rays from the eye's centre, in a 35° cone, leave the body at every age, against 36 to 47 % at rest |
| A squint | the opening narrows below three quarters of rest and stays above 2 % |
| Skin moving into the eyeball | none: no unit changes the distance from the eye's centre to the nearest skin by more than 0.6 mm |
| Left units against right units, reflected | identical for the eye, brow and cheek pairs |
| Mouth-corner pairs and central units | **not identical in the authored data**: `NasolabialDeepener` 2.7 mm of 5.6 mm uneven at age 45, `MouthLeftPullUp` against `MouthRightPullUp` 0.45 mm, `UpperLipStretched` 0.45 mm |

The asymmetry is in MakeHuman's frames (`NasolabialDeepener` rotates the right
nose-wing bone 7.8° about Z and the left not at all), and the pack now carries
every unit as the mean of itself and its partner's reflection
(`scripts/lib/faceUnits.ts`), so the expressions below move both sides alike: a
test poses each at age 45 and holds the skin to its own mirror within 0.1 mm.

## The ten expressions

![The ten named expressions and a rest face at age 45: neutral, smile, grin, frown, surprise, anger, disgust, fear, sadness, blink, squint](./expressions-age45.webp)

*Age 45, melanin 0.5, `integration`, no scalp hair. Left to right, top to
bottom: neutral, smile, grin, frown, surprise, anger, disgust, fear, sadness,
blink, squint.* Each is `expressionUnits(id, 1)`, a FACS-grounded weighting of
the pack's units (ARCHITECTURE.md, "Named expressions").

What to read in it: the smile lifts both corners with a little cheek and no teeth;
the grin parts the lips on a clean row of teeth with the lower gum and tongue
behind them; surprise opens the jaw and lifts the brows to 0.7 (at full weight the
lift made a boxy ridge over each eye); anger draws the brows down and tightens the
mouth; a blink closes the lids fully (under 2 % of rays from the eye's centre
leave the body) and a squint narrows them without closing. The weights are
**choices** tuned against these sheets, not measurements.

![The same at age 6](./expressions-age6.webp)

![The same at age 75](./expressions-age75.webp)

*Ages 6 and 75.* A child's face moves as freely as an adult's, with no lines; an
old face shows them (below).

![Smile, frown, surprise and sadness at four skin tones](./expressions-tones.webp)

*Melanin 0.05, 0.35, 0.7 and 0.95 left to right; smile, frown, surprise,
sadness top to bottom, age 45.* The teeth, gums and mouth's lining hold at every
tone, and the lids and mouth corners move the same; the teeth are the lightest
thing in the face at every tone, as a tooth is.

## What was wrong, and what fixed it

| Sheet | What it showed | Cause | Fix |
| --- | --- | --- | --- |
| v1 | the teeth in a grin, snarl and fear read dim grey-olive | the bake's openness is a tenth or less for teeth the lips have parted a little, since it counts every ray the lips, cheeks and chin block within 5 cm; the pose-keyed blend matched the exact bake within 12 % for every expression, so it was the bake's scale, not the blend and not the key set | the teeth material raises the openness to `TEETH_EXPOSURE` = 0.5 (`patchOcclusion`'s `exposure`): a tooth a tenth open gets 0.42 of full light, not 0.24; a covered tooth stays at the floor, an open one is unchanged. The floor is not raised |
| v1 | pink between the lower teeth and the lower lip in a grin: the tongue through the teeth? | not the tongue: the pink is the lower gum, which the teeth mesh carries | a test holds the tongue behind the plane of the lower teeth's fronts in every expression at ages 6, 14, 45 and 75 (`tests/expressions.test.ts`) |
| v1 | surprise had a boxy brow ridge | the brow units at full weight | surprise's brow weights are 0.7 |
| v2 | wrinkle masks reached up over the crown | masks built from heights leak across the coarse forehead's big triangles | the forehead's and the furrows' masks are bounded by distance along the skin from the brows' band (`distanceFromBrows`), and a test holds every layer's mask to its anatomical extent |

## Against MakeHuman 1's expression library (2026-10-13)

Issue 58, item 2. MakeHuman 1.1's expressions are 32 `.mhpose` files, each a name,
tags and `unit_poses`: face unit names with weights, nothing else. The pinned upstream
tree (`packs/body/data/PROVENANCE.md`) no longer carries them, and neither does the
CC0 system assets pack. The 1.1.1 release's copies state AGPL3. A third-party
redistribution of a MakeHuman tree from after the September 2020 relicense carries
the same 32 files, unit weights identical, each stating `"license": "CC0"`
(copyright 2020, the MakeHuman team); that is what this comparison read. No
official source for the CC0 copies was located, so they are used for comparison
only and are not packed or copied here: the table records unit names and
similarity, no weights. Packing them would first need an official CC0 source.

**Every unit they use is packed.** The 32 expressions use 43 distinct units, all
among the kit's 60, so any of them applies through `faceUnitRotations` as authored.
Sixteen of the kit's units appear in none: the eight tongue units
(`TongueOut`, `TongueUshape`, `TongueUp`, `TongueDown`, `TongueLeft`, `TongueRight`,
`TonguePointUp`, `TonguePointDown`), `LeftEyeDown`, `RightEyeDown`, `LeftEyeturnLeft`,
`RightEyeturnLeft`, `ChinLeft`, `ChinDown`, `ChinForward` and `MouthMoveRight`. A test
(`tests/expressions.test.ts`) holds the 43 names to the pack.

**The two sets answer different questions.** MakeHuman's library is 13 emotion tags
over 32 variants: amusement (`laugh01`, `laugh02`), anger (`anger01`, `threaten01`,
`threaten02`), boredom (`boring01`, `sleep`, `stunned01`), courage (`determination01`,
`determination02`), delight (`smile01` to `smile05`), disgust (`disgust01`), doubt
(`doubt01`, `sceptical01`), fear (`fear01` to `fear04`), interest (`attention01`),
phonemes (`vocalize`), sadness (`sad01`, `sad02`, `cry01`), surprise (`surprise01`,
`surprise02`) and tension (`effort01` to `effort03`). The kit's ten are authored
FACS-grounded choices (ARCHITECTURE.md, "Named expressions"): none shares an id with a
MakeHuman file. The nearest MakeHuman file to each, by cosine similarity of the two
weight vectors (the same-tag file's similarity is given where the nearest is of another
tag):

| Kit expression | Nearest in MakeHuman 1 (similarity) | Reading |
| --- | --- | --- |
| `smile` | `smile02` (0.90), `smile04` (0.81), `smile01` (0.75) | the same family |
| `grin` | `smile02` (0.82), `smile04` (0.75) | a wider smile; MakeHuman has no separate grin |
| `sad` | `sad02` (0.90) | the same family |
| `blink` | `sleep` (0.93), `stunned01` (0.86) | lids closed; MakeHuman files it under boredom |
| `anger` | `threaten01` (0.73), `threaten02` (0.63), `anger01` (0.53) | the same family |
| `surprise` | `fear03` (0.78), `fear04` (0.71), `surprise01` (0.69) | the kit's lifts the brows and opens the lids and jaw, as MakeHuman's fear does |
| `fear` | `fear03`, `fear04` (0.70) | the same family |
| `disgust` | `anger01` (0.73), `effort03` (0.71) | the kit's `disgust` against MakeHuman's own `disgust01` is 0.34: that file uses 16 units, so the kit's reads nearer MakeHuman's anger and tension files than its disgust one |
| `frown` | `threaten01` (0.62), `sad02` (0.47) | no close MakeHuman file |
| `squint` | `threaten02`, `effort01` (0.69) | no close MakeHuman file |

The kit has no counterpart for doubt, boredom, interest, courage, tension, laughter or
the phoneme shape. These are gaps in the kit's set, not in the pack: the units are
there.

**The kit's units are symmetrized, MakeHuman's are not.** The pack carries every face
unit as the mean of itself and its partner's reflection (above, and ARCHITECTURE.md),
so a MakeHuman expression applied in the kit differs from upstream wherever the
authored units were uneven. Eighteen units change by more than 0.05 (the
largest change in any channel, in degrees): `MouthLeftPullSide` and
`MouthRightPullSide` by 5.5, `NasolabialDeepener` by 3.9, `MouthLeftPullUp` and
`MouthRightPullUp` by 3.8, `MouthMoveLeft` and `MouthMoveRight` by 3.3, `ChinLeft` and
`ChinRight` by 2.8, `ChinForward` by 1.9, `MouthLeftPullDown`, `MouthRightPullDown`,
`MouthLeftPlatysma` and `MouthRightPlatysma` by 1.4, `UpperLipBackward` by 1.3,
`ChinDown` by 1.2, `UpperLipStretched` by 0.5 and `TongueOut` by 0.2. 27 of the 32
expressions use at least one of them, the smiles and the fear and anger variants
most (`NasolabialDeepener` alone is in 15). A one-sided MakeHuman expression keeps
its side: only the units' own unevenness is averaged away.

**What a recommendation would be, not done here.** Packing the 32 files as a CC0
expression set is cheap (unit weights only) and gives a MakeHuman user the library
they know, applied through `HumanoidPose.faceUnits`. It needs an official CC0 source
for the files first, and it is an owner call: the kit's ten are its own named set,
and the library's variants would sit beside them, not replace them.

## The teeth, the tongue and the lining

The gums were a saturated red (`docs/evidence/gums.md`), and the mouth's lining
and tongue are painted by the skin stack (`docs/evidence/mouth-lining.md`); the
sheets above are rendered with both. The teeth's light does not depend on the
skin's tone, so the same teeth read the same across the tone sheet, and the gums
take the figure's melanin.

## The expression lines

![The lines at age 75: neutral, smile, grin, frown, anger, surprise, squint, disgust, sad](./expression-lines-age75.webp)

*Age 75, melanin 0.5, `integration` at 43e7ba0. Left to right, top to bottom:
neutral, smile, grin, frown, anger, surprise, squint, disgust, sad.* Nothing on
the neutral face. The frown and anger draw two short vertical furrows between the
brows; surprise draws three uneven lines across the raised forehead, sagging and
breaking up toward the temples; the smile, grin and squint fan crow's feet from the
eyes' outer corners and deepen the nasolabial folds; disgust wrinkles the bridge of
the nose.

![The same at age 45](./expression-lines-age45.webp)

*Age 45.* The same lines, lighter than at 75 (`expressionAgeFactor`: 1 at 40, 1.4 at
70); at age 6 there are none worth the name (0.2 of the depth), as the age-6 sheet
above shows.

![The lines at four tones: smile, frown, surprise, sadness at melanin 0.05, 0.35, 0.7 and 0.95](./expression-lines-tones.webp)

*Four tones, age 75.* The furrows and the forehead's lines read at every tone,
including the deepest: a line darkens the skin by the same step of CIELAB lightness
on every tone, and is cut as a groove the light catches on one side
(ARCHITECTURE.md, "Facial wrinkles").

![The forehead close up at age 75: neutral, frown and surprise at three tones](./expression-lines-closeup-age75.webp)

![The same at age 45](./expression-lines-closeup-age45.webp)

*The forehead about 12 cm across, ages 75 and 45; rows are melanin 0.1, 0.5 and
0.9, columns neutral, frown, surprise.* The furrows are two grooves 1.5 to 2.5 cm
long with soft ends, between the inner brows; the forehead's lines are three, at
about 2.1, 3.7 and 5.4 cm above the brows' joints, deepest at the centre, uneven,
and broken toward the temples.

### What was wrong with the forehead's lines and the furrow, and why

| Sheet | What it showed | Cause | Fix |
| --- | --- | --- | --- |
| v1 to v2 | lines over the crown | masks built from heights leak across the coarse forehead's triangles | masks bounded by distance along the skin from the brows' band |
| v3 to v5 | the furrow a curled "ʍ" squiggle, forehead lines faint | thin relief on a coordinate interpolated between vertices about 2 cm apart bends | thin lines as colour on colour stops of a coordinate that is a smooth function of position (the palm creases' technique), a smooth line across any triangle |
| v6 | a stamped glyph between the brows and arcs at the temples in surprise, none across the forehead | **not the technique**: the distance array was single precision, so a vertex's stored distance could round below the one it was queued with and the Dijkstra skipped it; most of the forehead's midline was never reached (mask 0) | double precision; tests hold the distance a metric and the midline reached (both fail without the fix) |
| v7 | real lines, but the furrows ran to the hairline, the forehead's lines were even stripes up to the crown, and on the deepest tones the lines nearly vanished | a furrow's mask had no end cap; three lines at one spacing; a multiply by a fraction of albedo is too small a step of lightness on dark skin | furrows capped at 1.5 to 2.5 cm; the forehead's lines lower (top 5.4 cm), sagging, waving, unevenly spaced and broken toward the temples; the multiply chosen per tone for the same L\* step, and a per-pixel groove (the normal tilted by the gradient of the line's own coordinate) |

## Where the lines lie

A test (`tests/faceLines.test.ts`) holds every expression line layer's mask to
its anatomy, measured from the default figure's own joints: the forehead's
reach no higher than the band 6.2 cm above the brows' joints and no wider than
the temples; the furrows' stay between the inner brows, from 1.2 cm below to 2.6 cm
above the joints; the crow's feet lie within 3.6 cm of the outer corner of the eye
and lateral of it; the nasolabial folds run from the nose's wing past the corner of
the mouth; none touches a lip bone (within 9 mm) or the eyeball (within 12 mm); and
the right's are the left's reflected. A browser test holds the shader's grooves to the
reference profile's slope, and a unit test holds the deepest tone's lightness step to
over 0.6 of the fairest's.
