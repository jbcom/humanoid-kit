# humanoid-kit: regional colour and skin-state research (measured sources)

Date: 2026-10-09. Method: Europe PMC / OpenAlex / Crossref lookups plus full-text reads of open-access papers (numbers below were read from the text or abstract unless marked UNVERIFIED). Licence = licence stated on the paper (Europe PMC / OpenAlex / in-text). "Cite numbers only" = NC/ND/closed: do not copy tables.

Legend for deep-skin column: YES = includes Fitzpatrick V-VI or L* < 45 subjects with usable data; PARTIAL = few/qualitative; NO = lighter-skin cohort only.

Bottom line up front:

- Best measured deep-skin regional datum found: palm vs ventral forearm (JBO 2022, CC BY, N=15 incl. five subjects with forearm L*37-46). Palm L* is nearly constant (57.4 +/- ~4) regardless of forearm tone, so the palm-minus-forearm lightness gap grows to ~+16 L* in the dark group.
- Everything about knuckles/elbows/knees, periorbital, genital and areola colour at deep skin tones is either qualitative, light/medium-skin only, or not found. No calibrated genital colorimetry by skin tone exists in what I could reach (honest gap).
- Skin states: goosebump morphology is now measured (CC BY) and explicitly includes a black-skin example; flush/pallor/erythema magnitudes at Fitzpatrick V-VI are NOT available as colour deltas in open literature I reached (only that it is measurable by spectroscopy, and visually masked).
- Joint wrinkling: no measured wrinkle depth vs joint angle found; found measured skin STRAIN vs joint angle (CC BY) which is the right driver signal, plus the game-pipeline lineage (Oat 2007 -> Jimenez 2011 -> mesh-tension 2022).

---------------------------------------------------------------------------

## PART A - Regional colour vs facial/body skin

### A1. Palms and soles (volar skin)

| Item | Detail |
| --- | --- |
| Source | Wilson RH and Durkin AJ (corresponding authors; full author list not recorded) "Quantifying the confounding effect of pigmentation on measured skin tissue optical properties: a comparison of colorimetry with spatial frequency domain imaging", J Biomed Opt 27(3):036002 (2022). PMC8942554. DOI 10.1117/1.JBO.27.3.036002 |
| Licence | CC BY 4.0 (stated in text) |
| Population | N=15 (20-51 y; 9 M / 6 F from Table 1), Fitzpatrick I-VI, UC Irvine |
| Measurement | Konica Minolta CR-400 tristimulus colorimeter, L* of ventral forearm and palm |
| Deep skin | YES (subjects 1-5 have forearm L* 36.7-46.2) |

Per-subject Table 1 (forearm L*-> palm L*), ordered by forearm L*:
36.74->52.53, 39.14->60.97, 42.26->62.20, 43.89->56.93, 46.24->54.28, 56.22->62.99, 56.96->62.87, 57.69->54.61, 59.85->65.95, 61.50->65.78, 62.07->59.40, 63.35->59.68, 63.48->61.42, 63.74->67.87, 66.38->64.89.

Derived (my arithmetic from the table):

- Dark group (forearm L*< 50, n=5): forearm mean 41.7, palm mean 57.4, mean palm-minus-forearm = +15.7 L*.
- Light group (n=10): forearm mean 61.1, palm mean 62.5, difference +1.4 L*.
- Authors: palm L*mean 60.8, SD 4.6 (unimodal); forearm mean 54.6, SD 10.1 (bimodal, break at L* ~50). Palm L* "systematically higher" than forearm in dark skin; 4 light-skinned subjects had forearm slightly > palm.
- Implication: model palm lightness as a compressed function of the melanin axis (palm L*~ 52-68 across the full range in this cohort), not as forearm + constant. Caveat: darkest forearm here is L* 36.7; ISSA facial L*reaches ~30, so deepest-end palm value is an extrapolation (UNVERIFIED below L* 36.7).
- a*, b* of palms: NOT reported in this paper.

| Item | Detail |
| --- | --- |
| Source | Firooz A et al. "Variation of biophysical parameters of the skin with age, gender, and body region", Sci World J 2012:386936. PMC3317612. DOI 10.1100/2012/386936 |
| Licence | CC BY |
| Population | N=50 Iranian volunteers (10-60 y), no Fitzpatrick breakdown (light-medium skin) |
| Measurement | Mexameter melanin index (MI) and erythema index (EI), 8 sites (Table 3, mean +/- SD) |
| Deep skin | NO |

Table 3 values (MI / EI): forehead 228.2 / 420.5; cheek 203.4 / 399.8; nasolabial fold 202.3 / 480.4; neck 226.0 / 373.3; forearm 193.3 / 257.9; dorsal hand 225.9 / 331.9; PALM 99.0 +/- 41.8 / 248.0 +/- 60.8; leg 189.7 / 205.0.

- Palm MI = 0.51 x forearm, 0.44 x dorsal hand. Dorsal hand EI 332 vs palm 248 vs forearm 258 (palm is less red than dorsal hand but equal to forearm).
- Palm TEWL highest (23.5), relevant to a "wet palm" state.

| Item | Detail |
| --- | --- |
| Source | Melanometry review (Communications Medicine 2024, 10.1038/s43856-024-00550-7, PMC11239860) |
| Licence | CC BY |
| Content | States, citing Mexameter and CR-400 studies, "palmar hand and finger have lower pigmentation than the ventral arm (e.g., melanin index of 42 vs 240; L* of 60 vs 39)" and that palm values in highly pigmented people differ only slightly from low-pigmentation people; nail-bed melanocyte content ~5% of normal skin. Secondary citation (ref 204 is the JBO 2022 paper above). |

Mechanism (soles and palms):

