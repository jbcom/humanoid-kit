# Torso: evidence

Contact sheets of the trunk's own skin, rendered through `hk-sheets` from the
playground with `?frame=` (the camera aims at a bone by name, `at=` moves the aim by
a world offset) on 2026-10-09. What each layer is and where its numbers come from:
docs/ARCHITECTURE.md, "Torso", and docs/research/SKIN-STATES.md, C7.

## Ribs

![A woman and a man at weight 0, 0.2 and 0.5: the ribs fade out](./torso-ribs.webp)

`frame=spine01&at=0,-0.02,0.1&view=0,0,1&span=0.55`, lit from the camera. Top row a
woman, bottom row a man, age 25, weight 0, 0.2 and 0.5. The grooves between nine
ribs fall outward from the breastbone, clear of the breast, the arms and the
breastbone's strip; their strength is the figure's body fat (Gallagher's equation of
the body mass index its own mesh has): plain at weight 0, faint at 0.2 and gone at
0.5, where the figure is no longer lean enough for them to show. A man shows them
at a higher weight than a woman, as his fat is less at the same index.

## Collarbones

![Collarbones of a woman and a man at weight 0, 0.5 and 1](./torso-collarbones.webp)

`frame=clavicle.L&at=-0.04,0,0.03&view=0,0.35,1&span=0.22`, lit from the camera.
Woman then man at weight 0, 0.5 and 1. A ridge on each collarbone's axis between
the fossae above and below it: sharp at weight 0, faint at 0.5 and gone at 1 on the
woman, who has more fat over the bone; a man's are plainer at every weight. The
first sheets showed loops at the bones' ends and a staircase along the rib window's
edge: the coordinate fell to 0 outside each window, so the triangles on its edge
swept through every groove they skipped. It now runs on, held at its ends, and
`tests/torso.test.ts` holds each layer's coordinate to its gradient across every edge.

## Navel and midline

![The abdomen of a woman, a lean man, deep-toned figures, a heavy woman and a girl](./torso-abdomen.webp)

`frame=spine03&at=0,0,0.14&view=0,0,1&span=0.28`. A default woman, a lean muscular
man (the ribs run on to the lower chest), a deep-toned woman, a deep-toned lean man,
a heavy woman (stretch marks on the belly, running across it) and a girl of 12. The
navel is the mesh's dimple with a pinker, darker hollow; the linea nigra is faint at
rest by design (12% of a full line, after puberty only) and the linea alba a furrow
half a millimetre deep that shows only on the lean man: both are softer than a
strip a vertex wide can make them. The pregnancy state, later, takes the linea nigra
to full strength.

## Stretch marks

![Stretch marks from behind: women 25, 15 and 60, a man, a tall girl](./torso-striae-back.webp)

`frame=root&at=0,0.08,-0.12&view=0,0.1,-1&span=0.3`, lit from the camera. Heavy woman
25, heavy girl 15 (new marks, red), heavy woman 25 at melanin 0.85 (old marks, pale
against the skin), heavy woman 60, heavy man 30, a tall girl of 15 at average
weight (few). The marks run across the stretch, round the body, in groups, and are
a fifth of a millimetre sunk (lit on one side).

![Stretch marks from the side-front](./torso-striae-side.webp)

The same figures from the side-front at 40 cm across. On light skin the old marks
are a pale peach, a little lighter; on deep skin they are the lighter, hypopigmented
marks the clinical descriptions give.

## Not drawn, and limits

- The marks stop two centimetres short of the back's midline: the body's UV islands
  meet there and the noise is drawn in UV, so a mark that crossed it would be cut and
  offset. The soles' ridges share the limit.
- The marks are slightly dashed (the noise's kernels interfere along a streak) where
  real ones are mostly continuous: a different noise for them would cost the shader a
  second pattern.
- None of the layers adds shape: the nipple's height, the navel's dimple and the rib
  cage are the mesh's; a layer colours and shades.
- The base mesh's vertices are about a centimetre apart, so the linea nigra and the
  collarbone's ridge are soft bands.
- No sheet of the areola here yet: its first sheets were clipped by the camera's
  10 cm near plane (a nipple stands 3 cm out), which is why the frames are 11 cm across.
