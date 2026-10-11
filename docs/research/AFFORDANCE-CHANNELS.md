# Channels behind the body's apertures

The numbers `src/affordance/channel.ts` draws an aperture's channel from: the
path it takes behind its rim, and how wide it is along the way. As in
`SKIN-STATES.md`, each number is either **measured** (read from a cited source,
or worked out from a source's published data, said so), or a **CHOICE**
(modelled where no measurement was found, and labelled so here and in the
code). Every source below is open access. Sources were read 2026-10-09 and
2026-10-11.

A channel's path runs through a few knots in the head's own frame (forward, up
and toward the midline, from the rim), smoothed into a curve
(docs/ARCHITECTURE.md, "Affordances: curved channels"). Every dimension below
is an adult's and is scaled to the figure by the width of its head (the
distance between its ear canals over the default adult's), so a child's
channels are a child's size.

The bend angles of the ear canal were long quoted from Stinson and Lawton
(JASA 85:2492, 1989), which is not open. No open source tabulates them, so the
canal's path is read from an open study's own plotted data instead (below).

## The ear canal (the external auditory canal)

Sources:

- **Voss et al. 2025**: S. E. Voss, A. K. Remenschneider, R. M. Farrar, S.
  Myoung, N. J. Horton, "Comprehensive Measurements and Analyses of Ear Canal
  Geometry From Late Infancy Through Late Adulthood", *Trends in Hearing*
  29, 2025, doi:10.1177/23312165251345572,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC12198549/>. CT of 221 ears, ages
  0.7 to 91. It publishes its per-ear table as a supplement
  (`sj-csv-2-tia-10.1177_23312165251345572.csv`; also on OSF,
  <https://osf.io/ecpxf/>) and plots every ear's central axis (figure 6).
- **Balouch et al. 2023**: "Measurements of ear-canal geometry from
  high-resolution CT scans of human adult ears", *Hearing Research* 434:108782,
  doi:10.1016/j.heares.2023.108782,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC10219681/>. CT of 66 adult ears;
  the same lab's definitions.
- **El-Anwar et al. 2023**: *Int Arch Otorhinolaryngol* 27(4), CT of 100
  adults (200 ears), doi:10.1055/s-0042-1758213,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC10593536/>, table 1.

The rim is the canal's **entrance** as these studies define it: the most
lateral plane across the canal that its wall encloses all round, where it
leaves the concha. (The 7.75 by 6.1 mm "entry" this note took before is
El-Anwar's bony canal's entry, deeper in; its bony-cartilaginous junction is
7.88 by 6.22 mm.)

Measured, from Voss 2025's per-ear table, the 140 ears of adults aged 20 or
over (means worked out here; `scripts/research/ear-canal-axis.py`):

| Quantity | Mean ± SD |
| --- | --- |
| Length, entrance to the tympanic annulus | 30.9 ± 2.4 mm (n = 135) |
| Annulus to the first bend | 25.6 ± 2.2 mm (entrance to it: 5.3 ± 1.1) |
| Annulus to the second bend (the canal all cartilage from there, `MaxB2C`) | 15.8 ± 2.0 mm |
| Area at the entrance (its most lateral measured section) | 101.5 ± 23.5 mm² |
| Area at the first bend | 64.5 ± 18.2 mm² |
| Area at the second bend | 49.0 ± 15.9 mm² |
| Area 4 mm from the annulus (the narrowest, typically) | 32.4 ± 7.9 mm² |
| Area at the annulus | 63.7 ± 6.6 mm² |

Balouch 2023's published means agree (table 1: length 31.4 ± 3.1 mm, entrance
to first bend 6.0 mm, areas 97, 53 and 56 mm² at the entrance, first bend and
annulus).

**The path.** Voss 2025 describes it (Results, "Curvature of Canal and Key
Landmarks in 3D Space"): "In the sagittal plane, as the canal extends from its
most medial point (0 mm) toward its lateral end, it first moves superiorly,
then inferiorly, and reverses back to a superior direction at the first bend.
The transverse plane reveals a posterior-to-anterior shift, from the tympanic
annulus to the canal entrance." Its figure 6 plots each ear's axis in both
planes, in millimetres. The script digitises the seven adult panels (20 to 90
years): each panel's axis points mapped through its axes, left and right ears
folded together, the median taken at each millimetre out from the annulus, and
averaged over the panels. The median axis rises about 1.8 mm by 12 mm out,
falls to about 1.4 mm below its start by 21 mm, and rises again to the
entrance; seen from above, the entrance lies about 9 mm forward of the
annulus. Its three straight runs (annulus to the sagittal peak, peak to
trough, trough to entrance) are walked out from the annulus at the table's
mean distances, so the bends sit where the table puts them:

- **Second bend**, 15.1 mm in from the entrance: the path turns **26°**.
- **First bend**, 5.3 mm in: the path turns **41°**.

**Measured** (derived from the published figure and table; the median of
many ears is smoother than any one ear, whose bends are sharper and vary
widely). For scale, the only other open number found, an abstract of a
preprint on 163 CT scans (Zavdy et al. 2025, doi:10.22541/au.175255758.80046546/v1,
not peer reviewed), gives the canal's angle as 151.3° (a 29° bend) at 18.

**Cross-sections.** An upright ellipse, 1.27 times as tall as wide (El-Anwar's
7.75 by 6.1 mm; its other stations keep 1.27 to 1.31), of the areas above:
10.1 mm wide and 12.8 mm tall at the entrance. **Measured** (the aspect
carried along the canal is the one CHOICE).

## The nostril (the nasal vestibule and passage)

- **Nostril floor width**: 10.98 ± 1.40 mm (men), 10.13 ± 1.73 mm (women),
  Korean adults in their twenties,
  <https://www.koreascience.or.kr/article/JAKO200907642268558.page?&lang=en>;
  11.00 mm, young Turkish men. **Measured.** The rim's width across is taken as
  10.5 mm, between the two.
- **Nostril axis**: about 60% of the alar length in a 3D study of 20 young
  white adults (the same review), against an alar length of 24.7 to 27.1 mm
  (Korean) gives an axis of about 15 mm: the rim's long diameter. **Measured**
  (derived from two measured ratios).
- **The turn**: air entering the nostril rises through the vestibule, then
  "experiences a 90° change in direction" into the main passage (Jin et al.
  2024, *Pharmaceutics* 16:722, doi:10.3390/pharmaceutics16060722,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC11206772/>; a computational fluid
  study's description, not a measured angle). The path rises 10 mm straight
  up the head, then turns back through the valve: a right angle in all.
  **CHOICE**, on that description.
- **The nasal valve**: 19.2 mm (14.8 to 27.3) behind the columella's base in
  CT of 33 adults (Giotakis et al. 2026, *Diagnostics* 16:229,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC12839841/>, table 1; a cohort with
  nasal obstruction). The path reaches it about 20 mm in. **Measured**
  (its rise and lean are the CHOICE above). Its area is 0.54 ± 0.13 cm² per
  side in 30 healthy adults by acoustic rhinometry (de Oliveira Camargo Gomes
  et al. 2008, *Braz J Otorhinolaryngol*, doi:10.1016/S1808-8694(15)31386-0,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC9445960/>, table 2). **Measured.**
- **The passage**: back from the valve along the nasal floor to the end of the
  turbinates, 92.1 mm from the nostril in one healthy CT (Nižić Nodilo et al.
  2021, <https://pmc.ncbi.nlm.nih.gov/articles/PMC8229415/>, figure 10;
  **measured**, on one subject). Its area is taken as 100 mm² per side, within
  the 85 to 129 mm² CT areas of the anterior cavity (*Head Face Med* 2024,
  doi:10.1186/s13005-024-00420-6, <https://pmc.ncbi.nlm.nih.gov/articles/PMC10967109/>,
  table 1). **Measured** (a value within a measured range).
- The valve and the passage are drawn three times as tall as wide: the
  airway is a tall, narrow slit beside the septum. **CHOICE.**

## The mouth (the oral cavity and oropharynx)

- **How far it opens**: the maximal interincisal opening of 400 adults is
  45.7 ± 6.9 mm (Almohaimeed et al. 2025, *Front Oral Health*,
  doi:10.3389/froh.2025.1724913,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC12833337/>, table 2). The
  channel's height at the rim runs from 0 (closed) to that opening.
  **Measured.**
- **Width at the rim**: the figure's own mouth (the distance between the
  corners of the lips), not a number here.
- **The path**: back over the tongue 40 mm, then turning down a right angle
  into the oropharynx, 92 mm in all. **CHOICE.** No open source measures the
  resting angle between the oral and pharyngeal airways: one measures 40 to 44°
  between the oral and pharyngeal axes with the head extended for intubation
  (Hong et al. 2016, *Korean J Anesthesiol* 69:138,
  doi:10.4097/kjae.2016.69.2.138,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC4823408/>, table 3), a posture
  made to straighten that turn. The length stands on the oropharyngeal
  airways sized from the incisors to the angle of the jaw, 80 to 100 mm for
  adults (ISO 5364:2016).
- **Its size along the way**: the rim's size over the tongue; in the throat,
  60% of the mouth's width and 35% of its opening, about the retroglossal
  airway's 3.62 ± 0.85 cm² (dynamic MRI of 84 adults, *J Magn Reson Imaging*
  2026, doi:10.1002/jmri.70237,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC13066510/>, table 4) on an adult
  mouth opened wide. **CHOICE** (on a measured area).
