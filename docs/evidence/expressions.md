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