- Yamaguchi Y, Itami S, Watabe H, Yasumoto K, Abdel-Malek ZA, Kubo T, Rouzaud F, Tanemura A, Yoshikawa K, Hearing VJ. "Mesenchymal-epithelial interactions in the skin: increased expression of dickkopf1 by palmoplantar fibroblasts inhibits melanocyte growth and differentiation", J Cell Biol 165(2):275-285 (2004). PMC2172049. DOI 10.1083/jcb.200311122. Licence CC BY-NC-SA 4.0 (cite only).
  - Melanocyte density in palmoplantar epidermis > 5-fold lower than non-palmoplantar; no detectable melanin by Fontana-Masson in palmoplantar epidermis; palmoplantar fibroblasts express 3.6-fold higher DKK1, 2.4-fold lower DKK3, 4.4-fold higher leupaxin (cDNA microarray, 10,177 genes); DKK1 acts via beta-catenin/MITF. Cultured/ex vivo human tissue; no skin-type stratification. A 2015 tissue-engineering paper (PMC4356440) says the melanocyte density claim is contested.
- Sole colour: no colorimetric dataset found (UNVERIFIED that sole matches palm; histology says same suppression mechanism). SRT 2023 (PMC10155800, CC BY) measured palm/forearm/sole/lumbar for hydration/TEWL/erythema/stiffness (N=15) but not colour L*a*b*.
- Alaluf S et al., Pigment Cell Res 15 (2002) "Ethnic variation in melanin content and composition in photoexposed and photoprotected human skin", DOI 10.1034/j.1600-0749.2002.1o071.x (closed; abstract only): African and Indian skin has ~2x the epidermal melanin of European/Chinese/Mexican; photoexposed (dorsal forearm) up to 2x photoprotected (volar upper arm) in every group; melanosome size African > Indian > Mexican > Chinese > European. Alaluf 2001 (DOI 10.1034/j.1600-0749.2001.140505.x, closed): in Fitzpatrick V-VI, photoexposed epidermal melanin ~1.6x photoprotected; DHI-eumelanin 60-70% of melanin, DHICA 25-35%, pheomelanin 2-8%.

### A2. Knuckles, elbows, knees (extensor/dorsal hyperpigmentation)

| Item | Detail |
| --- | --- |
| Source | Skin Color Analysis of Various Body Parts (Forearm, Upper Arm, Elbow, Knee, and Shin) ... in 53 Korean Women, J Clin Med 13(9):2500 (2024). PMC11084701. DOI 10.3390/jcm13092500 |
| Licence | CC BY |
| Population | N=53 Korean women, 21-67 y (not Fitzpatrick-stratified; light-medium) |
| Measurement | Spectrophotometer L*a*b*, ITA, Mexameter MI and EI at forearm, upper arm, elbow (extended and folded), knee (extended and folded), thigh, shin |
| Deep skin | NO. Numbers are in figures only (not extractable); ordinal results are in the text. |

Ordinal findings: L*lowest at extended elbow < folded elbow <= extended knee <= forearm <= folded knee <= upper arm, thigh, shin. a* and b*highest at extended elbow. MI: extended elbow > extended knee, folded elbow >= forearm ... > upper arm, thigh, shin. EI follows the same order. The extended (stretched) joint is darker and redder than the same joint folded (relevant to a joint-angle-driven colour term). With age, forearm melanin rises but elbow/knee melanin falls. Differences in a* between body parts were larger than in L*or b*.

| Item | Detail |
| --- | --- |
| Source | Young Chinese female body skin pigmentation map: A pilot study, Skin Res Technol 2024. PMC10772469. DOI 10.1111/srt.13567 |
| Licence | CC BY (Europe PMC) |
| Population | N=20 Chinese women, 20-29 y, back ITA 20-41 (mean 34.2, SD 5.8), BSTQ ~ Fitzpatrick III-IV |
| Measurement | CL400 ITA and MX18 MI at 100 body points, 6 repeats, 12,000 measurements |
| Deep skin | NO |

Most pigmented points: back of neck, heel, elbow, popliteal space (top five by MI + reversed-ITA ranking). Lightest: middle of chest, lower chest, lumbar, upper chest, waist. MI vs ITA R^2 = 0.815. Left/right asymmetry significant at inner wrist, groin, inner ankle, elbow, armpit, waist side, web between thumb and index finger. Per-point numbers are in figures (UNVERIFIED values). The paper also reports (secondary, citing Hermanns et al., Mexameter MX16): MI order dorsal forearm > forehead > volar forearm > inner arm; and (Firooz) neck darkest, then back, forearms, legs, palms lightest.

Deep-skin knuckle/elbow/knee measured data: NOT FOUND. Only the clinical literature on "frictional darkening of extensor surfaces" (case reports, qualitative). Do not invent a deep-skin multiplier; use the Korean ordinal order plus Alaluf's photoexposed/photoprotected melanin ratios (1.6x in V-VI, up to 2x across ethnic groups) as the only measured scaling for dorsal/exposed vs protected.

### A3. Periorbital skin

