# Skin regions across tones

Rendered on 2026-10-09 with `scripts/contact-sheet.mjs` against the
playground: the default figure on the studio stage, with only the skin
changed. Melanin runs 0.05, 0.2, 0.35, 0.5, 0.7, 0.9 from left to right.

## Face: base tone and lips

![Faces across melanin](./skin-tones-face.webp)

Lips follow the measured lip model (ISSA lip lightness against skin, specular
included). At light tones they read pinker than the skin; at dark tones they
read lighter and greyer than the skin, as measured lips do.

## Chest: areola

![Chests across melanin, female above, male below](./skin-tones-chest.webp)

Female above, male below. **Open finding:** the areola reads barely darker
than the surrounding skin at every tone, and at the darkest tones it is not
visible at all. Measured areolas contrast clearly with the skin at every tone.
The colour model (`areolaAlbedo`) or the layer's strength needs recalibrating.
This belongs to the torso area work and is queued there.

## Flush

![Flush 0, 0.5, 1 at melanin 0.15, 0.5, 0.85](./skin-flush.webp)

Columns are flush 0, 0.5 and 1. Rows are melanin 0.15, 0.5 and 0.85. Flush
reddens the cheeks, nose and ears; melanin masks it, as haemoglobin colour is
masked in darker skin. At light tones, flush 1 turns the nose strongly red.

## What is not rendered yet

The skin-state signals `heat`, `exertion`, `blush` and `fear` are accepted by
`<Humanoid signals>` but nothing on `main` draws them. Only `cold` has a visible
effect, through its state morph (nipple and areola, `docs/evidence/posing.md`).
Their colour and relief layers (pallor, flush, sweat sheen, goosebumps) are
queued as their own work.
