# humanoid-kit: body hair research (sources and what is measured)

Date: 2026-10-09. The model is `src/surface/bodyHair.ts`. This note says where
each number comes from. Anything not measured is marked **choice**.

## Two kinds of hair

- **Vellus** ("peach fuzz") is short, fine and barely pigmented. It grows from
  nearly every follicle outside the glabrous skin (palms, soles, lips) at every
  age, and is seen mostly against the light, as a faint sheen at the
  silhouette. The kit draws it as a skin layer (sheen and fine relief), never as
  geometry.
- **Terminal** hair is long, coarse and pigmented. On the body it is androgen
  dependent: under androgens, vellus follicles convert to terminal ones from
  puberty on, region by region. It is drawn as a fine-strand skin layer where it
  is short or sparse, and as sparse alpha cards on the hair pack's machinery
  where it is dense (beard, chest).

## Where terminal hair grows, and how much: the Ferriman-Gallwey regions

Ferriman and Gallwey (J Clin Endocrinol Metab 21:1440, 1961) scored terminal
hair 0 (none) to 4 (frank, dense) in eleven regions. Hatch et al. (Am J Obstet
Gynecol 140:815, 1981) kept the nine hormone-sensitive ones (upper lip, chin,
chest, upper back, lower back, upper abdomen, lower abdomen, upper arm, thigh),
the modified FG score used clinically, where a woman's total of 8 or more is
hirsutism. The scale grades how a region looks, not a count, so it fits a
coverage value directly: **coverage = score / 4**.

The kit's region groups follow the FG regions, merged to what a picker can
offer: `face` (upper lip, chin, sideburns), `chest`, `abdomen` (upper and lower,
the linea), `back` (upper and lower), `buttocks`, `arms` (upper arm, forearm),
`legs` (thigh, lower leg), and the adult-only `axillary` and `pubic`.

The scores per group at maturity (`BODY_HAIR_COVERAGE`), at both ends of the
androgen axis, are **choices** read off the FG scale's own descriptions: the
FG regions are what is measured, and that the kit's gender macro stands for the
androgen level linearly is also a choice. Typical adult men score 2 to 4 on most
regions; a non-hirsute woman scores at most 1 on the upper lip, lower abdomen,
forearms and lower legs, and 0 elsewhere.

| Group | Female end | Male end | Note |
| --- | --- | --- | --- |
| face | 0.1 | 1.0 | a fine upper-lip shadow at the female end |
| chest | 0 | 0.6 | chest hair varies widely between men |
| abdomen | 0.1 | 0.65 | the linea first |
| back | 0 | 0.25 | sparse in most men |
| buttocks | 0.05 | 0.35 | |
| arms | 0.3 | 0.6 | the forearms carry more than the upper arms |
| legs | 0.45 | 0.85 | unshaved, at both ends |
| axillary | 0.85 | 0.95 | barely androgen-dependent once mature |
| pubic | 0.85 | 0.95 | the male pattern also climbs the linea, drawn by `abdomen` |

## When it grows: puberty and age

Pubic hair is the first terminal hair of puberty (Tanner stage 2, pubarche), then
axillary hair, then facial and body hair. Mean ages at pubic stage 2: about 11.2
years in girls and, in boys, 12.0, 11.2 and 12.3 for white, black and
Mexican-American boys (US NHANES III, as reported in the Tanner-staging
literature; the survey tables themselves were not read); axillary stage 2 about 11.7 to 13.1 in girls and 13.6 to 14 in boys. No
reliable median for facial hair onset was found; it follows axillary hair. The
beard and chest keep densifying into the twenties and thirties, the back later
still.

The kit's ramps (`BODY_HAIR_MATURITY`, a smoothstep from onset to full) are
**choices** placed on those ages: legs and arms 11 to 20, face 13 to 25, chest
and abdomen 15 to 35, back and buttocks 18 to 45. Axillary and pubic hair are
**adult-only under the kit's age policy** (`src/recipe/agePolicy.ts`), so their
ramps would start before 18 but nothing of them is drawn below it: the gate is
the policy's line, not the biology's.

**Old age** (`BODY_HAIR_SENESCENCE`): terminal hair on the limbs and trunk
thins in old age, the lower legs most. The size is a **choice**: limbs and
trunk lose up to 40 % from 55 to 85; axillary and pubic hair up to 50 % from 50
to 85; the beard keeps its density.