| Source | Licence | Population / N | Key numbers | Deep skin |
| --- | --- | --- | --- | --- |
| Schalka et al. (Estee Lauder), "Physiological and lifestyle factors contributing to risk and severity of peri-orbital dark circles in the Brazilian population", An Bras Dermatol 90(4):494 (2015). PMC4560538 | CC BY-NC | N=483 (495 evaluated), Brazilian, 13-71 y, Fitzpatrick I-VI (few I and VI), standardized photos + hyperspectral + spectrophotometer | Severity 1-5: 4.6/31.9/22.2/25.9/15.6%. No significant relation between Fitzpatrick type and dark-circle score (p=0.55). Hyperspectral: melanin is the dominant correlate of severity, oxygen saturation secondary (under-eye blood less saturated as severity rises). Instrumental deltas (under-eye minus cheek) dL*and dE* were the best predictors of visual severity; cheek L*did not vary with severity. Numeric L*a*b* values not in text. | PARTIAL (few type VI) |
| Verschoore/Gupta/Sharma/Ortonne, "Determination of melanin and haemoglobin in the skin of idiopathic cutaneous hyperchromia of the orbital region (ICHOR): Indian patients", J Cutan Aesthet Surg 5:176 (2012). PMC3483573 | CC BY-NC-SA 3.0 | N=33 Indian patients | SIAscopy: total and dermal melanin AND haemoglobin higher in dark circles than cheek; paper notes UVA photos fail to distinguish dark circles from the rest of the face in darker skin because melanin is high everywhere. No numbers in text. | PARTIAL |
| Sheth et al., "Periorbital hyperpigmentation: prevalence, causative factors...", Indian J Dermatol 59(2) (2014). PMC3969674 | CC BY-NC-SA 3.0 | N=200 Indian, Fitzpatrick I-IV | Constitutional 51.5%, post-inflammatory 22.5%; lower lid 72.5%; Wood's lamp dermal 60.5% | NO (I-IV) |
| Malaysia (N=100): vascular 51%, pigmentary 6% (from a search-engine summary; paper not opened) | UNVERIFIED | | | |

Net: periorbital colour is a mixture of (a) dermal melanin, (b) more haemoglobin with lower oxygen saturation, (c) thin-skin/shadow. No open L*a*b* delta by Fitzpatrick type found. For deep skin the contrast sits mainly on the melanin axis (a dermal-melanin term), for light skin on the blue-purple haemoglobin term.

### A4. Genital and perigenital skin, nipple vs areola

Honest result: no calibrated colorimetry or spectroscopy of scrotum, penile shaft/glans, labia majora/minora or perianal skin stratified by skin type was found in open literature. Adjacent partial data:

| Source | Licence | Content | Deep skin |
| --- | --- | --- | --- |
| Sommers MS et al., "Forensic sexual assault examination and genital injury: is skin color a source of health disparity?", Am J Emerg Med 26(8):857 (2008). PMC2587067, DOI 10.1016/j.ajem.2007.11.025 (companion paper PMC3683456, "Health disparities in the forensic sexual assault examination related to skin color", Europe PMC year 2009; same cohort, text states a 1-SD increase in L* raised odds of external genital injury 150-250%) | NIH author manuscripts, journal copyright; cite only | N=120 women (57 white, 63 black). CIELAB (Photoshop, digital image analysis, >=9 readings/site/rater) of buttock/vulvar epidermis, posterior-fourchette mucosa, and vaginal wall. Black participants had lower mean L*with a broader range (SD 12.09 vs 6.42 for whites). Higher L* and lower b*predicted external genital injury; genital injury 56% white vs 24% black, internal 28% vs 19%. MEAN L*/a*/b* PER SITE NOT RETRIEVED (tables not in the text); worth an author request or reading the PDF. | YES (population), values UNVERIFIED |
| Jankowski et al., "Think Smooth and Pink: skin color and texture in Caucasian female genital aesthetics", Aesthet Surg J 2025/26. PMC13481094, DOI 10.1093/asj/sjaf230 | CC BY | 1080 vulvar photos (adult-media database), CIELAB sampled at anterior commissure, labia majora and minora, groin as reference; colour reported as contrast to surrounding skin; a* manipulated +/-10 units in stimuli; Polish raters N=159. Uncalibrated photos, Caucasian only; absolute values not reported. | NO |
| Motosko CC et al., "Intergender Tonal Variations of the Nipple-Areola Complex", Plast Reconstr Surg (2019), DOI 10.1097/prs.0000000000005760 (letter) | closed | N=30 nulliparous women (photos) and 30 men (<=40 y). Grayscale (0-255 modal) nipple minus areola: women left -29.4 +/- 13.75, right -31.9 +/- 12.27 (nipple DARKER than areola); men left +7.8 +/- 11.69, right +3.8 +/- 10.39 (nipple lighter). Fitzpatrick score significantly associated with the difference (right side), model R^2=0.756 with sex+Fitzpatrick; coefficients not in the text. Uncalibrated grayscale, but it is the only measured nipple-vs-areola structure found. | PARTIAL (Fitzpatrick covariate; range unknown) |
| NAC tattoo/reconstruction colour work (Springer 2018 paramedical pigmentation, Seville group CIEDE2000) | closed/abstract only | Qualitative: reconstructed NAC less red / more yellow target; no normative L*a*b* by skin type | UNVERIFIED |

Dermatological context only: Skin colour of Montgomery glands, glans/mucosal tissue (non-keratinised, thin, vascular) cannot be derived from epidermal melanin axis alone. Mucosal/thin-keratin sites need their own haemoglobin-dominated term, which is the same reasoning the user already applied to lips (Vergnaud 2024 / Charton 2026).

### A5. Sun-protected vs exposed sites, and other multi-site open datasets

