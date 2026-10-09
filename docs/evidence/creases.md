# Joint creases

Rendered on 2026-10-09 with `scripts/contact-sheet.mjs` against the playground,
on the studio stage, at 2× pixel density, with the camera 0.3 to 0.5 m from the
skin: the same figure and pose, once with the crease depth set to zero (left)
and once as shipped (right). The poses are `bent` (elbows about 90°, knees about
80°) and `tpose` (arms straight), authored for the check
(`scripts/poses/bent.json`). The creases follow the pose's flexion signals
(`flex.elbow.L` and so on); magnitudes and what is measured against what is
art-directed are in `docs/ARCHITECTURE.md`, "Joint creases".

## The crook of a bent joint

![The crook of the left elbow and the back of the left knee, without and with creases](./creases-flexor.webp)

Top: the elbow's crook, seen from inside the bend. Without creases the skin is
smooth up to the step where the weights hand over from the upper arm to the
forearm; with them, two folds cross the crook. Bottom: the back of the knee,
whose skin folds in several grooves as the shin comes up (the strain there is
over 60 %, so the folds are the deepest of any joint). The grooves are narrow
cuts in flat skin, not ripples: that is what the light catches.

![The arm bent at the elbow, without and with creases](./creases-arm-front.webp)

The same bend from the front. The fold across the elbow reads as a skin fold
and not a seam; the forearm and hand beyond it are unchanged.

## The loose skin of a straight joint

![The front of a straight knee and the back of a straight elbow, without and with creases](./creases-extensor.webp)

The extensor side wrinkles when the joint is straight and is drawn tight as it
bends. Top: the kneecap's skin of a standing knee; bottom: the point of the
elbow with the arm out. These are at 30 % of the flexor folds' depth and fewer:
a first version drew four deep rings round the straight knee, which read as a
stack of bands, and was reduced until the skin showed a trace of loose skin
over the kneecap and nothing round the sides.

## Body types

![A bent figure at four body types](./creases-bodies.webp)

The `bent` pose on the average adult, a muscular man, a short full woman and a
ten-year-old. Creases are close-up relief: at full-figure distance (above) they
are finer than a pixel and fade out, so these figures show the posed geometry
only. The dark streaks beside the hips are the fingers' shadows, not skin.

## What this does not show

The wrists' creases are 2 across 6 cm of skin at a quarter of the knee's strain
and show at no angle tried; they are in the layer stack and tested, but the
wrist is the joint with least to see. Skin colour darkens and reddens at an
extended elbow or knee (SKIN-STATES.md, A2); that is a colour term and not part
of these detail layers.