## Grey

Panhard, Lozano and Loussouarn (Br J Dermatol 167:865, 2012, 4192 volunteers)
found that between 45 and 65 years 74 % of people have grey scalp hair, at a
mean intensity of 27 %, and that only 6 to 23 % have half their hair grey at 50
(the "50/50/50" rule overstates it); men grey more than women, and people of
Asian and African ancestry less than those of European ancestry. The kit's age
grey is a smoothstep from 35 to 95, which gives 26 % at 55, the middle of
Panhard's cohort, and 98 % at 90, as the **fit**. It applies to the scalp's colour model only as
a floor: a recipe's own `hair.colour.grey` stands for the scalp and is not
replaced.

Body hair greys later than the beard and scalp; the lag (beard none, trunk and
limbs 8 years, axillary and pubic 12 years) is a **choice** from common
observation, not a measurement.

## Colour and coarseness by region

Body hair takes the figure's hair pigments (`recipe.hair.colour`, the
eumelanin and pheomelanin model of `hairTone.ts`), adjusted per region. The
beard and pubic hair are darker and coarser than scalp hair; limb hair is
finer and lighter. The offsets in eumelanin (face +0.08, pubic +0.12, axillary
+0.05, trunk 0, limbs −0.08) are **choices**.

Fibre diameters and lengths (`BODY_HAIR_FIBRE`), which set a strand's width and
how long a strand is drawn: beard about 0.1 mm thick, pubic about 0.1 mm,
trunk about 0.07 mm, limbs about 0.05 mm; lengths of 10 mm (forearm) to 25 mm
(pubic). These are **choices** in the published range for terminal hair (scalp
hair is 0.05 to 0.1 mm), not measured per region here.

## Follicle density

Otberg et al. (J Invest Dermatol 122:14, 2004), as quoted by McPhetres et al.
2024 and used by the goosebumps layer: follicles per cm² run from 14 (calf) to
32 (upper arm), with the forehead far higher. The strand layers place one root
per follicle and draw a strand from a share of them equal to the terminal
coverage. The figures per region beyond those two ends could not be read from
the paper (not retrieved), so the kit's (`BODY_HAIR_DENSITY`: chest and
abdomen 22, back 26, buttocks 20, arms 25, legs 16) are **choices** on that
range, and the beard's 60, the armpit's 60 and the pubis's 40 are **choices**
above it, for the denser, coarser hair there.

Vellus (`VELLUS`): under 30 µm across and 2 mm long by definition; 50
follicles per cm² is a **choice** between the body's range and the forehead's.
Every measured skin colour includes its vellus, so the vellus layer adds no
mean colour; its strands show only in close views.

Beard lengths: stubble is about 1 mm, a few days at the roughly 0.3 mm a day
beard hair grows (recalled, not verified here); grown styles' 10 to 20 mm are
**choices**.

## Pubic hair

Where it grows is the adult anatomy pack's data, measured on the base mesh by
`scripts/lib/adultCoat.ts` in the frame of the mons, taken from the base mesh
alone (the packer has no adult targets when it measures): on the midline's
skin 9.6 cm below the hip joints' height, which is the height of the mons
target's displacement-weighted centre, held there by a unit test. The shape is the adult pattern Tanner stage 5
describes (the Tanner staging cited above): a triangle over the mons,
level along its top, narrowing to the crotch and spreading onto the inner
thighs' edges, on to the perineum. Its numbers are **choices** fitted to that
description and this mesh, not measurements: the hairline 7.5 cm above the
mons' centre (the mons target reaches 5.4 cm above it), a half-width of 7.5 cm
there narrowing to 2 cm at the crotch 5 cm below the centre, the hair ending
11 cm below it, and every edge easing over at least a centimetre. The male
pattern's climb up the linea toward the navel is not this mask's: the trunk's
abdomen region holds it, and the model's coverage by sex and age says how much
grows on either.

## What is not here

- Ethnic variation in body hair density is real (less on average in East Asian
  ancestry) but no source here measures it per region, so the kit does not tie
  density to skin tone: a recipe's density multipliers do that.
- Hair whorls and the direction of growth per region are modelled from the
  limb and trunk axes, not measured.