| Source | Licence | Sites / N | Notes |
| --- | --- | --- | --- |
| ISSA (user already has) | per ISSA | inner arm + others | baseline |
| Del Bino S, Bernerd F et al., "Clinical and Biological Characterization of Skin Pigmentation Diversity and Its Consequences on UV Impact", Int J Mol Sci 19:2668 (2018). PMC6163216. DOI 10.3390/ijms19092668 | CC BY | review; ITA classes (very light > 55, light 41-55, intermediate 28-41, tan 10-28, brown -30 to 10, dark < -30); European/Indian/African volunteers ITA +13 to -50 (UVA1 study: similar delta-ITA 16-18 degrees at 45-50 J/cm2 regardless of constitutive tone) | ITA bands + deep-end range |
| Hermanns et al. (Mexameter MX16, N=137; inner arm, volar and dorsal forearm, forehead) | closed (secondary via PMC10772469) | MI order: dorsal forearm > forehead > volar forearm > inner arm; inner arm approx volar forearm | UNVERIFIED primary |
| "Validity of a Self-Assessment Skin Tone Palette Compared to a Colorimeter", Curr Oncol 30:241 (2023). PMC10047066 | CC BY | N=188 (50% White, 30% Hispanic, 20% other), upper-inner arm and outer forearm MI (DSM II ColorMeter) | authors note few Black participants or MI > 70 |
| Hyperspectral Imaging Database of Human Facial Skin, Appl Spectrosc 2024, DOI 10.1177/00037028241279323 | CC BY | 29 faces, "different skin tones", 400-720 nm, 10 nm steps, whole-face pixels + nine facial positions with contact-device validation | facial regional spectra; data availability not checked (UNVERIFIED) |
| Cooksey/Allen NIST skin reflectance reference data set, J Res NIST 122.026 (2017) | US-government work (verify) | N=110, inside right forearm, 250-2500 nm, CSV | from a search summary; not opened; forearm only |
| Interaction of Age and Anatomical Region ... Skin Biophysical Characteristics of Chinese Women, Clin Cosmet Investig Dermatol (2020), DOI 10.2147/ccid.s286402 | CC BY-NC | N=178 Chinese women, forehead/cheek/chin/inner forearm; EI, MI, L*a*b*, ITA. Face has higher EI and a*, lower L* and ITA than forearm; cheek lightest | NO deep skin |
| "Skin Colour Does Not Define Ethnicity" (SRT 2026, 10.1111/srt.70343) and "Unifying the spectrum" (JBO 2026, 10.1117/1.jbo.31.9.095005) | CC BY | both analyse ISSA (14,000-15,256 spectra, 8 groups) | confirm ISSA body-site coverage and note a published meta-framework to cite |
| Skin characteristics: normative data ... 16 anatomical locations, Skin Res Technol 22:263 (2016), DOI 10.1111/srt.12256 | closed (abstract) | N=241, Mexameter erythema and melanin at 16 sites, 6 age bands | single-site tables would need purchase; cite only; skin types not stratified |

---------------------------------------------------------------------------

## PART B - Skin states

### B1. Goosebumps (piloerection)

| Source | Licence | Population / N | Measurement | Key numbers | Deep skin |
| --- | --- | --- | --- | --- | --- |
| McPhetres J, Sun X, Watroba LD, "Morphology and quantification of piloerection in humans", PsyArXiv preprint 2024, DOI 10.31234/osf.io/vahbj (docx at OSF) | CC BY | 15 subjects (12 F/3 M, mean age 20.2), 60 videos (~30 min each), 4 sites: dominant upper dorsolateral arm, dominant dorsal calf, left and right anterolateral thighs | Low-angle (~10 degrees) LED + HD webcam on ~5x5 cm skin, manual frame-by-frame coding (agreement 81.2% intensity, 74% events before reconciliation) | Intensity classes small/medium/large (large = pronounced bumps symmetrically ringing the infundibulum, all visible follicles). Small events are by far the most frequent (n=219 small), large the rarest. Duration mean 10.09 s (SD 6.26) overall; small 9.02 s (4.45), medium 10.09 (6.27), large 13.18 (7.36). Occurs with comparable frequency across arm/thigh/calf; very idiosyncratic across people and across sites within a person. Hair-follicle densities quoted from Otberg et al. 2004: calf 14, thigh 17, forearm 18, back 29, upper arm 32 per cm2 (secondary). | PARTIAL: Figure 2 shows piloerection on black skin and the authors state skin colour does not impede manual detection if lighting is raking-angle; automated GooseLab (grayscale FFT) was judged unreliable. No quantitative skin-type comparison. |
| Kim et al., "A flexible skin piloerection monitoring sensor", Appl Phys Lett 105:013504? (2014), DOI 10.1063/1.4881888 | closed (abstract via Crossref) | 1 subject, dorsal forearm, sudden cold shock (ice cubes) | capacitive 3x3 spiral coplanar sensor, calibrated 0-326 um artificial bump | Measured goosebump "intensity" 145 um and 194 um (capacitance -6.2 fF, -9.2 fF), duration 3.5 s per episode | NO |
| Benedek M, Kaernbach C, "Physiological correlates and emotional specificity of human piloerection", Biol Psychol 86:320-329 (2011). PMC3061318. DOI 10.1016/j.biopsycho.2010.12.012 | CC BY-NC-ND 3.0 | not recorded | forearm optical (goosecam), music and film audio | visible piloerection in nearly half of female participants (47%), none of the small male subsample; most responsive participant 7 of 8 trials; accompanied by phasic electrodermal rise and deeper breathing; 34% of piloerection trials were not self-reported | NO |
| McPhetres J, "Diverse stimuli induce piloerection and yield varied autonomic responses in humans", Biology Open (2024), DOI 10.1242/bio.060205 | CC BY | 8 participants, 1,198 episodes | not recorded | thermal, tactile and audio-visual stimuli are equally effective; skin temperature falls before and rises during episodes | |
| McPhetres et al., "Individuals lack the ability to accurately detect emotional piloerection", Psychophysiology (2024), DOI 10.1111/psyp.14605 | CC BY | 3 studies, N=617 | self-report against observation | only 31.8% of self-reported goosebumps coincide with observable piloerection; piloerection occurs with similar frequency at multiple anatomical sites | |
| "The physiological study of emotional piloerection: a systematic review and guide for future research" (authors not recorded; McPhetres preprint lineage), Int J Psychophysiol (2022), DOI 10.1016/j.ijpsycho.2022.06.010 | CC BY | k=24 studies | systematic review | emotional piloerection co-occurs with increased phasic skin conductance and heart rate | |

