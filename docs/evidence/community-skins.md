# Community skins: how much of the tone range they cover

Whether MakeHuman's CC0 community skins (`skins01` to `skins03`) and its system
skins are worth packing as optional texture overlays for deep and non-European
tones (issue 61). Measured, not judged from the names.

## Method

For each of the 78 skins with a diffuse texture (56 in the three community packs,
22 MakeHuman system skins), the 96-pixel reduction of the
texture, with the atlas background (black, transparent) and the non-skin hues
(`a*` or `b*` at most 2: eye whites, teeth, the blue-grey of some fantasy skins)
left out. The median CIELAB `L*` and `b*` of what is left, and from them the
individual typology angle, `ITA = atan((L* − 50) / b*)` in degrees, which runs
from very light (above 55) through light (41 to 55), intermediate (28 to 41), tan
(10 to 28) and brown (−30 to 10) to dark (below −30). A texture's `L*` includes
the painter's baked shading and is not the albedo `skinAlbedo` returns, so the
angle ranks skins rather than matching the kit's tones to the unit.

The kit's own melanin axis, at the default haemoglobin and undertone, covers:

| melanin | 0 | 0.2 | 0.4 | 0.5 | 0.6 | 0.8 | 1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ITA ° | 56 | 30 | 2 | −9 | −23 | −47 | −70 |

## What the packs hold

Nine of the 78 have no skin-hue pixels (aliens, a baboon, big cats, a white
walker, a grey-skinned person), and eight more measure but are not natural human
skin (a grey alien, an orc, two zombies, an elf, a flag, a tiger and a
test-pattern skin). The remaining 61, by band:

| band | all 61 | community 39 | system 22 | examples |
| --- | --- | --- | --- | --- |
| very light | 2 | 1 | 1 | `old_caucasian_female` (system) |
| light | 23 | 13 | 10 | most of `toigo_*`, `onlytheghosts_*`, the Slavic and system caucasian skins |
| intermediate | 18 | 14 | 4 | the ginger and freckled skins, the asian and caucasian skins |
| tan | 7 | 6 | 1 | `cutoff3d_indian_female_skin`, `toigo_light_skin_*_bronze` |
| brown | 2 | 2 | 0 | `callharvey3d_midtoned_female`, `skalldyrssuppe_creamy_female` |
| dark | 9 | 3 | 6 | the system `*_african_*` skins; `mindfront_skin_male_african_middleage`, `cutoff3d_indian_female_enhanced`, `xhado84_middleage_afro_female_special_suit_green` |

In the community packs 36 of 39 human skins are brown or lighter, and one of the
three dark ones is painted with a suit. The six dark system skins are the
`*_african_*` set (young, middle-aged and old, female and male).

The deepest human skin measured, the system `young_african_male`, has an ITA of
−52. The kit's melanin axis passes it at melanin 0.85 and runs to −70 at 1. Every
human skin in the packs lies inside the range the kit draws procedurally, and
the deep end of that range has no texture in the packs at all.

## Reading

- The issue's observation holds: the community skins are mostly light or
  intermediate, or not human. No pack has a deep East Asian skin, and no deep
  child skin or deep female skin outside the system set and a suit.
- Tone is not what the textures would add. The kit's tone is procedural, from
  melanin, haemoglobin and undertone, and spans past the deepest texture. An
  overlay would carry what the model does not draw: freckles, pores and blemish
  patterns, and the painter's shading.
- A community skin cannot be dropped on as it is. Its colour is baked together
  with that detail, so layered over the procedural tone it counts the tone
  twice, and only a detail-only layer (the texture's high-pass, tone removed)
  is independent of melanin.

## Candidates, if overlays are wanted

Detail-only layers from the human skins that are not light, each CC0 by its pack
page: `mindfront_skin_male_african_middleage` (skins02),
`cutoff3d_indian_female_skin` and `cutoff3d_indian_female_enhanced` (skins01),
`callharvey3d_midtoned_female` (skins01) and `onlytheghosts_*_eurasian_*`
(skins01 and skins02). They cover male and female and a range of ages only
narrowly, and none is an East Asian or a deep female skin, so packing them would
widen the textures without covering the tones the issue asks for. The kit has no
overlay slot for a skin texture yet; adding one is a separate feature and the
owner's decision.
