# Clothing

Rendered on 2026-10-09 with `scripts/contact-sheet.mjs` against the playground
(`?clothing`), on the studio stage: the garments of `humanoid-kit-clothing`
worn by figures of the base mesh. Every sheet was read figure by figure for skin
showing through, gaps at cuffs, necklines and hems, and cloth sinking into the
body; what it found is listed under each.

## Every garment

![The twelve suits, each with a pair of shoes, and a hat](./clothing-garments.webp)

Left to right, top to bottom: navy shirt, blue sweater, striped shirt, blue
T-shirt, field jacket and white T-shirt (each with jeans), fitted T-shirt and
jeans, T-shirt and denim shorts, sports top and leggings, overalls, striped
blouse and skirt, and suit and tie with the grey fedora. The shoes cycle through
all six pairs, so every pair is shown too. (The assets are named `male_…` and
`female_…` after the figure they were drawn on; the pack labels them by what
they are, since every garment binds to any figure.)

Each suit is a complete outfit (shirt, trousers, and for the elegant ones a
jacket in one mesh). The sports top ends above the waist by design, and the pink
spot on the denim shorts is a button in the texture.

## Shape and size

![Three outfits on a lean, heavy, muscular, 12-year-old and 7-year-old figure](./clothing-shapes.webp)

Left to right: lean, heavy, muscular, age 12, age 7; the rows are
`male_casualsuit01` with `shoes01`, `female_casualsuit02` with `shoes04`, and
`male_elegantsuit01` with `shoes03`. A garment binds to the base mesh by vertex
and scales its offsets by the body's own measurements, so it follows every
build, and a child's fit is the same garment on a child's body, not a resized
copy. No skin shows through at the neck, wrists or waist at any of the five.

## Poses

![Three outfits in a relaxed pose, a T-pose and the rigging benchmark](./clothing-poses.webp)

Left to right: relaxed, T-pose, benchmark (every joint bent to its extreme, with
the figure kneeling and the arms raised). Garments are skinned to the figure's
own skeleton with the body's weights, so cloth follows the pose and a kneeling
figure rests on whichever of knee and shoe is lower. The pack has no walk pose
yet (animation packs are milestone 8), so the three poses it does have are
shown; the benchmark is the harder test, since it bends the elbows, shoulders,
hips and knees past what a walk reaches.

### Garments skin like the body

Garments take the body's dual quaternion skinning (`applyDualSkinning`), so a
sleeve keeps the arm's volume where linear skinning pinches it. The casual
suit in `twisted` (every limb turned past what a body can) and `flexed`, first
with linear cloth, then with dual quaternions:

![The casual suit in the twisted and flexed poses, skinned linearly](./clothing-skinning-linear.webp)

![The suit in flexed, twisted and benchmark poses, then an adult flexed, skinned by dual quaternions](./clothing-skinning.webp)

Left to right on the second sheet: flexed, twisted, the elegant suit in the
benchmark pose, and an adult (the refined surface) flexed. Linear, the twisted
upper arms narrow to a wrapper and skin shows at the shoulder tops. Dual, the
sleeves stay full, but skin still showed at the shoulder tops in the benchmark
pose (arms overhead) as well as the twisted one; the next section is why, and
the fix.

### Skin at a garment's edge

![Casual suit in relaxed, T-pose, benchmark and twisted poses, the elegant suit flexed, and an adult flexed, with the skin at the garment edge sunk under the cloth](./clothing-skinning-edge.webp)

Left to right, top row: relaxed, T-pose, benchmark (arms overhead, kneeling);
bottom row: the elegant suit flexed, the casual suit twisted, an adult flexed.
The skin-coloured patches either side of the collar in the benchmark pose were
not the open collar. They were the ring of body faces MakeHuman keeps at a
garment's edge so no gap opens: it sits a centimetre or two under the cloth, and
with the arms raised the cloth at the shoulder top ends up 2–9 mm inside the
skin (clavicle, shoulder, spine and neck bones meet there at near-equal
weights). The model now sinks that ring under the cloth by its own clearance
(docs/ARCHITECTURE.md, "Clothing", "Skin at a garment's edge"); the patches are
gone from the benchmark sheet. The orange at the forward knee in the benchmark
cell is the rear foot's shoe (`shoes01` is orange-brown), not skin: every knee
face lies under the jeans' deleted vertices.

**Limit.** The twisted pose turns the upper arms 135°, past the roughly 90° a
body reaches, and a faint mark remains at the shoulders there. Measured on body
vertices covered at rest and outside the cloth posed, within 15 mm, at the
shoulder top, the summed depth is 4 mm in twisted (10 mm before), 26 mm over
three neck-base vertices in the benchmark pose (107 mm before), and none in the
T-pose or flexed. That is the accepted bound: past a joint's range the cloth and
skin separate by more than the tucked clearance.

## Layering at the feet: the fault, and the fix

Before: garments ordered by MakeHuman's category table, which puts shoes (57)
over trousers (47).

![Trousers cut off at the ankle with a torn staircase hem and the sock exposed](./clothing-feet-before.webp)

The system shoes declare `z_depth` 5 against the suits' 50. Ordered by category
the shoes were the outer layer, so their `delete_verts` hid the part of the
trouser leg that lies over the ankle, and the cut followed the mask's face
boundary: a torn, staircase hem with the sock showing above the shoe.

After: ordered by the asset's own `z_depth` first, then the category.

![The same figures with the trouser hem hanging over the shoe](./clothing-feet-after.webp)

The same six figures (the first without shoes). The hem hangs over the shoe as it
does on a person, and as MakeHuman draws it, which orders by `z_depth` too.
`docs/ARCHITECTURE.md` ("Clothing") has the reasoning; a test pins the order.

## Light and dark skin beside sleeveless and short garments

![Four garments on a very light and a very deep skin tone](./clothing-skin.webp)

Top row melanin 0.04, bottom row 0.95. Left to right: the T-shirt and denim
shorts, the sports crop top and leggings, a T-shirt and jeans, and overalls over
a T-shirt. The edge of a sleeve or a hem is where hidden skin meets drawn skin,
so it is where a mismatch would show: the skin continues across every sleeve
edge, hem and waistline at both ends of the range, with no seam, halo or
lighter band, because the skin under a garment is not rebuilt or re-coloured,
only left out of the draw.

## The wardrobe

![The creator's Wardrobe tab with a suit, shoes and a hat worn](./clothing-wardrobe.webp)

The creator offers a Wardrobe tab when the client loaded a clothing pack: the
garments by kind, named by what they are ("Brown oxfords", "Overalls"), one worn
per kind, layered across kinds, each change one undo step. Picking a garment
changes the outfit without rebuilding the body, so a slider drag over a dressed
figure stays as smooth as over a bare one. The creator's title shows whole above
its actions at this panel width.

## On the public demo

The clothing pack is CC0 and is published with the playground: the Pages build
carries its files, and `/playground/?clothing` opens the demo with the pack
loaded and the Wardrobe tab in the creator. A visit without `?clothing` never
requests a byte of it (a Playwright test checks that). Only the adult anatomy
pack is kept off Pages (`pnpm check:pages`).