Not found: calibrated papule HEIGHT beyond the single Kim 2014 device test (145-194 um on one forearm); papule DENSITY is just follicle density (secondary, Otberg); no OCT/profilometry study located. Therefore: height/shading magnitude is UNVERIFIED beyond the order of 0.1-0.2 mm; cold and emotion are both valid triggers; time course ~3.5-13 s per episode; distribution is multi-site hair-bearing skin (measured: upper arm, forearm, thighs, calves; back is only a follicle-density figure), and by construction not palms/soles/lips (hairless, no arrector pili); areolar wrinkling is smooth-muscle (B3), not piloerection.

### B2. Flushing / blushing / pallor and visibility at deep tones

Measured facts I could verify:

- Stephen ID, Coetzee V, Perrett DI et al., "Skin blood perfusion and oxygenation colour affect perceived human health", PLoS ONE 4(4):e5083 (2009). PMC2659803. DOI 10.1371/journal.pone.0005083. CC BY. Empirical colour axes: oxygenated-blood axis from first dorsal interosseous region of the hand after 5 min in 45-50 C water (N=10) vs resting; deoxygenated axis from arm-down (hyperaemia, 30 s) vs arm-up (10 s) (N=10); spectrophotometer CM-2600d, CIELab. Participants preferred faces shifted toward higher perfusion/oxygenation (2D transform dE of +3.03 oxygenated, -3.10 deoxygenated). Cross-cultural arm: 20 black South African and 18 UK Caucasian raters adjusting a*of faces of various ethnicities (+/-16 a* range) chose a mean increase of 2.39 +/- 0.18 a*, redness added to African, Caucasian, mixed faces; negative relation with initial redness. Table S1 (actual L*a*b* of axes) NOT retrieved. Deep skin: PARTIAL (perception, not measured flush colour on dark skin).
- "Oxygenated-Blood Colour Change Thresholds for Perceived Facial Redness, Health, and Attractiveness", PLoS ONE 2011, DOI 10.1371/journal.pone.0017859, CC BY: 2AFC detection thresholds for oxygenated-blood colour change (abstract only read: colour-detection thresholds are lower than health/attractiveness thresholds; numeric threshold not read).
- Facial skin blood flow with emotion (laser speckle): "Facial skin blood flow responses during exposures to emotionally charged movies", J Physiol Sci 2017 (authors not recorded), DOI 10.1007/s12576-017-0522-3 (CC BY-NC-ND): N=12, 2-min movies; blood flow and vascular conductance DECREASED in lips, cheeks, chin during comedy and horror movies (largest with comedy), no change with landscape; correlated negatively with pleasantness. So emotional "pallor"-type vasoconstriction is the norm in this protocol; "blush" needs self-conscious emotion (below).
- Frontiers Psychol 2023 (DOI 10.3389/fpsyg.2023.1259928, CC BY): N=30; observers' facial SkBF decreases on viewing angry/embarrassed faces, most for angry-with-blush.
- Front Hum Neurosci 2017;11:525 (DOI 10.3389/fnhum.2017.00525, CC BY): N=22 women, compliment-elicited blush: cheek and forehead temperature rose linearly, periorbital fell; visible-spectrum skin got deeper red on forehead and cheeks; thermal change did not correlate with colour change.
- Benitez-Quiroz CF et al., PNAS 115 (2018), "Facial color is an efficient mechanism to visually transmit emotion". PMC5889636, CC BY-NC-ND (cite only). 184 identities, many ethnicities and races, 18 expressions; colour patterns decode emotion category independent of AUs. Per-emotion L*a*b* deltas are in figures (UNVERIFIED).
- Inflammatory erythema (pathology, not physiologic flush): PMC13180473 (Cureus 2026, CC BY), N=44 (phototype 1/2/3/4/5/6 = 9/10/10/7/7/1): Mexameter EI 425.9 (baseline biceps) vs 455.0 (rash); A*7.5 +/- 3.9 vs 13.1 +/- 4.6 (delta +5.6); L* 60.6 vs 52.1; ITA 34.4 vs 5.7. ONE phototype VI subject; baseline EI differed by phototype (p=0.004). Weak for deep skin.
- Visibility/measurability at deep tones: Stamatas G, Kollias N et al., Br J Dermatol (2008) (DOI 10.1111/j.1365-2133.2008.08642.x, closed): diffuse-reflectance spectroscopy with specular (Fresnel) correction measures UV erythema and pigmentation "independently of the level of constitutive pigmentation" in 3 groups of 10 (fair/intermediate/dark); distinct absorbance spectra for each. Stamatas & Kollias, J Biomed Opt (2004) (DOI 10.1117/1.1647545, closed): deoxy-Hb pooling (pressure cuff) lowers L*a*b*"pigmentation" parameter like melanin; topical H2O2 blanching reduces deoxy-Hb, phototypes III-IV only. Clinical-practice sources (PMC12626340, CC BY) say erythema is under-recognised in Fitzpatrick IV-VI but give no a*/EI deltas.
- NOT FOUND: any open dataset giving a*/ erythema-index change for a physiological stimulus (exercise, heat, blushing, alcohol, niacin, cold) in Fitzpatrick V-VI. Treat flush at deep tone as an open measurement gap; the physically-motivated model is: haemoglobin absorption is attenuated by melanin (epidermal shielding), so the same vasodilation yields smaller a* change and a darker/warmer shift; most visible at low-melanin, high-blood sites (palms, lips, nail bed, ear, conjunctiva, areola). This is reasoning from the Hb/melanin model, not a measured effect size.

Magnitude of the underlying perfusion change (verifiable): cutaneous blood-flow capacity 7-8 L/min (300-400 mL/100 g/min) per a 2026 review (PMC13558791, CC BY-NC); Taylor/Machado-Moreira sweating paper (below). The classical Charkoudian 2003 (Mayo Clin Proc, DOI 10.4065/78.5.603, closed) reference was not opened.

### B3. Nipple erection and areolar contraction

