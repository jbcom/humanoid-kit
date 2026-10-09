# Posing (M2)

Rendered on 2026-10-09 with `scripts/contact-sheet.mjs` against the playground,
default figure, studio stage.

## Expressions

![Face units](./expressions.webp)

Left to right, top to bottom (face unit weights; 1 when not given):

1. rest
2. blink: `LeftUpperLidClosed`, `RightUpperLidClosed`
3. jaw open: `JawDrop`
4. bared teeth: `JawDrop` 0.6, `UpperLipUp` 0.6, `lowerLipDown` 0.6
5. smile: `MouthLeftPullUp`, `MouthRightPullUp`, `LeftCheekUp` 0.6, `RightCheekUp` 0.6
6. open smile: `JawDrop` 0.7, `MouthLeftPullUp`, `MouthRightPullUp`
7. frown: `LeftBrowDown`, `RightBrowDown`, `NoseWrinkler` 0.7, mouth corners down 0.6
8. surprise: inner brows up, upper lids open 0.8, `JawDrop` 0.4
9. kiss: `LipsKiss`
10. gaze left: `LeftEyeturnLeft`, `RightEyeturnLeft`

Teeth and tongue uncovered by the open mouth are lit through the pose-keyed
occlusion. With the jaw open the front teeth still render at about 40% of their
open-air brightness, since the hemisphere visibility the bake measures also
scales direct light; directional visibility is an open follow-up.

## Body poses and skin state

![Body poses](./poses.webp)

1. rest (MakeHuman's A-pose)
2. `tpose`
3. `benchmark`, grounded on its lowest point (the kneeling knee)
4. `cold` skin state (the nipple rises, the areola contracts; small at this scale)
5. age 9 in `benchmark`

Both poses are CC0 BVH files from MakeHuman, packed with the body.
