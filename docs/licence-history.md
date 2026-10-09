# MakeHuman licence history and the asset licence rule

Which MakeHuman assets humanoid-kit may pack as CC0, the rule the packer enforces (`scripts/lib/licenceRule.ts`), and the history behind it. Researched 2026-10-09.

## The governing rule

**Owner ruling, 2026-10-09:** "we shouldn't go beyond normal effort to assess CC0 versus AGPL. If the website says cc0 then it's cc0."

A community asset is CC0 exactly when its page on makehumancommunity.org states CC0. File headers, uuids, derivation and geometry are not weighed against the page. A MakeHuman team asset is CC0 when its files carry the header of MakeHuman's own 2020 CC0 release. Everything else is not packed.

Sources, all read on 2026-10-09 unless a date is given:

- `github.com/makehumancommunity/makehuman`, full history (first commit `20a2b13`, 2014-02-02, "Initial check-in (of MH alpha8 state)").
- `github.com/makehumancommunity/mhx2-makehuman-exchange`, through the GitHub API.
- The official static site: [What changed regarding the license in 2020?](https://static.makehumancommunity.org/oldsite/faq/what_changed_regarding_the_license_in_2020.html), [release notes 1.2.0](https://static.makehumancommunity.org/makehuman/releases/releases_120.html), [What do I need to do when I use a CC-BY asset?](https://static.makehumancommunity.org/oldsite/faq/what_do_i_need_to_do_when_i_use_a_ccby_asset.html), [Legal](https://static.makehumancommunity.org/oldsite/documentation/legal.html), [I have made a new asset… How can I contribute it?](https://static.makehumancommunity.org/oldsite/faq/i_have_made_a_new_asset_for_makehuman_how_can_i_contribute_it.html).
- The Wayback Machine's copies of [the license explanation](http://www.makehumancommunity.org/content/license_explanation.html), captured 2020-08-04 (`20200804030447`) and in 2023.
- Every asset page cited below, on `www.makehumancommunity.org`, by its URL and the "Submitted by … on …" line it shows.

## 1. Background: the cutover history

This history explains why bundled MakeHuman assets carry a CC0 header and community uploads carry their uploader's page licence. It does not decide any verdict below; the governing rule does.

| Date | Evidence | What it establishes |
| --- | --- | --- |
| 2014-02-07 | makehuman `b507d8e` (Manuel Bastioni): "…we say that MH output is CC0." | Before the cutover only **exports** were CC0; the assets were AGPL. |
| 2014-12-18 to 2015-09-20 | mhx2 `1318e7f` "Vulva" (Thomas Larsson); `47d86e4` 2015-09-19 "Added Manuel's genitalia proxies. Since these were released under GPL there should not be any legal problems with this."; `277c394` 2015-09-20 is the last change to `data/hm8/genitalia`. | MHX2's `penis2`/`vulva2` (Bastioni) and `vulva` (Larsson) are AGPL/GPL and were never touched again. |
| 2015-05-26 | The license explanation (captured 2020-08-04): "per 2015-05-26 the authoritative reference". On a third-party asset: "MakeHuman can only grant license exceptions to things which are MakeHuman's to begin with." | A community asset carries its author's licence, not MakeHuman's. |
| summer 2015 | FAQ: "Starting summer 2015, we are opening up contribution areas for user-created content." | The community repositories open. |
| 2015-09-15 / 2015-09-27 | [Adult Male Genitalia](http://www.makehumancommunity.org/proxy/adult_male_genitalia.html), [Adult Female Genitalia](http://www.makehumancommunity.org/proxy/adult_female_genitalia.html), [Adult Female Genitalia (old)](http://www.makehumancommunity.org/proxy/adult_female_genitalia_old.html): "Submitted by wolgade", "License: AGPL". A comment of 2016-12-13 names the male one "Adult Male Genitalia by Manuel Bastioni"; one of 2017-03-25 says "Standalone genitals came bundled with makehuman v1.0." | The detailed genital proxies are the team's MakeHuman 1.0 (Bastioni) proxies, re-published under **AGPL**. They are absent from the makehuman git history; the only genital mesh it ever held is `penis01`. |
| 2016-02-12 | `f6b431a` "Continue replacing headers: obj and mhclo files. Leaving files with other authors for now". 1 158 asset files gain "originally developed by Manuel Bastioni. The copyright was explicitly transfered to other team members in 2016" **and** "This file is licensed AGPLv3". | The 2016 transfer moved **ownership** to the team; the licence stayed AGPLv3. The transfer makes nothing CC0. |
| 2016-04-20 | `b2427cc` "Fix copyright headers for files that are/were owned by Thomas Larsson. This was cleared with him via mail." | Clears Larsson's files inside the makehuman repository only. |
| 2016-05-15 | `98c55cd` "Remove obsolete genitals data file. For genitals, look in the user asset repo for genital body proxies/alternate topologies" deletes `data/genitals/penis01/*` ("This file is licensed AGPLv3"). | `penis01` left the bundle four years before the cutover. |
| to 2020-09-26 | `LICENSE.md` (`f6b431a` 2016-02-12 through `6f8f751` 2019-01-06), section C: a CC0 option for exports from an official, unmodified MakeHuman "and/or b) the asset solely consists of a 2D binary image in PNG, BMP or JPG format." | Before the cutover the team already let its **images** (skins, textures) be used under CC0. |
| **2020-09-26** | **`bd0dafc` "Top level license texts"** adds `LICENSE.ASSETS.md` (CC0 1.0) and `LICENSE.CODE.md` (AGPL). `LICENSE.md` §C, "The license for the bundled assets": "The base mesh and proxies, Targets and modifiers, Textures, Clothes (any MHCLO-based asset), Poses and expressions … have been released under CC0 1.0 Universal." The same day: `911abb0` "Update license headers of target files", `3c701a8` "Update license headers of remaining assets". | **The cutover.** Every bundled asset gets the header "This asset was explicitly released as CC0 in september 2020". Code stays AGPL. |
| 2020-10-25, 2020-10-31 | `3a69edf`, `83e0321` "Missed a few files because Affero was written out instead of AGPL", `df25749` "Hunt down a few more places where the old asset license is mentioned". | An AGPL statement left in a **bundled** asset is a stale leftover. |
| 2020 | The 2020 FAQ: BEFORE "Assets are per default covered by AGPL", AFTER "Assets are per default released as CC0"; AFTER "Targets, proxies and the base mesh are considered graphical assets, covered by CC0"; AFTER "Targets are CC0 no matter how you got hold of them"; "if you find remaining strangenesses, particularly where assets are listed as AGPL, please report these." | The announcement. Retroactive for the team's assets. |
| **2020-11-06** | 1.2.0 release notes: "assets included with and produced by makehuman are CC0 no matter how you got hold of them." The 2023 capture of the license explanation is headed "no longer valid for MakeHuman 1.2.0 and later". | **MakeHuman 1.2.0** is the first release under the new licence. |
| current | "MakeHuman as such only includes CC0 assets… Specifically it does *not* apply to assets you downloaded separately from the user contributed asset respositories. In those repositories, you will find assets that come licensed in two forms: CC0 and CC-BY." `LICENSE.md` §D: "what is discussed here are only assets bundled in the MakeHuman distribution. If you use a third part asset… it is your own responsibility to make sure you abide by its specific license." | **The cutover did not relicense community uploads.** |
| 2026-10-09 | The wolgade/geyser genital proxy pages still say "License: AGPL". | The team never relabelled them. |

### What the cutover covers

- **CC0:** everything the makehuman distribution bundled from `bd0dafc` (2020-09-26) on, shipped in 1.2.0 (2020-11-06): base mesh, targets, bundled proxies and topologies, clothes, hair, skins, rigs, weights, poses, expressions; and copies of those files wherever they turn up ("no matter how you got hold of them").
- **Not covered:** team assets that were **not** in the bundle on 2020-09-26 (`penis01`; the MakeHuman 1.0 Bastioni genital proxies; the MHX2 `.mxa` proxies), and every community upload, which keeps its uploader's licence.
- **The 2016 transfer plus the 2020 release does not reach the Bastioni MHX2 proxies.** The transfer moved ownership and kept AGPLv3; the release covers bundled assets; `penis2.mxa`/`vulva2.mxa` live in another repository, state `"license": "AGPL3 (…makehuman_mesh_license.html)"` and were last changed 2015-09-20. The team could relicense them and has not. Larsson's `vulva.mxa` was never part of the transfer.
- **Code** stays AGPL-3; MPFB is GPL; the external tools (MakeClothes 1, MakeTarget) are AGPL 3 ("Unless otherwise explicitly stated they are covered by the GNU AGPL 3").

## 2. The rule in code

`judgeAsset` in `scripts/lib/licenceRule.ts` implements the governing rule; `compileAsset` applies it to every asset it packs, and `tests/licenceRule.test.ts` covers each clause.

- **A, team asset:** every text file carries "This asset was explicitly released as CC0", the header of MakeHuman's 2020-09-26 release. No page is needed, and without a captured page this is the only way through.
- **B, community asset:** the captured page (`CommunityPage`: URL, submitter, submission date, licence, retrieval date) states CC0. The licence must begin by naming CC0 ("CC0", "CC-0", "CC0 - Creative Commons Zero") and name no other licence; free text that merely mentions CC0 is not a CC0 licence.

A page licence of CC-BY or AGPL is not CC0, whatever the files say. When a pack's JSON manifest and the asset's page disagree, the page is what is captured and judged.

## 3. Verdicts that changed under the ruling

The page rule makes these CC0. An earlier review of the same assets read their file headers or lineage and held them back; the ruling sets that aside.

| Asset | Page | Page licence | Verdict |
| --- | --- | --- | --- |
| MTKnife `adult_female_genitalia_remapped` | <http://www.makehumancommunity.org/proxy/adult_female_genitalia_remapped.html>, 2017-07-28 | CC0 | **CC0** |
| XSuprem3X `adult_male_genitalia` | <http://www.makehumancommunity.org/proxy/adult_male_genitalia.html_0>, 2017-03-26 | CC0 | **CC0** |
| Slayer227 `erect_penis_only_works_with_males` (`Male_Gen-Heal1`) | <http://www.makehumancommunity.org/proxy/erect_penis_only_works_with_males.html>, 2022-01-06 | CC0 | **CC0** |
| bogdan666 `adult_female_2020` | <http://www.makehumancommunity.org/proxy/adult_female_2020.html>, 2019-11-17 | CC0 | **CC0** |
| ieroglif `adult_male_genitalia_breast_fix` | <http://www.makehumancommunity.org/proxy/adult_male_genitalia_breast_fix.html>, 2026-05-04 | CC0 | **CC0** |
| ukiyoe `man_genital` | <http://www.makehumancommunity.org/clothes/man_genital.html>, 2022-11-05 | CC0 | **CC0** |
| spreadcore Alana and Errol "with genitals" skins | <http://www.makehumancommunity.org/skin/alana_caucasian_female_with_genitals_skin.html>, 2022-03-05; <http://www.makehumancommunity.org/skin/errol_caucasian_male_with_genitals_skin.html>, 2022-03-09 | CC0 | **CC0** |
| FreezyChan Lucoa horns, JALdMIC houndoom horns | <http://www.makehumancommunity.org/node/1564>, 2018-07-21; <http://www.makehumancommunity.org/node/2995>, 2021-12-29 | CC0 | **CC0** |
| porky11 `penis_rig`, cortu hair and clothing, culturalibre hair 05/06, JALdMIC donkey head | see 4.1 and 4.2 | CC0 | **CC0** |

Still **not CC0**, because the page itself says otherwise:

| Asset | Page | Page licence |
| --- | --- | --- |
| wolgade "Adult Male Genitalia" | <http://www.makehumancommunity.org/proxy/adult_male_genitalia.html>, 2015-09-15 | AGPL |
| wolgade "Adult Female Genitalia" | <http://www.makehumancommunity.org/proxy/adult_female_genitalia.html>, 2015-09-15 | AGPL |
| wolgade "Adult Female Genitalia (old)" | <http://www.makehumancommunity.org/proxy/adult_female_genitalia_old.html>, 2015-09-27 | AGPL |
| geyser "Adult Female Genitalia (new) HEALED" | <http://www.makehumancommunity.org/proxy/adult_female_genitalia_new_healed.html>, 2017-10-14 | AGPL |
| culturalibre `hand_claws`, `hero_mask_5`, `hero_boots_4`, `heroine_boots_4` (listed CC0 in their packs) | see 4.1 | CC-BY |
| sureshkumar genital materials; 123guzhanhong123 anatomy skins | see 4.2 | CC-BY |

`penis01` and the MHX2 `.mxa` proxies have no community page; they are team assets outside the 2020 bundle and carry no CC0 header, so neither clause passes them.

## 4. Results

Every asset below was judged by the rule, as code, on 2026-10-09, from its live page. 4.1 covers the 63 page-and-file conflicts of the sourcing catalogue, the horn, beard and nail conflicts of the sourcing pass, and the `ears01` and `animal01` targets; 4.2 covers every genital and anatomy asset found on the site.

### 4.1 Catalogue conflicts, sourcing-pass conflicts and anthro targets

| asset | pack | page | submitted by, on | page licence | verdict |
| --- | --- | --- | --- | --- | --- |
| `culturalibre_faun_horns` | bodyparts01 | <http://www.makehumancommunity.org/node/2355> | culturalibre, 2020-03-19 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_minotaur_horns` | bodyparts01 | <http://www.makehumancommunity.org/node/2352> | culturalibre, 2020-03-16 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_faun_beard` | bodyparts05 | <http://www.makehumancommunity.org/node/2356> | culturalibre, 2020-03-19 | CC0 - Creative Commons Zero | **CC0** |
| `rehmanpolanski_beard_viking` | bodyparts05 | <http://www.makehumancommunity.org/node/2614> | RehmanPolanski, 2020-07-12 | CC0 - Creative Commons Zero | **CC0** |
| `rehmanpolanski_moustache_viking` | bodyparts05 | <http://www.makehumancommunity.org/node/2615> | RehmanPolanski, 2020-07-12 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hand_claws` | equipment01 | <http://www.makehumancommunity.org/node/2840> | culturalibre, 2021-02-26 | CC-BY - Creative Commons Attribution | **not CC0** |
| `culturalibre_hero_kalistick` | equipment01 | <http://www.makehumancommunity.org/node/2119> | culturalibre, 2020-01-19 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_kalistick_lefthanded` | equipment01 | <http://www.makehumancommunity.org/node/2120> | culturalibre, 2020-01-19 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_magic_sceptre` | equipment01 | <http://www.makehumancommunity.org/node/2358> | culturalibre, 2020-03-20 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_war_hammer` | equipment01 | <http://www.makehumancommunity.org/node/2051> | culturalibre, 2019-12-25 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_wooden_bow` | equipment01 | <http://www.makehumancommunity.org/node/2362> | culturalibre, 2020-03-20 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_doc_ock_glasses` | glasses01 | <http://www.makehumancommunity.org/node/2378> | culturalibre, 2020-03-29 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero-heroine_gloves_2` | gloves01 | <http://www.makehumancommunity.org/node/2093> | culturalibre, 2020-01-16 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero-heroine_gloves_3` | gloves01 | <http://www.makehumancommunity.org/node/2193> | culturalibre, 2020-02-07 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero-heroine_gloves_4` | gloves01 | <http://www.makehumancommunity.org/node/2333> | culturalibre, 2020-03-07 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero-heroine_gloves_5` | gloves01 | <http://www.makehumancommunity.org/node/2401> | culturalibre, 2020-04-01 | CC0 - Creative Commons Zero | **CC0** |
| `cortu_shaggy_green_hair` | hair01 | <http://www.makehumancommunity.org/node/2811> | Cortu, 2021-01-07 | CC0 - Creative Commons Zero | **CC0** |
| `cortu_short_messy_hair` | hair01 | <http://www.makehumancommunity.org/node/2809> | Cortu, 2021-01-07 | CC0 - Creative Commons Zero | **CC0** |
| `cortu_straight_bangs` | hair01 | <http://www.makehumancommunity.org/node/2810> | Cortu, 2021-01-07 | CC0 - Creative Commons Zero | **CC0** |
| `cortu_strawberry_cloud_hair` | hair01 | <http://www.makehumancommunity.org/node/2808> | Cortu, 2021-01-07 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hair_05` | hair01 | <http://www.makehumancommunity.org/node/2445> | culturalibre, 2020-04-06 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hair_06` | hair01 | <http://www.makehumancommunity.org/node/2479> | culturalibre, 2020-04-16 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero-heroine_hood_1` | masks01 | <http://www.makehumancommunity.org/node/2100> | culturalibre, 2020-01-18 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero-heroine_hood_2` | masks01 | <http://www.makehumancommunity.org/node/2309> | culturalibre, 2020-03-01 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_mask_1` | masks01 | <http://www.makehumancommunity.org/node/2055> | culturalibre, 2019-12-29 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_mask_2` | masks01 | <http://www.makehumancommunity.org/node/2049> | culturalibre, 2019-12-22 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_mask_3` | masks01 | <http://www.makehumancommunity.org/node/2202> | culturalibre, 2020-02-09 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_mask_4` | masks01 | <http://www.makehumancommunity.org/node/2220> | culturalibre, 2020-02-09 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_mask_5` | masks01 | <http://www.makehumancommunity.org/node/2396> | culturalibre, 2020-04-01 | CC-BY - Creative Commons Attribution | **not CC0** |
| `culturalibre_heroine_mask_1` | masks01 | <http://www.makehumancommunity.org/node/2474> | culturalibre, 2020-04-10 | CC0 - Creative Commons Zero | **CC0** |
| `cortu_cargo_pants` | pants01 | <http://www.makehumancommunity.org/node/2798> | Cortu, 2021-01-07 | CC0 - Creative Commons Zero | **CC0** |
| `cortu_jeans_shorts` | pants01 | <http://www.makehumancommunity.org/node/2800> | Cortu, 2021-01-07 | CC0 - Creative Commons Zero | **CC0** |
| `cortu_floppy_overknee_shoes` | shoes01 | <http://www.makehumancommunity.org/node/2803> | Cortu, 2021-01-07 | CC0 - Creative Commons Zero | **CC0** |
| `cortu_t-bar` | shoes01 | <http://www.makehumancommunity.org/node/2801> | Cortu, 2021-01-07 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_boots_1` | shoes01 | <http://www.makehumancommunity.org/node/2081> | culturalibre, 2020-01-15 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_boots_2` | shoes01 | <http://www.makehumancommunity.org/node/2132> | culturalibre, 2020-01-21 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_boots_3` | shoes01 | <http://www.makehumancommunity.org/node/2138> | culturalibre, 2020-01-21 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_boots_4` | shoes01 | <http://www.makehumancommunity.org/node/2167> | culturalibre, 2020-01-31 | CC-BY - Creative Commons Attribution | **not CC0** |
| `culturalibre_hero_boots_5` | shoes01 | <http://www.makehumancommunity.org/node/2424> | culturalibre, 2020-04-03 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_heroine_boots_1` | shoes01 | <http://www.makehumancommunity.org/node/2155> | culturalibre, 2020-01-26 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_heroine_boots_2` | shoes01 | <http://www.makehumancommunity.org/node/2181> | culturalibre, 2020-02-07 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_heroine_boots_3` | shoes01 | <http://www.makehumancommunity.org/node/2187> | culturalibre, 2020-02-07 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_heroine_boots_4` | shoes01 | <http://www.makehumancommunity.org/node/2464> | culturalibre, 2020-04-10 | CC-BY - Creative Commons Attribution | **not CC0** |
| `culturalibre_male_boots` | shoes01 | <http://www.makehumancommunity.org/node/2548> | culturalibre, 2020-05-24 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_suit_1` | suits02 | <http://www.makehumancommunity.org/node/2061> | culturalibre, 2020-01-14 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_suit_2` | suits02 | <http://www.makehumancommunity.org/node/2292> | culturalibre, 2020-02-28 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_hero_suit_3` | suits02 | <http://www.makehumancommunity.org/node/2308> | culturalibre, 2020-03-01 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_heroine_suit_2` | suits02 | <http://www.makehumancommunity.org/node/2317> | culturalibre, 2020-03-04 | CC0 - Creative Commons Zero | **CC0** |
| `rehmanpolanski_viking_boots` | suits02 | <http://www.makehumancommunity.org/node/2619> | RehmanPolanski, 2020-07-12 | CC0 - Creative Commons Zero | **CC0** |
| `rehmanpolanski_viking_pants` | suits02 | <http://www.makehumancommunity.org/node/2618> | RehmanPolanski, 2020-07-12 | CC0 - Creative Commons Zero | **CC0** |
| `rehmanpolanski_viking_tunic` | suits02 | <http://www.makehumancommunity.org/node/2617> | RehmanPolanski, 2020-07-12 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_armsleeves_black_fishnet_large` | underwear01 | <http://www.makehumancommunity.org/node/305> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_armsleeves_black_fishnet_medium` | underwear01 | <http://www.makehumancommunity.org/node/304> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_armsleeves_black_fishnet_small` | underwear01 | <http://www.makehumancommunity.org/node/303> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_armsleeves_white_fishnet_large` | underwear01 | <http://www.makehumancommunity.org/node/302> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_armsleeves_white_fishnet_medium` | underwear01 | <http://www.makehumancommunity.org/node/301> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_armsleeves_white_fishnet_small` | underwear01 | <http://www.makehumancommunity.org/node/300> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_stockings_black_fishnet_large` | underwear01 | <http://www.makehumancommunity.org/node/296> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_stockings_black_fishnet_medium` | underwear01 | <http://www.makehumancommunity.org/node/295> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_stockings_black_fishnet_small` | underwear01 | <http://www.makehumancommunity.org/node/294> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_stockings_white_fishnet_large` | underwear01 | <http://www.makehumancommunity.org/node/299> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_stockings_white_fishnet_medium` | underwear01 | <http://www.makehumancommunity.org/node/298> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `v0rt3x_stockings_white_fishnet_small` | underwear01 | <http://www.makehumancommunity.org/node/297> | V0rT3X, 2016-05-11 | CC0 - Creative Commons Zero | **CC0** |
| `freezychan_lucoa_quetzalcoatl_horns` | bodyparts01 | <http://www.makehumancommunity.org/node/1564> | FreezyChan, 2018-07-21 | CC0 - Creative Commons Zero | **CC0** |
| `jaldmic_houndoom_horns` | bodyparts01 | <http://www.makehumancommunity.org/node/2995> | JALdMIC, 2021-12-29 | CC0 - Creative Commons Zero | **CC0** |
| `grinsegold_fingernails_female_natural` | bodyparts04 | <http://www.makehumancommunity.org/node/195> | grinsegold, 2015-12-29 | CC0 - Creative Commons Zero | **CC0** |
| `grinsegold_beard_sigmund_wip` | bodyparts05 | <http://www.makehumancommunity.org/node/877> | grinsegold, 2017-07-19 | CC0 - Creative Commons Zero | **CC0** |
| `wdg_scruffy_beard` | bodyparts05 | <http://www.makehumancommunity.org/node/1769> | WDG, 2019-02-03 | CC0 - Creative Commons Zero | **CC0** |
| `elvs_ear_flap_bottom_out` | ears01 | <http://www.makehumancommunity.org/node/2782> | Elvaerwyn, 2021-01-04 | CC0 - Creative Commons Zero | **CC0** |
| `elvs_flap_ears_1` | ears01 | <http://www.makehumancommunity.org/node/2779> | Elvaerwyn, 2021-01-04 | CC0 - Creative Commons Zero | **CC0** |
| `elvs_flap_ears_2` | ears01 | <http://www.makehumancommunity.org/node/2780> | Elvaerwyn, 2021-01-04 | CC0 - Creative Commons Zero | **CC0** |
| `elvs_flap_ears_3` | ears01 | <http://www.makehumancommunity.org/node/2781> | Elvaerwyn, 2021-01-04 | CC0 - Creative Commons Zero | **CC0** |
| `jujube_ear_canal` | ears01 | <http://www.makehumancommunity.org/node/612> | jujube, 2017-02-04 | CC0 - Creative Commons Zero | **CC0** |
| `mindfront_ear_details` | ears01 | <http://www.makehumancommunity.org/node/1588> | Mindfront, 2018-08-31 | CC0 - Creative Commons Zero | **CC0** |
| `mindfront_ear_in` | ears01 | <http://www.makehumancommunity.org/node/1589> | Mindfront, 2018-08-31 | CC0 - Creative Commons Zero | **CC0** |
| `rehmanpolanski_ear_flatten` | ears01 | <http://www.makehumancommunity.org/node/2624> | RehmanPolanski, 2020-07-12 | CC0 - Creative Commons Zero | **CC0** |
| `culturalibre_faun_face` | animal01 | <http://www.makehumancommunity.org/node/2357> | culturalibre, 2020-03-19 | CC0 - Creative Commons Zero | **CC0** |
| `elvs_piggy_nose1` | animal01 | <http://www.makehumancommunity.org/node/2372> | Elvaerwyn, 2020-03-28 | CC0 - Creative Commons Zero | **CC0** |
| `jaldmic_donkey_head` | animal01 | <http://www.makehumancommunity.org/node/3535> | JALdMIC, 2024-03-31 | CC0 - Creative Commons Zero | **CC0** |
| `jaldmic_equinus_headv2` | animal01 | <http://www.makehumancommunity.org/node/2952> | JALdMIC, 2021-10-21 | CC0 - Creative Commons Zero | **CC0** |
| `titleknown_catgirl_ears` | animal01 | <http://www.makehumancommunity.org/node/1153> | titleknown, 2017-11-19 | CC0 - Creative Commons Zero | **CC0** |

### 4.2 Genital and anatomy assets on the community site

| asset | pack | page | submitted by, on | page licence | verdict |
| --- | --- | --- | --- | --- | --- |
| `adult_female_2020` | single asset | <http://www.makehumancommunity.org/proxy/adult_female_2020.html> | bogdan666, 2019-11-17 | CC0 - Creative Commons Zero | **CC0** |
| `adult_female_genitalia_remapped` | single asset | <http://www.makehumancommunity.org/proxy/adult_female_genitalia_remapped.html> | MTKnife, 2017-07-28 | CC0 - Creative Commons Zero | **CC0** |
| `adult_male_genitalia_breast_fix` | single asset | <http://www.makehumancommunity.org/proxy/adult_male_genitalia_breast_fix.html> | ieroglif, 2026-05-04 | CC0 - Creative Commons Zero | **CC0** |
| `adult_male_genitalia_xsuprem3x` | single asset | <http://www.makehumancommunity.org/proxy/adult_male_genitalia.html_0> | XSuprem3X, 2017-03-26 | CC0 - Creative Commons Zero | **CC0** |
| `erect_penis_only_works_with_males` | single asset | <http://www.makehumancommunity.org/proxy/erect_penis_only_works_with_males.html> | Slayer227, 2022-01-06 | CC0 - Creative Commons Zero | **CC0** |
| `female_generic_with_simplified_genitals` | single asset | <http://www.makehumancommunity.org/proxy/female_generic_with_simplified_genitals.html> | wolgade, 2017-04-04 | CC0 - Creative Commons Zero | **CC0** |
| `female_generic_with_simplified_genitals_fixed` | single asset | <http://www.makehumancommunity.org/proxy/female_generic_with_simplified_genitals_fixed.html> | spamrakuen, 2023-05-05 | CC0 - Creative Commons Zero | **CC0** |
| `female_less_muscular_with_simplified_genitals` | single asset | <http://www.makehumancommunity.org/proxy/female_less_muscular_with_simplified_genitals.html> | wolgade, 2016-09-20 | CC0 - Creative Commons Zero | **CC0** |
| `female_muscular_with_simplified_genitals` | single asset | <http://www.makehumancommunity.org/proxy/female_muscular_with_simplified_genitals.html> | wolgade, 2016-06-13 | CC0 - Creative Commons Zero | **CC0** |
| `simple_penis` | single asset | <http://www.makehumancommunity.org/proxy/simple_penis.html> | porky11, 2018-02-24 | CC0 - Creative Commons Zero | **CC0** |
| `man_genital` | single asset | <http://www.makehumancommunity.org/clothes/man_genital.html> | ukiyoe, 2022-11-05 | CC0 - Creative Commons Zero | **CC0** |
| `realisticlabialonger` | single asset | <http://www.makehumancommunity.org/clothes/realisticlabialonger.html> | beebo123, 2022-04-15 | CC0 - Creative Commons Zero | **CC0** |
| `realisticlabiamedium` | single asset | <http://www.makehumancommunity.org/clothes/realisticlabiamedium.html> | beebo123, 2022-04-15 | CC0 - Creative Commons Zero | **CC0** |
| `realisticlabiashorter` | single asset | <http://www.makehumancommunity.org/clothes/realisticlabiashorter.html> | beebo123, 2022-04-15 | CC0 - Creative Commons Zero | **CC0** |
| `anus_deep` | single asset | <http://www.makehumancommunity.org/target/anus_deep.html> | frankyaye, 2015-07-25 | CC0 - Creative Commons Zero | **CC0** |
| `anus_small_length` | single asset | <http://www.makehumancommunity.org/target/anus_small_length.html> | frankyaye, 2015-07-25 | CC0 - Creative Commons Zero | **CC0** |
| `anus_small_width` | single asset | <http://www.makehumancommunity.org/target/anus_small_width.html> | frankyaye, 2015-07-25 | CC0 - Creative Commons Zero | **CC0** |
| `balls_round` | single asset | <http://www.makehumancommunity.org/target/balls_round.html> | jujube, 2017-01-15 | CC0 - Creative Commons Zero | **CC0** |
| `cold_balls` | single asset | <http://www.makehumancommunity.org/target/cold_balls.html> | porky11, 2018-02-24 | CC0 - Creative Commons Zero | **CC0** |
| `vulva_deep_low_for_adult_female_genetialia` | single asset | <http://www.makehumancommunity.org/target/vulva_deep_low_for_adult_female_genetialia.html> | frankyaye, 2015-07-25 | CC0 - Creative Commons Zero | **CC0** |
| `vulva_deep_middle_for_adult_female_genetialia` | single asset | <http://www.makehumancommunity.org/target/vulva_deep_middle_for_adult_female_genetialia.html> | frankyaye, 2015-07-25 | CC0 - Creative Commons Zero | **CC0** |
| `vulva_deep_top_for_adult_female_genetialia` | single asset | <http://www.makehumancommunity.org/target/vulva_deep_top_for_adult_female_genetialia.html> | frankyaye, 2015-07-25 | CC0 - Creative Commons Zero | **CC0** |
| `vulva_narrow_for_adult_female_genetialia` | single asset | <http://www.makehumancommunity.org/target/vulva_narrow_for_adult_female_genetialia.html> | frankyaye, 2015-07-25 | CC0 - Creative Commons Zero | **CC0** |
| `vulva_short_for_adult_female_genetialia` | single asset | <http://www.makehumancommunity.org/target/vulva_short_for_adult_female_genetialia.html> | frankyaye, 2015-07-25 | CC0 - Creative Commons Zero | **CC0** |
| `penis_rig` | single asset | <http://www.makehumancommunity.org/content/penis_rig.html> | porky11, 2018-02-24 | CC0 - Creative Commons Zero | **CC0** |
| `african_middle_age_muscular_genitals_male` | single asset | <http://www.makehumancommunity.org/content/african_middle_age_muscular_genitals_male.html> | sureshkumar, 2022-09-02 | CC-BY - Creative Commons Attribution | **not CC0** |
| `middle_age_african_male_and_genitals` | single asset | <http://www.makehumancommunity.org/content/middle_age_african_male_and_genitals.html> | sureshkumar, 2022-09-02 | CC-BY - Creative Commons Attribution | **not CC0** |
| `alana_caucasian_female_with_genitals_skin` | single asset | <http://www.makehumancommunity.org/skin/alana_caucasian_female_with_genitals_skin.html> | spreadcore, 2022-03-05 | CC0 - Creative Commons Zero | **CC0** |
| `anatomy_of_female_skin` | single asset | <http://www.makehumancommunity.org/skin/anatomy_of_female_skin.html> | 123guzhanhong123, 2020-12-07 | CC-BY - Creative Commons Attribution | **not CC0** |
| `errol_caucasian_male_with_genitals_skin` | single asset | <http://www.makehumancommunity.org/skin/errol_caucasian_male_with_genitals_skin.html> | spreadcore, 2022-03-09 | CC0 - Creative Commons Zero | **CC0** |
| `female_anatomy` | single asset | <http://www.makehumancommunity.org/skin/female_anatomy.html> | 123guzhanhong123, 2021-12-12 | CC-BY - Creative Commons Attribution | **not CC0** |
| `female_anatomy_substance_painter_manufacturing_operation` | single asset | <http://www.makehumancommunity.org/skin/female_anatomy_substance_painter_manufacturing_operation.html> | 123guzhanhong123, 2021-12-12 | CC-BY - Creative Commons Attribution | **not CC0** |
| `genuine_caucasian_female_with_genitals_paths_fixed` | single asset | <http://www.makehumancommunity.org/skin/genuine_caucasian_female_with_genitals_paths_fixed.html> | saltycowdawg, 2019-11-25 | CC0 - Creative Commons Zero | **CC0** |
| `middleage_african_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_african_female_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `middleage_african_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_african_male_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `middleage_asian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_asian_female_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `middleage_asian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_asian_male_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `middleage_caucasian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_caucasian_female_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `middleage_caucasian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_caucasian_male_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `middleage_slavic_male_with_genitals_and_beard` | single asset | <http://www.makehumancommunity.org/skin/middleage_slavic_male_with_genitals_and_beard.html> | jartur69, 2018-06-02 | CC0 - Creative Commons Zero | **CC0** |
| `old_african_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_african_female_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `old_african_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_african_male_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `old_asian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_asian_female_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `old_asian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_asian_male_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `old_caucasian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_caucasian_female_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `old_caucasian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_caucasian_male_with_genitals.html> | wolgade, 2015-09-27 | CC0 - Creative Commons Zero | **CC0** |
| `old_slavic_male_with_genitals_and_beard` | single asset | <http://www.makehumancommunity.org/skin/old_slavic_male_with_genitals_and_beard.html> | jartur69, 2018-06-02 | CC0 - Creative Commons Zero | **CC0** |
| `young_african_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_african_female_with_genitals.html> | wolgade, 2015-09-15 | CC0 - Creative Commons Zero | **CC0** |
| `young_african_female_with_genitals_use_instructions` | single asset | <http://www.makehumancommunity.org/skin/young_african_female_with_genitals_use_instructions.html> | Theomatics, 2021-04-29 | CC0 - Creative Commons Zero | **CC0** |
| `young_african_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_african_male_with_genitals.html> | wolgade, 2015-09-15 | CC0 - Creative Commons Zero | **CC0** |
| `young_asian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_asian_female_with_genitals.html> | wolgade, 2015-09-15 | CC0 - Creative Commons Zero | **CC0** |
| `young_asian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_asian_male_with_genitals.html> | wolgade, 2015-09-15 | CC0 - Creative Commons Zero | **CC0** |
| `young_caucasian_female2_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_caucasian_female2_with_genitals.html> | wolgade, 2015-09-15 | CC0 - Creative Commons Zero | **CC0** |
| `young_caucasian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_caucasian_female_with_genitals.html> | wolgade, 2015-09-15 | CC0 - Creative Commons Zero | **CC0** |
| `young_caucasian_female_with_genuine_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_caucasian_female_with_genuine_genitals.html> | oversword, 2016-01-02 | CC0 - Creative Commons Zero | **CC0** |
| `young_caucasian_male2_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_caucasian_male2_with_genitals.html> | wolgade, 2015-09-15 | CC0 - Creative Commons Zero | **CC0** |
| `young_caucasian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_caucasian_male_with_genitals.html> | wolgade, 2015-09-15 | CC0 - Creative Commons Zero | **CC0** |
| `young_filipina_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_filipina_female_with_genitals.html> | saltycowdawg, 2019-11-06 | CC0 - Creative Commons Zero | **CC0** |

## 5. Adding a community asset

1. Open its page on makehumancommunity.org and capture a `CommunityPage`: the URL, the "Submitted by … on …" line, the licence exactly as the page states it, and the date you read it.
2. Pass the record as `compileAsset(file, id, kind, { page })`. The packer packs it when the page licence is CC0 and refuses it otherwise; each packed file's evidence names the page and its submission date.