| Source | Licence | Population / N | Measurement | Key numbers | Deep skin |
| --- | --- | --- | --- | --- | --- |
| Remy K et al., "Reinnervation of Free Nipple Grafts Associated With Improved Erection Function", Plast Reconstr Surg Glob Open 2025, DOI 10.1097/gox.0000000000006418 (PMC11730083) | CC BY-NC-ND | N=20 gender-affirming mastectomy with FREE nipple grafts (11 with nerve reconstruction, 9 controls), follow-up 16.8 +/- 7.0 mo | cold application with a thermal device, 3-D imaging of areola circumference and nipple height | Baseline free-graft areola circumference 73.9 +/- 9.4 mm, nipple height 4.5 +/- 1.3 mm. Cold-induced areola circumference change -4.16 +/- 3.3 mm (reinnervated) vs -1.67 +/- 1.9 mm (controls) = -5.6% vs -2.3%; nipple height change +0.86 +/- 0.8 vs +0.37 +/- 0.3 mm = +19% vs +8%. Self-reported erection 72.8% vs 38.9%. | NO / not stratified. These are partially denervated grafts, so INTACT response is larger (UNVERIFIED). |
| Smooth muscle tissue of the NAC, Acta Medica Medianae 2022, DOI 10.5633/amm.2022.0309 | CC BY | anatomy review | smooth muscle continuous across areola and nipple, functions as one unit; more developed in reproductive-age females | | |
| LeFevre (thesis), non-sexual nipple erection in response to anxiety-provoking material | thesis, OA | qualitative | | | |
| Masters & Johnson (1966) nipple erection in excitement phase | book, not accessed | | magnitudes UNVERIFIED | | |

Plus nipple vs areola tone structure (Motosko 2019 above). Triggers in the literature: cold (measured above), tactile stimulation, anxiety/arousal, lactation reflex.

### B4. Genital engorgement (clinical framing; magnitudes only)

| Source | Licence | Key numbers |
| --- | --- | --- |
| Veale D et al., "Am I normal? ... nomograms for flaccid and erect penis length and circumference in up to 15,521 men", BJU Int (2015), DOI 10.1111/bju.13010 | closed (abstract) | Flaccid pendulous length 9.16 (SD 1.57) cm [n=10,704]; stretched 13.24 (1.89) [n=14,160]; erect 13.12 (1.66) cm [n=692]; flaccid circumference 9.31 (0.90) cm [n=9,407]; erect 11.66 (1.10) cm [n=381]. Derived: erect/flaccid = +43% length, +25% circumference. Stretched flaccid length approximates erect length. |
| Penile circumference in the Chinese population measured by Rigiscan, Aging Male 2024, DOI 10.1080/13685538.2024.2417086 | CC BY-NC | N=803 of 1,134 reaching >=80% hardness; base 7.25 +/- 0.60 -> 9.70 +/- 0.65 cm, tip 7.20 -> 9.65 cm; +25.3% base, +25.5% tip |
| Italian N=4,685 (self-measured; Andrologia 2021, 10.1111/and.14053) | CC BY | flaccid 9.47 cm / circumference 9.59; erect 16.78 / 12.03 (self-measured, inflated vs clinician values) |
| Thermography after topical alprostadil, Sex Med 2016, 10.1016/j.esxm.2016.03.026 (PMC5005296) | CC BY-NC-ND | N=10 premenopausal women; vestibule, clitoris, vulva temperature rose significantly vs placebo within ~9-19 min (numeric deltas in Table 2, not extracted); drug-induced, not erotic |
| MRI of clitoral volume during arousal (J Urol 2005, 10.1097/01.ju.0000146643.00140.e3; Int J Impot Res 2007, 10.1038/sj.ijir.3901625; Schultz BMJ 1999, 10.1136/bmj.319.7225.1596) | closed | exist and quantify percent clitoral volume change; abstracts do not give the number (UNVERIFIED magnitude). Schultz: uterus raised and anterior vaginal wall lengthened, uterus size unchanged. |
| Scrotum: Sci Rep 2025 (10.1038/s41598-025-21699-8, CC BY): N=11 runners, 60 min treadmill, scrotal temperature rises at start while other skin sites fall, attributed to dartos/cremaster contraction (sympathetic) | CC BY | no surface-area change numbers; human cold-induced scrotal rugosity/surface-area numbers NOT FOUND (rat dartos TRPM8 paper only) |
| Vaginal photoplethysmography (VPA), Masters & Johnson | not retrieved | amplitude / clitoral and labial thickness and colour (sex flush, labial deepening) magnitudes UNVERIFIED; no measured colour-change data found |

### B5. Joint-angle wrinkling and how pipelines drive wrinkle maps

Measured skin deformation vs joint angle (the right driver signal):

- Local postural changes elicit extensive and diverse skin stretch around joints, on the trunk and the face, J R Soc Interface 22 (2025), DOI 10.1098/rsif.2024.0794 (PMC11835493), CC BY. N=15, quad-camera ink-speckle DIC, patches up to 369 cm2. Maximal knee flexion: >60% stretch at the knee, 10-20% on the upper thigh, still >10% 15-20 cm away; wrist flexion stretches forearm to near the elbow and compresses it orthogonally; neck tilt, fetal curl and side bend give large uniform trunk stretch; cheek puffing >25% near mouth. Compression axis (orthogonal) exists in the same fields. No skin-type stratification.
- In vivo measurement of skin surface strain and sub-surface layer deformation induced by natural tissue stretching (volar forearm), J Mech Behav Biomed Mater (2016; authors not recorded), DOI 10.1016/j.jmbbm.2016.05.035, CC BY. Arm angle 90 deg flexion -> 180 deg full extension: surface Lagrange strain +25% (typical), epidermal thickness -20%, DEJ undulation flattened 45-50%, surface roughness Ra/Rz -40-50% (case study, N not stated in abstract). Direction: extension flattens; flexion/compression restores roughness and folds.
- Korean body-site paper (A2): extended elbow/knee skin is darker and redder than folded.
- NOT FOUND: measured wrinkle (crease) depth or spacing vs joint angle at elbow/knee/knuckle/neck in vivo. Wrinkle profilometry papers focus on facial photo-ageing. Treat any depth or spacing numbers as art-directed parameters. Dark skin: no study examined differential creasing contrast.

