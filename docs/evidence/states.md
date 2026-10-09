# Skin states

Rendered on 2026-10-09 with `scripts/contact-sheet.mjs` against the playground
(entries' `$signals` key sets the state): the default figure on the studio
stage, with only the skin and its state changed. Sources and choices for every
magnitude are in `docs/research/SKIN-STATES.md` Part C.

## Goosebumps (`cold`, `fear`)

![Goosebumps on the front of the thigh](./states-goosebumps-thigh.webp)

Top row, melanin 0.35: rest, `cold` 0.5, `cold` 1, `fear` 1. Bottom row, `cold`
1 at melanin 0.08, 0.5, 0.75 and 0.95. The papules are 194 µm tall at 21 per
cm², one per follicle; half the signal is half the height. They read at every
tone, and a little less on the deepest, where the shading has less albedo to
modulate. Both triggers raise them.

![Goosebumps on the back of the hand and none on the palm](./states-goosebumps-hands.webp)

Top: the back of the left hand and the fingers; bottom: its palm, from below
and inside, at melanin 0.08, 0.35, 0.75 and 0.95 with `cold` 1. The back of the
hand bears hair follicles and rises; the palm, glabrous, stays smooth. The first
version of this sheet found a fault that is fixed: bumps rendered as streaks
five to twenty times longer than wide on the thighs, because the relief
coordinate used a UV scale that varied across each face. The scale is now one
value per UV island (`uvScale`, `tests/layers.test.ts`).

Relief is a close-up effect. It is drawn at its true size (2.2 mm between
bumps) and fades where a bump is finer than about a pixel, so these sheets are
taken 15 to 30 cm from the skin, and at full-figure distance the skin shows no
bumps at all.
