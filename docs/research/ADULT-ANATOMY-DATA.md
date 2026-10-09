# Adult anatomy: measured dimensions, colour, and asset licences

Date: 2026-10-09. Research task 1 of `ADULT-SCULPT-PLAN.md`, for the own sculpt
(milestone 3, phase 2). Method as in `SKIN-STATES.md`: numbers below were read
from the text of the source unless marked; what could not be verified is said
so. Licence is the licence the source states. Where the paper is under
copyright, only the numbers are used (measurements are facts), never its tables
or figures.

Bottom line:

- **Vulvar dimensions now have a verified source**: Kreklau et al. 2018 (N=657),
  with means, SDs, extremes and percentiles by decade. It is lighter-skinned
  only (Caucasian) and a clinic population, so it gives ranges for the sculpt's
  controls, not a statement about every adult.
- **Genital colour is still an open gap.** A second search of the open literature
  (vulvar, penile and scrotal colorimetry, melanin and erythema index) found no
  normative values. The sculpt's colour stays modelled and labelled so.
- **No existing genital asset is used, and the community assets' licence is
  under verification (licence-history).** Every detailed female and male proxy
  found carries an AGPL-3 file header or derives from one that does, while its
  web page says CC0. MakeHuman made a definite cutover to CC0, and a licence
  line or page label can be stale and superseded, so which of the two governs
  each asset is being traced with dated evidence (commits, archived pages, the
  cutover announcement, each asset's upload date against it). Until that
  reports, this document does not settle it. The decision below does not depend
  on it: the shipped geometry is new, built against the CC0 hm08 base only.

## A. Vulvar dimensions

### A1. Kreklau et al., BJOG 2018

| Item | Detail |
| --- | --- |
| Source | Kreklau A, Vâz I, Oehme F, Strub F, Brechbühl R, Christmann C, Günthert A. "Measurements of a 'normal vulva' in women aged 15-84: a cross-sectional prospective single-centre study", BJOG 125(13):1656-1661 (2018). DOI 10.1111/1471-0528.15387, PMID 29940085 |
| Licence | Publisher copyright (accepted manuscript read: "protected by copyright"). Numbers only. |
| Population | N=657 Caucasian women, 15-84 y (mean 47.3 ± 18.5), height 142-186 cm, BMI 13.7-51.8 (mean 25.4); 245 nulliparous, 412 parous; Lucerne outpatient clinic, 2015-2017 |
| Measurement | Standardised calliper-style measurements of the external genitalia (its Figure 1 defines each); right and left sides separately |
| Deep skin | NO (Caucasian only) |

Whole-cohort values (mm), from its Table 2:

| Measure | Mean | SD | Min | Max |
| --- | --- | --- | --- | --- |
| Clitoral glans width | 4.62 | 2.54 | 1 | 22 |
| Clitoral glans length | 6.89 | 4.97 | 0.5 | 34 |
| Clitoris to urethral opening | 22.63 | 7.66 | 3 | 65 |
| Introitus opening | 27.91 | 10.36 | 6 | 75 |
| Perineum length | 21.34 | 8.54 | 3 | 55 |
| Labia majora length (right / left) | 79.71 / 79.99 | 15.25 / 15.44 | 12 / 20 | 180 / 180 |
| Labia minora length (right / left) | 42.10 / 42.97 | 16.35 / 16.29 | 6 / 5 | 100 / 100 |
| Labia minora width (right / left) | 13.40 / 14.15 | 7.88 / 7.64 | 2 / 1 | 61 / 42 |

Percentiles by decade (its Table 3), for the control ranges. The 5th to 95th
percentile, all ages together by the decade columns' extremes:

| Measure | 5th percentile range across decades | 50th | 95th |
| --- | --- | --- | --- |
| Clitoral glans width | 2 | 4 | 8.95 to 11.6 |
| Clitoral glans length | 1.6 to 3 | 4 to 6 | 13.85 to 21.9 |
| Labia minora length (right) | 6 to 25 | 30 to 50 | 55 to 82.55 |
| Labia minora width (right) | 0 to 5 | 10 to 15 | 24.85 to 33.8 |
| Labia majora length (right) | 41.2 to 65 | 70 to 81.5 | 99.75 to 112.55 |
| Introitus opening | 10 to 14 | 25 to 30 | 40 to 49.9 |
| Perineum length | 6.2 to 10.1 | 18 to 22 | 32 to 40.5 |

What it says about structure, which the sculpt's independence needs:

- Right-left asymmetry of the labia was not statistically significant, so the
  controls need not be per side by default, though the range (minimum 5 against
  mean 43 mm) allows an asymmetry control later.
- Age: labia minora length falls with age (r = -0.364), as do clitoral length
  (-0.169), clitoris-to-urethra distance (-0.283) and perineum length (-0.095).
  Age is a macro, so age-dependence is a candidate for tying feature defaults
  to the age macro rather than a feature of its own.
- BMI: labia majora length rises with BMI (r = +0.150) and labia minora length
  and width fall (r = -0.170, -0.133). Body-fat macros therefore affect the
  features, which the binding to hm08 (the features follow the body's own
  shape) already carries for the majora, and the minora need a coupling or a
  documented independence.

Scale of the problem for topology: the median glans is 4 mm wide and 6 mm long,
the labia minora median 13 mm wide, the introitus 28 mm. The base pelvis has a
median control edge of 18.7 mm (ADULT-SCULPT-PLAN.md, section 1), 9 mm after one
subdivision level. A glans or a labial fold needs an edge of 2 to 3 mm to be a
shape and not a bump.

### A2. Lloyd et al., BJOG 2005

Lloyd J et al. (Creighton's group, London). "Female genital
appearance: 'normality' unfolds", BJOG 112:643-646 (2005), N=50 premenopausal
women measured under anaesthesia, finds wide ranges and no significant
association with age, parity or ethnicity. The copy found is an image-only PDF
with no extractable text, and no numbers were read from it. Not used;
Kreklau's N=657 supersedes it for ranges, and the ethnicity finding is a lead
for a deep-skin source, not a result.

### A3. Not found

- Vulvar dimensions in non-Caucasian cohorts, and in women aged 18-24 on their
  own (Kreklau's youngest decade is 15-24).
- Penile and testicular dimensions beyond the B4 table in `SKIN-STATES.md`
  (flaccid and erect length and circumference, Veale et al.). Testicular
  volume: two ultrasound studies give means near 17 mL (a European multicentre
  study of healthy fertile men, N=248, mean age about 35) and 15.6 ± 5.3 cm³
  (a Nigerian cohort, 2012), both read as search abstracts only, so the
  sculpt's testes control is a range around 15 to 17 mL until the full tables
  are read. The multicentre paper is in Andrology (2021-2022) and is the one
  to fetch.

## B. Genital colour (A4 follow-up)

Both searches (extended mode) for spectrophotometric or colorimetric reference
values of vulvar, penile or scrotal skin by skin type found none: only
instrument methodology, clinical atlases ("rosy skin with darker areas of
normal pigmentation in the labio-crural folds and the labia majora", erythema
"more subtle and sometimes masked" in darker skin), and ACOG's lay range from
light pink to dark brown-red or black.

- **Sommers et al., Am J Emerg Med 2008 (PMC2587067)**, the one study with
  CIELAB of genital sites by race (N=120, 57 white, 63 black): re-read in full
  text. It states each site was measured (at least nine L\*a\*b\* readings by two
  technicians, ICC 0.99 for the epidermis) but its tables report injury
  prevalence by site, not colour: **the per-site means are not in the paper**.
  What it does give: epidermal colour, not mucosal or vaginal-wall colour, was
  significantly related to external genital injury, and after adding colour
  the race effect disappeared. The per-site values are available only from the
  authors (corresponding author M. Sommers, Penn Nursing). A request is the
  action; no value is invented.
- **Jankowski et al., Aesthet Surg J 2025 (PMC13481094, CC BY)**: relative
  contrast of 1080 vulvar photographs to the groin, uncalibrated, Caucasian
  only; absolute values not reported (as already in A4).

Consequence, unchanged: `genitalAlbedo` models genital colour along the melanin
and haemoglobin axes and is labelled uncalibrated.

## C. Arousal-related volume change (B4 follow-up)

Deliganis AV, Maravilla KR, Heiman JR et al., "Female genitalia: dynamic MR
imaging with use of MS-325", Radiology 225(3):791-799 (2002), DOI
10.1148/radiol.2253011160, N=12 (analysed N=10), subscription paper. Only its
abstract was read (Europe PMC), which does not give the magnitudes. Secondary
reports of its figures (a press release: mean clitoral volume 10.74 to 21.17 cm³;
patent text from the same group: blood volume +43% ± 5%, size +85% ± 5%) do not
agree with each other on which quantity they describe. **Not used to calibrate
anything**: a state morph for the clitoris waits for the primary text. The
existing finding stands: the volume change exists and is large, its magnitude
here is unverified.

Consequence for the state morphs: the male shaft's flaccid and erect states are
calibrated (circumference +25%, length +43%, section B4) and ship as the
`arousal` morph. The vulvar and clitoral state has no CC0 target and no verified
magnitude, so the library carries it as **absent and tested as absent**
(`tests/adultPermutations.test.ts`), not as a guessed number. When the vulva
sculpt exists, a provisional morph may use the two secondary figures above only
if it is labelled uncalibrated in the pack and the doc, as `genitalAlbedo` is,
and is replaced when the primary text is read.

## D. Asset licences

The question: is any existing genital geometry or texture usable, and under what
licence? Source: `~/src/reference-codebases/makehuman-assets-research`
(catalogue of 2026-10-08: each asset's page licence and the licence line in its
downloaded file, kept side by side) and the MakeHuman checkout's `LICENSE.md`.

- **The hm08 base mesh and its targets are CC0** (`LICENSE.md`: "The base mesh
  and proxies ... Targets and modifiers ... have been released under CC0 1.0
  Universal"). This includes the `helper-genital` face group and the genital
  targets the pack already uses. These are the only genital data this project
  ships or builds on.
- **Community genital proxies: licence status under verification (licence-history);
  not used meanwhile.** What the catalogue of 2026-10-08 recorded: `adult_female_genitalia_remapped`,
  `adult_male_genitalia_xsuprem3x`, `adult_female_2020` and `simple_penis` say
  CC0 on their pages but carry `# license AGPL3` in the `.proxy` file, and the
  first two are derivatives of the original AGPL proxies. `adult_male_genitalia_breast_fix`
  and `erect_penis_only_works_with_males` say CC0 on the page with no file-level
  licence and derive from the same lineage (the latter from "Male_Gen-Heal1",
  a "HEALED" proxy). The detailed female proxies by wolgade/geyser are AGPL on
  their pages and were not downloaded. If the AGPL-3 headers govern, they are
  not compatible with shipping an MIT package; if the CC0 cutover supersedes
  them, they may be. That turns on the dated history under verification, not on
  this catalogue. Until it reports they are not used, copied or traced.
- **Genital skins** (wolgade): the page says CC0, the `.mhmat` files carry no
  licence line, and they are textures painted for the AGPL proxies' UV layout.
  Not used; the sculpt's skin colour is procedural (the layers).
- **Decision.** The anatomy geometry is authored here against the hm08 base
  (CC0) and the measurements above (facts), by us, and the pack that carries it
  stays CC0-dedicated like the existing adult pack. No third-party genital
  asset is imported, so the licence check has nothing to clear. A later
  contributor should wait for the licence-history result before reaching for
  the community proxies, in either direction.