Pipelines:

- Oat C, "Animated Wrinkle Maps", SIGGRAPH 2007 Advances in Real-Time Rendering course notes (advances.realtimerendering.com, copyrighted course notes): stretch and compress wrinkle normal maps, artist weight in [-1,1] per region via a mask texture; sign selects stretch vs compress map.
- Jimenez J, Echevarria JI, Oat C, Gutierrez D, "Practical and Realistic Facial Wrinkles Animation", GPU Pro 2, A K Peters/CRC 2011, pp. 15-27 (PDF read from graphics.unizar.es): generalises to N wrinkle maps with weight [0,1] each, one RGBA mask channel per zone (8 zones = 2 textures), weights per blend shape/expression (Table 1.1 gives per-expression zone weights, e.g. Joy 1.0/1.0/0.2/0.2/0/0/0/0, Anger -0.6/-0.6/-0.8/-0.8/0.8/0.8/1.0/0), summed and clamped to [0,1]; normals stored as partial-derivative normals so base+wrinkle blend is an add; memory 96 KB; shader 0.31/0.1/0.09 ms on GeForce 8600GT/9800GTX+/295GTX. Driver is BLEND-SHAPE weight, not bone rotation (copyright: cite only).
- Raman C, Hewitt C, Wood E, Baltrusaitis T, "Mesh-Tension Driven Expression-Based Wrinkles for Synthetic Faces", WACV 2023 (arXiv 2210.03529): formalises mesh-tension (edge-length ratio) to aggregate wrinkles from expression scans into albedo AND displacement maps and generalise to unseen expressions; the tension idea transfers directly to bone-driven body deformation (compute per-region tension from skinning, drive wrinkle-map weight). Licence: arXiv (check).
- Bone-rotation driving is community practice, not a published pipeline: gamedev.net thread (spine twist yaw remapped to [-1,+1] blends neutral and left/right wrinkled torso normal maps; per-vertex/bone weights as masks), TCD dissertation 2011-057 (skinning-weight-driven wrinkle maps near joints). Uncharted slides: wrinkle normal maps baked from sculpted poses on the in-game mesh, regions defined by tool. Unreal: curve-driven material parameters (animation-curve to material scalar of the same name) and Wrinkle Component plugin (morph-target values to normal map). UNVERIFIED primary documents for these.
- Related: Complex Wrinkle Fields (ACM TOG 2023, DOI 10.1145/3592397, CC BY) physical-ish wrinkle representation on coarse meshes; "A physics-based model for wrinkling skin" (UBC thesis 2016, 10.14288/1.0166733, CC BY-NC-ND) physics-based skin wrinkling by compression buckling.

### B6. Exertion / heat sweat sheen and vasodilation

| Source | Licence | Key numbers |
| --- | --- | --- |
| Taylor NAS, Machado-Moreira CA, "Regional variations in transepidermal water loss, eccrine sweat gland density, sweat secretion rates and electrolyte composition in resting and exercising humans", Extrem Physiol Med 2:4 (2013), DOI 10.1186/2046-7648-2-4 | CC BY | Insensible water loss: hands 80-160 g/h, feet 50-150, head and neck 40-75, others 15-60 g/h (1.8 m2 individual). Sweat gland density: highest on volar fingers 530 /cm2, lowest upper lip 16 /cm2; ~2.03 million glands. At whole-body 0.4 L/min passive heating: forehead 0.99, dorsal fingers 0.62, upper back 0.59 mg/cm2/min highest; medial thighs and anterior legs 0.12 lowest. Exercising: local rates rise strongly and become more homogeneous. |
| Smith CJ, Havenith G (2011) Body mapping of sweating patterns in male athletes, Eur J Appl Physiol, DOI 10.1007/s00421-010-1744-8; Body mapping of regional sweat distribution in young and older males (2020, 10.1007/s00421-020-04503-5, CC BY) | green / CC BY | regional sweat-rate maps exist; tables NOT opened, so no numbers from them are used here (UNVERIFIED) |
| PMC13558791 (2026 review, CC BY-NC) | CC BY-NC | cutaneous blood-flow capacity 7-8 L/min (300-400 mL/100 g/min), second only to muscle |
| Sci Rep 2025 scrotal temperature during running | CC BY | scrotal temperature rises immediately while other skin cools at running onset (vasoconstriction/pallor on trunk then flush after) |

Not found: measured specular/gloss (sheen) change from sweat, nor L*a*b*shift of wet vs dry skin by skin type, nor post-exercise facial a* deltas by skin type. Optical reasoning (UNVERIFIED as a measurement): a continuous water film raises surface specular and lowers diffuse L* of the stratum corneum (index matching), so sheen should be a roughness/specular-lobe + slight albedo darkening term driven by local sweat rate, with the highest sweat flow (hence strongest sheen) at forehead, dorsal fingers and upper back per the numbers above, and lowest at medial thighs/anterior legs. The sweat-rate map is the quantitative backbone; no skin-tone-specific data found.

---------------------------------------------------------------------------

## CROSS-CUTTING TAKEAWAYS FOR humanoid-kit

1. Palm/sole: implement as its own region with lightness compressed toward ~57 +/- 5 L*(JBO 2022) regardless of the melanin axis; Mexameter says MI ~0.5x forearm in a mixed light-skinned cohort; DKK1/melanocyte density provides the justification. The palm minus forearm L* gap is +1 (light) to +16 (L*~42 forearm) so the "deep end" is where the effect is biggest. Need an a*/b* source (not found).
2. Dorsal sites (knuckle/elbow/knee/neck-back): use ordinal data (extended > folded; back of neck, heel, elbow, popliteal) plus Alaluf's 1.6-2x melanin factor for exposed vs protected; deep-skin specific numbers do not exist in what I could reach.
3. Mucosal/thin-keratin regions (lips already, genital, areola, perianal): only qualitative and relative data; the nipple-vs-areola contrast has a measured sign (female nipple darker, male lighter) with Fitzpatrick dependence but only in uncalibrated photographs.
4. States are best parameterised by physiology you CAN verify: goosebump episode duration 9-13 s, raised follicle-scale papules ~0.15-0.2 mm (single device) at density 14-32 /cm2; nipple: areola circumference -2 to -6% and nipple height +8 to +19% with cold (free grafts, so lower bound); penile erect/flaccid +43% length, +25% circumference; sweat flow map; skin strain 25% (volar forearm extension) to >60% (knee flexion).
5. Highest-value follow-ups (can be done, not done here): (a) obtain Sommers 2008 per-site L*a*b*tables (vulvar epidermis, posterior fourchette, vaginal wall; N=63 black / 57 white); (b) check the hyperspectral facial database data release for per-position spectra across tones; (c) ask the JBO 2022 authors for palm a*,b*; (d) look for a Stephen et al. Table S1 (hand-perfusion CIELab axes) to seed a blood-flow colour vector, then scale by the melanin attenuation from ISSA spectra; (e) pull Smith & Havenith body-map tables; (f) read the NIST forearm CSV licence.

---------------------------------------------------------------------------

## PART C - What the state layers use (implementation, 2026-10-09)

Each magnitude in `src/surface/regions/states.ts` is either one of the sources
above (cited) or a choice (marked CHOICE, with what bounds it). Contact sheets
of the result: `docs/evidence/states.md`.

### C1. Goosebumps (`cold`, `fear`)

| Quantity | Value | Source |
| --- | --- | --- |
| Papule height at signal 1 | 194 µm (`GOOSEBUMP_HEIGHT`); signal 0.75 is 145 µm | Kim 2014, two episodes on one forearm (B1). Height scales linearly with the signal. |
| Papule density | 21 per cm² (`GOOSEBUMP_DENSITY_PER_CM2`), one bump per cell, spacing 2.18 mm | The geometric mean of follicle densities 14 (calf) to 32 (upper arm) per cm² (Otberg 2004, quoted in McPhetres 2024, B1). CHOICE: one density for the whole body, since a layer has one bump spacing. |
| Triggers | `cold` and `fear`, combined as 1 − (1 − cold)(1 − fear) | Thermal, tactile and audio-visual stimuli are equally effective (McPhetres 2024, B1). The union is a CHOICE. |
| Where | Body minus the head zone, palms, soles and areola | B1: arm, thigh and calf measured; "by construction not palms/soles/lips". CHOICE: the face and scalp are left out (no goosebumps are observed there). |
| How the zones are measured | Skin weights for zones, vertex normals for palm and sole, the existing areola disk | Base mesh data only; see ARCHITECTURE.md, "Skin states". |

### C2. Flush and pallor (`blush`, `exertion`, `heat`, `fear`, `cold`)

The measured part is the colour model, not the states: a state moves the skin
along the haemoglobin axis of `skinAlbedo`, whose a\* span for the whole axis is
5.2 (lightest) to 3.1 (deepest), calibrated to ISSA (SKIN-RENDERING.md). Melanin
attenuation is that model's, not a rule of the layers. No open data gives the
size of a physiological flush at any skin tone (B2), so every delta is a CHOICE
bounded by the axis.

| Quantity | Value | Source |
| --- | --- | --- |
| Delta (haemoglobin units; 1 = whole axis, a\* of about 5 on light skin) | blush +1, exertion +0.8, heat +0.6, fear −0.7, cold −0.6 (`FLUSH_DELTA`) | CHOICE, limited to ±1, the spread between people, and as large as that allows so a state reads on a full-length figure. Stephen et al. 2009 (B2): raters prefer faces about 2.4 a\* redder (half the axis). |
| Blush region | cheeks and ears 1, neck 0.8, forehead 0.7, chest 0.5 | Cheeks and forehead go deeper red in a compliment blush (Front Hum Neurosci 2017, B2). Ears, neck and chest: CHOICE. |
| Exertion region | face 1, neck 0.8, chest 0.7 | CHOICE; cutaneous vasodilation of exercise differs by region (Kondo et al. 1998, B6). |
| Heat region | the whole body | CHOICE: heat vasodilates skin everywhere. |
| Fear region | face 1, neck 0.8 | Facial blood flow falls with fright (B2). Weights: CHOICE. |
| Cold region | hands, feet, ears, nose 1; forearms, shins, cheeks 0.35 to 0.5 | CHOICE: vasoconstriction is strongest in acral skin. |
| Lips, `cold` | hue −40°, chroma × 0.65, lightness −5 at full signal (`lipStateAlbedo`) | CHOICE: cyanosis. No measurement at any tone. |
| Lips, `fear` | chroma × 0.55, lightness +3 | CHOICE: blood drawn away. |
| Colour that is not skin | no change | No haemoglobin to move. |

## ITEMS I COULD NOT VERIFY / PRIMARY NOT OPENED

- Masters & Johnson 1966 magnitudes; Maravilla MRI clitoral volume percentages; Veale full text; Charkoudian 2003 numbers; Hermanns 2000 primary; Otberg 2004 follicle densities (secondary only); Malaysian periorbital study (search-summary only); NIST dataset details (search-summary only); Kim 2014 volume/issue/page (APL 105, article number guessed as 013504 - treat as unverified; DOI 10.1063/1.4881888 is verified via Crossref); per-site numbers in Korean and Chinese body-map papers (figures only); any deep-skin (V-VI) erythema/a* magnitude for flush, exercise or blush.
