# MakeHuman licence history and the asset licence rule

Which MakeHuman assets humanoid-kit may pack as CC0, the rule the packer enforces (`scripts/lib/licenceRule.ts`), and the history behind it. Researched 2026-10-09.

## The governing rule

**Owner ruling, 2026-10-09:** "we shouldn't go beyond normal effort to assess CC0 versus AGPL. If the website says cc0 then it's cc0."

**Owner ruling, 2026-10-09, later the same day:** "a cc0 mesh with a agpl proxy is not a reason to reject... Proxies are much easier to swap in and out than meshes."

A community asset is CC0 when its page on makehumancommunity.org states CC0. File headers, uuids, derivation and geometry are not weighed against the page. An asset whose page does not say CC0 is still usable when its mesh (the `.obj`) is CC0 by its own file header: a binding file that is not CC0 (`.mhclo`, `.proxy`, `.mhskel`, `.mhw`) is never shipped, and the packer rebuilds the binding from the mesh against humanoid-kit's own base; a material or texture that is not CC0 is left out. A MakeHuman team asset is CC0 when its files carry the header of MakeHuman's own 2020 CC0 release. Everything else is not packed.

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

- **M, CC0 mesh:** the page does not say CC0 (or no page was captured), but every `.obj` of the asset states CC0 in its own header, the 2020 team header or a `license CC0` line. A binding file that is not CC0 is listed for regeneration: `compileAsset` then needs the base body (`body`), binds every mesh vertex to its nearest base triangle (`bindToBody`, the same clean-room binder the procedural hair uses), and takes nothing from the binding file but the names of the mesh and material, not even its name, z-depth, axis scales or hidden vertices. Materials and textures that are not CC0 on their own are left out, and the asset packs with the default material. `tests/compileLicence.test.ts` packs a CC0 `.obj` under an AGPL binding and checks that none of the binding's values reaches the packed bytes.

A page licence of CC-BY or AGPL does not pass B; such an asset passes only on its own CC0 mesh (M). When a pack's JSON manifest and the asset's page disagree, the page is what is captured and judged.

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

The mesh ruling does not reach them either. The four AGPL proxies' own `.obj` files say `# author MHteam` / `# license AGPL3 (…)`, or nothing (geyser's healed `.obj`), read from the downloads on 2026-10-09; the four culturalibre `.obj` files carry MakeClothes 1's AGPL3 default; the CC-BY materials and skins have no mesh.

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

### 4.3 Every earlier reject, re-judged under both rulings

On 2026-10-09 every asset in every MakeHuman pack downloaded for humanoid-kit (`animal01`–`04`, `bodyparts01`–`05`, `cheek01`, `dress01`, `ears01`, `equipment01`, `eyebrows01`, `eyelashes01`, `glasses01`, `gloves01`, `hair01`–`03`, `hats01`, `masks01`, `pants01`, `shirts01`, `shoes01`, `skins01`–`03`, `skirts01`, `suits01`–`02`, `system_eye_materials01`–`03`, `system_hair_materials01`, `underwear01`, `underwear04`, `makehuman2_additional`: 457 assets, 451 with a live page), every single genital asset and the four AGPL-paged genital proxies was run through `judgeAsset`. The table lists each one the earlier file-based catalogue had rejected (neither MakeHuman's 2020 header on every file nor a CC0 line in both binding and mesh) and that is usable now: 283 assets.

**The mesh ruling unlocks none of them on its own.** Every asset whose page does not say CC0 also has a mesh that is not CC0: 54 have no mesh (CC-BY skins, eye and hair materials), 21 have an `.obj` carrying MakeClothes 1's AGPL3 default under a CC-BY page, 37 have an `.obj` that itself says CC-BY, and the four AGPL-paged genital proxies' `.obj` files say AGPL or nothing. The six assets with a CC0 `.obj` and no readable page (Joel Palmius' crude series) already passed. Every row below passes on its page (clause B); the "header says AGPL" note marks a file whose own header disagrees with the page, which the page ruling ships as it is. The gate's clause M stays in place for meshes found later.

Lane is assigned from the pack and category: skins and eye materials match none of the six lanes and are marked unassigned.

| asset | pack | page | page licence | clause | CC0 file(s) | AGPL / non-CC0 binding, regenerated | lane |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `adult_female_2020` | single asset | <http://www.makehumancommunity.org/proxy/adult_female_2020.html> | CC0 | B | all, by page | none required; header says AGPL: adult_female_2020_v_01.proxy | adult |
| `adult_female_genitalia_remapped` | single asset | <http://www.makehumancommunity.org/proxy/adult_female_genitalia_remapped.html> | CC0 | B | all, by page | none required; header says AGPL: adult_female_genitalia_remapped.proxy | adult |
| `adult_male_genitalia_breast_fix` | single asset | <http://www.makehumancommunity.org/proxy/adult_male_genitalia_breast_fix.html> | CC0 | B | all, by page | none | adult |
| `adult_male_genitalia_xsuprem3x` | single asset | <http://www.makehumancommunity.org/proxy/adult_male_genitalia.html_0> | CC0 | B | all, by page | none required; header says AGPL: adult_male_genitalia.obj, adult_male_genitalia.proxy | adult |
| `alana_caucasian_female_with_genitals_skin` | single asset | <http://www.makehumancommunity.org/skin/alana_caucasian_female_with_genitals_skin.html> | CC0 | B | all, by page | none | adult |
| `anus_deep` | single asset | <http://www.makehumancommunity.org/target/anus_deep.html> | CC0 | B | all, by page | none | adult |
| `anus_small_length` | single asset | <http://www.makehumancommunity.org/target/anus_small_length.html> | CC0 | B | all, by page | none | adult |
| `anus_small_width` | single asset | <http://www.makehumancommunity.org/target/anus_small_width.html> | CC0 | B | all, by page | none | adult |
| `balls_round` | single asset | <http://www.makehumancommunity.org/target/balls_round.html> | CC0 | B | all, by page | none | adult |
| `cold_balls` | single asset | <http://www.makehumancommunity.org/target/cold_balls.html> | CC0 | B | all, by page | none | adult |
| `errol_caucasian_male_with_genitals_skin` | single asset | <http://www.makehumancommunity.org/skin/errol_caucasian_male_with_genitals_skin.html> | CC0 | B | all, by page | none | adult |
| `genuine_caucasian_female_with_genitals_paths_fixed` | single asset | <http://www.makehumancommunity.org/skin/genuine_caucasian_female_with_genitals_paths_fixed.html> | CC0 | B | all, by page | none | adult |
| `jartur69_middleage_slavic_male_with_genitals_and_beard` | skins02 | <http://www.makehumancommunity.org/node/1508> | CC0 | B | all, by page | none | adult |
| `jartur69_old_slavic_male_with_genitals_and_beard` | skins02 | <http://www.makehumancommunity.org/node/1507> | CC0 | B | all, by page | none | adult |
| `middleage_african_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_african_female_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `middleage_african_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_african_male_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `middleage_asian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_asian_female_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `middleage_asian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_asian_male_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `middleage_caucasian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_caucasian_female_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `middleage_caucasian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/middleage_caucasian_male_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `middleage_slavic_male_with_genitals_and_beard` | single asset | <http://www.makehumancommunity.org/skin/middleage_slavic_male_with_genitals_and_beard.html> | CC0 | B | all, by page | none | adult |
| `old_african_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_african_female_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `old_african_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_african_male_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `old_asian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_asian_female_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `old_asian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_asian_male_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `old_caucasian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_caucasian_female_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `old_caucasian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/old_caucasian_male_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `old_slavic_male_with_genitals_and_beard` | single asset | <http://www.makehumancommunity.org/skin/old_slavic_male_with_genitals_and_beard.html> | CC0 | B | all, by page | none | adult |
| `penis_rig` | single asset | <http://www.makehumancommunity.org/content/penis_rig.html> | CC0 | B | all, by page | none | adult |
| `saltycowdawg_genuine_caucasian_female_with_genitals` | skins01 | <http://www.makehumancommunity.org/node/2024> | CC0 | B | all, by page | none | adult |
| `simple_penis` | single asset | <http://www.makehumancommunity.org/proxy/simple_penis.html> | CC0 | B | all, by page | none required; header says AGPL: simple_penis.obj, simple_penis.proxy | adult |
| `spreadcore_alana_caucasian_female_with_genitals_skin` | skins01 | <http://www.makehumancommunity.org/node/3113> | CC0 | B | all, by page | none | adult |
| `vulva_deep_low_for_adult_female_genetialia` | single asset | <http://www.makehumancommunity.org/target/vulva_deep_low_for_adult_female_genetialia.html> | CC0 | B | all, by page | none | adult |
| `vulva_deep_middle_for_adult_female_genetialia` | single asset | <http://www.makehumancommunity.org/target/vulva_deep_middle_for_adult_female_genetialia.html> | CC0 | B | all, by page | none | adult |
| `vulva_deep_top_for_adult_female_genetialia` | single asset | <http://www.makehumancommunity.org/target/vulva_deep_top_for_adult_female_genetialia.html> | CC0 | B | all, by page | none | adult |
| `vulva_narrow_for_adult_female_genetialia` | single asset | <http://www.makehumancommunity.org/target/vulva_narrow_for_adult_female_genetialia.html> | CC0 | B | all, by page | none | adult |
| `vulva_short_for_adult_female_genetialia` | single asset | <http://www.makehumancommunity.org/target/vulva_short_for_adult_female_genetialia.html> | CC0 | B | all, by page | none | adult |
| `young_african_female_with_genitals_use_instructions` | single asset | <http://www.makehumancommunity.org/skin/young_african_female_with_genitals_use_instructions.html> | CC0 | B | all, by page | none | adult |
| `young_african_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_african_female_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `young_african_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_african_male_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `young_asian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_asian_female_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `young_asian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_asian_male_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `young_caucasian_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_caucasian_female_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `young_caucasian_female_with_genuine_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_caucasian_female_with_genuine_genitals.html> | CC0 | B | all, by page | none | adult |
| `young_caucasian_female2_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_caucasian_female2_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `young_caucasian_male_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_caucasian_male_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `young_caucasian_male2_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_caucasian_male2_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `young_filipina_female_with_genitals` | single asset | <http://www.makehumancommunity.org/skin/young_filipina_female_with_genitals.html> | CC0 | B | all, by page | none | adult |
| `culturalibre_faun_beard` | bodyparts05 | <http://www.makehumancommunity.org/node/2356> | CC0 | B | all, by page | none required; header says AGPL: faun_beard.obj | bodyhair |
| `grinsegold_beard_sigmund_wip` | bodyparts05 | <http://www.makehumancommunity.org/node/877> | CC0 | B | all, by page | none required; header says AGPL: grinsegold_beard_sigmund_wip.mhclo, beard_sigmund.obj | bodyhair |
| `rehmanpolanski_beard_viking` | bodyparts05 | <http://www.makehumancommunity.org/node/2614> | CC0 | B | all, by page | none required; header says AGPL: beardviking.obj | bodyhair |
| `rehmanpolanski_moustache_viking` | bodyparts05 | <http://www.makehumancommunity.org/node/2615> | CC0 | B | all, by page | none required; header says AGPL: moustacheviking.obj | bodyhair |
| `wdg_scruffy_beard` | bodyparts05 | <http://www.makehumancommunity.org/node/1769> | CC0 | B | all, by page | none required; header says AGPL: wdg_scruffy_beard.mhclo, scruffy_beard.obj | bodyhair |
| `cortu_cargo_pants` | pants01 | <http://www.makehumancommunity.org/node/2798> | CC0 | B | all, by page | none required; header says AGPL: cargo_pants.obj | clothing |
| `cortu_floppy_overknee_shoes` | shoes01 | <http://www.makehumancommunity.org/node/2803> | CC0 | B | all, by page | none required; header says AGPL: floppy_overknee_shoe.obj | clothing |
| `cortu_jeans_shorts` | pants01 | <http://www.makehumancommunity.org/node/2800> | CC0 | B | all, by page | none required; header says AGPL: jean_shorts.obj | clothing |
| `cortu_t-bar` | shoes01 | <http://www.makehumancommunity.org/node/2801> | CC0 | B | all, by page | none required; header says AGPL: tbar.obj | clothing |
| `culturalibre_doc_ock_glasses` | glasses01 | <http://www.makehumancommunity.org/node/2378> | CC0 | B | all, by page | none required; header says AGPL: doc_ock_glasses.obj | clothing |
| `culturalibre_hero_boots_1` | shoes01 | <http://www.makehumancommunity.org/node/2081> | CC0 | B | all, by page | none required; header says AGPL: hero_boots_1.obj | clothing |
| `culturalibre_hero_boots_2` | shoes01 | <http://www.makehumancommunity.org/node/2132> | CC0 | B | all, by page | none required; header says AGPL: hero_boots_2.obj | clothing |
| `culturalibre_hero_boots_3` | shoes01 | <http://www.makehumancommunity.org/node/2138> | CC0 | B | all, by page | none required; header says AGPL: hero_boots_3.obj | clothing |
| `culturalibre_hero_boots_5` | shoes01 | <http://www.makehumancommunity.org/node/2424> | CC0 | B | all, by page | none required; header says AGPL: hero_boots_5.obj | clothing |
| `culturalibre_hero_kalistick_lefthanded` | equipment01 | <http://www.makehumancommunity.org/node/2120> | CC0 | B | all, by page | none required; header says AGPL: hero_kalistick_lefthanded.obj | clothing |
| `culturalibre_hero_kalistick` | equipment01 | <http://www.makehumancommunity.org/node/2119> | CC0 | B | all, by page | none required; header says AGPL: hero_kalistick.obj | clothing |
| `culturalibre_hero_mask_1` | masks01 | <http://www.makehumancommunity.org/node/2055> | CC0 | B | all, by page | none required; header says AGPL: hero_mask_1.obj | clothing |
| `culturalibre_hero_mask_2` | masks01 | <http://www.makehumancommunity.org/node/2049> | CC0 | B | all, by page | none required; header says AGPL: hero_mask_2.obj | clothing |
| `culturalibre_hero_mask_3` | masks01 | <http://www.makehumancommunity.org/node/2202> | CC0 | B | all, by page | none required; header says AGPL: hero_mask_3.obj | clothing |
| `culturalibre_hero_mask_4` | masks01 | <http://www.makehumancommunity.org/node/2220> | CC0 | B | all, by page | none required; header says AGPL: hero_mask_4.obj | clothing |
| `culturalibre_hero_suit_1` | suits02 | <http://www.makehumancommunity.org/node/2061> | CC0 | B | all, by page | none required; header says AGPL: hero_suit_1.obj | clothing |
| `culturalibre_hero_suit_2` | suits02 | <http://www.makehumancommunity.org/node/2292> | CC0 | B | all, by page | none required; header says AGPL: hero_suit_2.obj | clothing |
| `culturalibre_hero_suit_3` | suits02 | <http://www.makehumancommunity.org/node/2308> | CC0 | B | all, by page | none required; header says AGPL: hero_suit_3.obj | clothing |
| `culturalibre_hero-heroine_gloves_1` | gloves01 | <http://www.makehumancommunity.org/node/2074> | CC0 | B | all, by page | none required; header says AGPL: culturalibre_hero-heroine_gloves_1.mhclo, hero-heroine_gloves_1.obj | clothing |
| `culturalibre_hero-heroine_gloves_2` | gloves01 | <http://www.makehumancommunity.org/node/2093> | CC0 | B | all, by page | none required; header says AGPL: hero-heroine_gloves_2.obj | clothing |
| `culturalibre_hero-heroine_gloves_3` | gloves01 | <http://www.makehumancommunity.org/node/2193> | CC0 | B | all, by page | none required; header says AGPL: hero-heroine_gloves_3.obj | clothing |
| `culturalibre_hero-heroine_gloves_4` | gloves01 | <http://www.makehumancommunity.org/node/2333> | CC0 | B | all, by page | none required; header says AGPL: hero-heroine_gloves_4.obj | clothing |
| `culturalibre_hero-heroine_gloves_5` | gloves01 | <http://www.makehumancommunity.org/node/2401> | CC0 | B | all, by page | none required; header says AGPL: hero-heroine_gloves_5.obj | clothing |
| `culturalibre_hero-heroine_hood_1` | masks01 | <http://www.makehumancommunity.org/node/2100> | CC0 | B | all, by page | none required; header says AGPL: hero-heroine_hood_1.obj | clothing |
| `culturalibre_hero-heroine_hood_2` | masks01 | <http://www.makehumancommunity.org/node/2309> | CC0 | B | all, by page | none required; header says AGPL: hero-heroine_hood_2.obj | clothing |
| `culturalibre_heroine_boots_1` | shoes01 | <http://www.makehumancommunity.org/node/2155> | CC0 | B | all, by page | none required; header says AGPL: heroine_boots_1.obj | clothing |
| `culturalibre_heroine_boots_2` | shoes01 | <http://www.makehumancommunity.org/node/2181> | CC0 | B | all, by page | none required; header says AGPL: heroine_boots_2.obj | clothing |
| `culturalibre_heroine_boots_3` | shoes01 | <http://www.makehumancommunity.org/node/2187> | CC0 | B | all, by page | none required; header says AGPL: heroine_boots_3.obj | clothing |
| `culturalibre_heroine_mask_1` | masks01 | <http://www.makehumancommunity.org/node/2474> | CC0 | B | all, by page | none required; header says AGPL: heroine_mask_1.obj | clothing |
| `culturalibre_heroine_suit_2` | suits02 | <http://www.makehumancommunity.org/node/2317> | CC0 | B | all, by page | none required; header says AGPL: heroine_suit_2.obj | clothing |
| `culturalibre_magic_sceptre` | equipment01 | <http://www.makehumancommunity.org/node/2358> | CC0 | B | all, by page | none required; header says AGPL: magic_sceptre.obj | clothing |
| `culturalibre_male_boots` | shoes01 | <http://www.makehumancommunity.org/node/2548> | CC0 | B | all, by page | none required; header says AGPL: male_boots.obj | clothing |
| `culturalibre_war_hammer` | equipment01 | <http://www.makehumancommunity.org/node/2051> | CC0 | B | all, by page | none required; header says AGPL: warhammer.obj | clothing |
| `culturalibre_wooden_bow` | equipment01 | <http://www.makehumancommunity.org/node/2362> | CC0 | B | all, by page | none required; header says AGPL: wooden_bow.obj | clothing |
| `ews_3d_glasses` | glasses01 | <http://www.makehumancommunity.org/node/1233> | CC0 | B | all, by page | none required; header says AGPL: ews_3d_glasses.mhclo, 3dglasses.obj | clothing |
| `frankyaye_glasses_library_male` | glasses01 | <http://www.makehumancommunity.org/node/153> | CC0 | B | all, by page | none required; header says AGPL: frankyaye_glasses_library_male.mhclo, glasses_library_male.obj | clothing |
| `frankyaye_mini_skirt_01` | skirts01 | <http://www.makehumancommunity.org/node/129> | CC0 | B | all, by page | none required; header says AGPL: frankyaye_mini_skirt_01.mhclo, mini_skirt_01.obj | clothing |
| `frankyaye_mini_skirt_02` | skirts01 | <http://www.makehumancommunity.org/node/131> | CC0 | B | all, by page | none required; header says AGPL: frankyaye_mini_skirt_02.mhclo, mini_skirt_02.obj | clothing |
| `grinsegold_female_pirate_boots` | shoes01 | <http://www.makehumancommunity.org/node/211> | CC0 | B | all, by page | none required; header says AGPL: leatherboots_2cm.obj, grinsegold_female_pirate_boots.mhclo | clothing |
| `grinsegold_uncle_joshis_hat` | hats01 | <http://www.makehumancommunity.org/node/193> | CC0 | B | all, by page | none required; header says AGPL: uncle_joshi's_hat.obj, grinsegold_uncle_joshis_hat.mhclo | clothing |
| `jujube_bag_on_head` | hats01 | <http://www.makehumancommunity.org/node/578> | CC0 | B | all, by page | none required; header says AGPL: jujube_bag_on_head.mhclo, pillow_man.obj | clothing |
| `jujube_newsboy_cap` | hats01 | <http://www.makehumancommunity.org/node/78> | CC0 | B | all, by page | none required; header says AGPL: jujube_newsboy_cap.mhclo, newsboy_cap.obj | clothing |
| `kwnet_at_optical_glasses` | glasses01 | <http://www.makehumancommunity.org/node/928> | CC0 | B | all, by page | none required; header says AGPL: m_opticals01.obj, kwnet_at_optical_glasses.mhclo | clothing |
| `o4saken_dagger` | equipment01 | <http://www.makehumancommunity.org/node/809> | CC0 | B | all, by page | none required; header says AGPL: o4saken_dagger.mhclo, dagger.obj | clothing |
| `rehmanpolanski_viking_boots` | suits02 | <http://www.makehumancommunity.org/node/2619> | CC0 | B | all, by page | none required; header says AGPL: bootsviking.obj | clothing |
| `rehmanpolanski_viking_pants` | suits02 | <http://www.makehumancommunity.org/node/2618> | CC0 | B | all, by page | none required; header says AGPL: pantsviking.obj | clothing |
| `rehmanpolanski_viking_tunic` | suits02 | <http://www.makehumancommunity.org/node/2617> | CC0 | B | all, by page | none required; header says AGPL: tunicviking.obj | clothing |
| `scailman_gogo_platform_boots` | shoes01 | <http://www.makehumancommunity.org/node/1467> | CC0 | B | all, by page | none required; header says AGPL: scailman_gogo_platform_boots.mhclo, gogo_boots.obj | clothing |
| `scailman_semitransparent_water_boots` | shoes01 | <http://www.makehumancommunity.org/node/1778> | CC0 | B | all, by page | none required; header says AGPL: botas_102.obj, scailman_semitransparent_water_boots.mhclo | clothing |
| `skalldyrssuppe_tube_top_funky_colors` | shirts01 | <http://www.makehumancommunity.org/node/975> | CC0 | B | all, by page | none required; header says AGPL: skalldyrssuppe_tube_top_funky_colors.mhclo, tube_top.obj | clothing |
| `wdg_mycenaean_tunic` | dress01 | <http://www.makehumancommunity.org/node/1763> | CC0 | B | all, by page | none required; header says AGPL: mycenaean_tunic.obj, wdg_mycenaean_tunic.mhclo | clothing |
| `culturalibre_faun_face` | animal01 | <http://www.makehumancommunity.org/node/2357> | CC0 | B | all, by page | none | correctives/anthro |
| `culturalibre_faun_horns` | bodyparts01 | <http://www.makehumancommunity.org/node/2355> | CC0 | B | all, by page | none required; header says AGPL: faun_horns.obj | correctives/anthro |
| `culturalibre_minotaur_horns` | bodyparts01 | <http://www.makehumancommunity.org/node/2352> | CC0 | B | all, by page | none required; header says AGPL: minotaur_horns.obj | correctives/anthro |
| `elvs_chipmunk_cheeks_high_1` | cheek01 | <http://www.makehumancommunity.org/node/2243> | CC0 | B | all, by page | none | correctives/anthro |
| `elvs_chipmunk_cheeks_low_1` | cheek01 | <http://www.makehumancommunity.org/node/2244> | CC0 | B | all, by page | none | correctives/anthro |
| `elvs_ear_flap_bottom_out` | ears01 | <http://www.makehumancommunity.org/node/2782> | CC0 | B | all, by page | none | correctives/anthro |
| `elvs_flap_ears_1` | ears01 | <http://www.makehumancommunity.org/node/2779> | CC0 | B | all, by page | none | correctives/anthro |
| `elvs_flap_ears_2` | ears01 | <http://www.makehumancommunity.org/node/2780> | CC0 | B | all, by page | none | correctives/anthro |
| `elvs_flap_ears_3` | ears01 | <http://www.makehumancommunity.org/node/2781> | CC0 | B | all, by page | none | correctives/anthro |
| `elvs_high_chubby_cheekbones_1` | cheek01 | <http://www.makehumancommunity.org/node/2253> | CC0 | B | all, by page | none | correctives/anthro |
| `elvs_jowls_1` | cheek01 | <http://www.makehumancommunity.org/node/2254> | CC0 | B | all, by page | none | correctives/anthro |
| `elvs_piggy_nose1` | animal01 | <http://www.makehumancommunity.org/node/2372> | CC0 | B | all, by page | none | correctives/anthro |
| `elvs_sunken_cheeks_1` | cheek01 | <http://www.makehumancommunity.org/node/2259> | CC0 | B | all, by page | none | correctives/anthro |
| `freezychan_lucoa_quetzalcoatl_horns` | bodyparts01 | <http://www.makehumancommunity.org/node/1564> | CC0 | B | all, by page | none required; header says AGPL: freezychan_lucoa_quetzalcoatl_horns.mhclo, lucoa_horns.obj | correctives/anthro |
| `jaldmic_donkey_head` | animal01 | <http://www.makehumancommunity.org/node/3535> | CC0 | B | all, by page | none | correctives/anthro |
| `jaldmic_equinus_headv2` | animal01 | <http://www.makehumancommunity.org/node/2952> | CC0 | B | all, by page | none | correctives/anthro |
| `jaldmic_houndoom_horns` | bodyparts01 | <http://www.makehumancommunity.org/node/2995> | CC0 | B | all, by page | none required; header says AGPL: jaldmic_houndoom_horns.mhclo, houndoom_horns.obj | correctives/anthro |
| `jujube_ear_canal` | ears01 | <http://www.makehumancommunity.org/node/612> | CC0 | B | all, by page | none | correctives/anthro |
| `kwnet_at_pantyhose01` | underwear01 | <http://www.makehumancommunity.org/node/927> | CC0 | B | all, by page | none required; header says AGPL: pantyhose01.obj, kwnet_at_pantyhose01.mhclo | correctives/anthro |
| `learning_mma_fighting_gloves` | gloves01 | <http://www.makehumancommunity.org/node/95> | CC0 | B | all, by page | none required; header says AGPL: learning_mma_fighting_gloves.mhclo, mma_gloves.obj | correctives/anthro |
| `marco_105_armsleeve02` | underwear01 | <http://www.makehumancommunity.org/node/352> | CC0 | B | all, by page | none required; header says AGPL: armsleeve02.obj, marco_105_armsleeve02.mhclo | correctives/anthro |
| `marco_105_stocking01` | underwear01 | <http://www.makehumancommunity.org/node/348> | CC0 | B | all, by page | none required; header says AGPL: marco_105_stocking01.mhclo, stocking01.obj | correctives/anthro |
| `marco_105_stocking02` | underwear01 | <http://www.makehumancommunity.org/node/349> | CC0 | B | all, by page | none required; header says AGPL: stocking02.obj, marco_105_stocking02.mhclo | correctives/anthro |
| `mindfront_ear_details` | ears01 | <http://www.makehumancommunity.org/node/1588> | CC0 | B | all, by page | none | correctives/anthro |
| `mindfront_ear_in` | ears01 | <http://www.makehumancommunity.org/node/1589> | CC0 | B | all, by page | none | correctives/anthro |
| `punkduck_strappy_lace_thong` | underwear01 | <http://www.makehumancommunity.org/node/1166> | CC0 | B | all, by page | none | correctives/anthro |
| `rehmanpolanski_ear_flatten` | ears01 | <http://www.makehumancommunity.org/node/2624> | CC0 | B | all, by page | none | correctives/anthro |
| `titleknown_catgirl_ears` | animal01 | <http://www.makehumancommunity.org/node/1153> | CC0 | B | all, by page | none | correctives/anthro |
| `v0rt3x_armsleeves_black_fishnet_large` | underwear01 | <http://www.makehumancommunity.org/node/305> | CC0 | B | all, by page | none required; header says AGPL: armsleeve_fishnet_large.obj | correctives/anthro |
| `v0rt3x_armsleeves_black_fishnet_medium` | underwear01 | <http://www.makehumancommunity.org/node/304> | CC0 | B | all, by page | none required; header says AGPL: armsleeve_fishnet_medium.obj | correctives/anthro |
| `v0rt3x_armsleeves_black_fishnet_small` | underwear01 | <http://www.makehumancommunity.org/node/303> | CC0 | B | all, by page | none required; header says AGPL: armsleeve_fishnet_small.obj | correctives/anthro |
| `v0rt3x_armsleeves_white_fishnet_large` | underwear01 | <http://www.makehumancommunity.org/node/302> | CC0 | B | all, by page | none required; header says AGPL: armsleeve_white_l.obj | correctives/anthro |
| `v0rt3x_armsleeves_white_fishnet_medium` | underwear01 | <http://www.makehumancommunity.org/node/301> | CC0 | B | all, by page | none required; header says AGPL: armsleeve_white_m.obj | correctives/anthro |
| `v0rt3x_armsleeves_white_fishnet_small` | underwear01 | <http://www.makehumancommunity.org/node/300> | CC0 | B | all, by page | none required; header says AGPL: armsleeve_white_s.obj | correctives/anthro |
| `v0rt3x_stockings_black_fishnet_large` | underwear01 | <http://www.makehumancommunity.org/node/296> | CC0 | B | all, by page | none required; header says AGPL: stockings_fishnet_large.obj | correctives/anthro |
| `v0rt3x_stockings_black_fishnet_medium` | underwear01 | <http://www.makehumancommunity.org/node/295> | CC0 | B | all, by page | none required; header says AGPL: stockings_fishnet_medium.obj | correctives/anthro |
| `v0rt3x_stockings_black_fishnet_small` | underwear01 | <http://www.makehumancommunity.org/node/294> | CC0 | B | all, by page | none required; header says AGPL: stockings_fishnet_small.obj | correctives/anthro |
| `v0rt3x_stockings_white_fishnet_large` | underwear01 | <http://www.makehumancommunity.org/node/299> | CC0 | B | all, by page | none required; header says AGPL: stockings_white_l.obj | correctives/anthro |
| `v0rt3x_stockings_white_fishnet_medium` | underwear01 | <http://www.makehumancommunity.org/node/298> | CC0 | B | all, by page | none required; header says AGPL: stockings_white_m.obj | correctives/anthro |
| `v0rt3x_stockings_white_fishnet_small` | underwear01 | <http://www.makehumancommunity.org/node/297> | CC0 | B | all, by page | none required; header says AGPL: stockings_white_s.obj | correctives/anthro |
| `bogdan666_short_02_brown` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1937> | CC0 | B | all, by page | none | hair |
| `bogdan666_short_02_gray` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1941> | CC0 | B | all, by page | none | hair |
| `bogdan666_short_02_red` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1939> | CC0 | B | all, by page | none | hair |
| `cortu_shaggy_green_hair` | hair01 | <http://www.makehumancommunity.org/node/2811> | CC0 | B | all, by page | none required; header says AGPL: shaggy_green.obj | hair |
| `cortu_short_messy_hair` | hair01 | <http://www.makehumancommunity.org/node/2809> | CC0 | B | all, by page | none required; header says AGPL: short_messy.obj | hair |
| `cortu_straight_bangs` | hair01 | <http://www.makehumancommunity.org/node/2810> | CC0 | B | all, by page | none required; header says AGPL: straight_bangs.obj | hair |
| `cortu_strawberry_cloud_hair` | hair01 | <http://www.makehumancommunity.org/node/2808> | CC0 | B | all, by page | none required; header says AGPL: strawberry_cloud.obj | hair |
| `culturalibre_hair_01` | hair01 | <http://www.makehumancommunity.org/node/2893> | CC0 | B | all, by page | none required; header says AGPL: fhair01.obj, culturalibre_hair_01.mhclo | hair |
| `culturalibre_hair_02` | hair01 | <http://www.makehumancommunity.org/node/2892> | CC0 | B | all, by page | none required; header says AGPL: mhair02.obj, culturalibre_hair_02.mhclo | hair |
| `culturalibre_hair_05` | hair01 | <http://www.makehumancommunity.org/node/2445> | CC0 | B | all, by page | none required; header says AGPL: hair_05.obj | hair |
| `culturalibre_hair_06` | hair01 | <http://www.makehumancommunity.org/node/2479> | CC0 | B | all, by page | none required; header says AGPL: hair_06.obj | hair |
| `culturalibre_short_02_green` | system_hair_materials01 | <http://www.makehumancommunity.org/node/3193> | CC0 | B | all, by page | none | hair |
| `dariush086_ponytail01_black` | system_hair_materials01 | <http://www.makehumancommunity.org/node/2678> | CC0 | B | all, by page | none | hair |
| `dariush086_ponytail01_brown` | system_hair_materials01 | <http://www.makehumancommunity.org/node/2679> | CC0 | B | all, by page | none | hair |
| `dariush086_ponytail01_gold` | system_hair_materials01 | <http://www.makehumancommunity.org/node/2677> | CC0 | B | all, by page | none | hair |
| `dariush086_ponytail01_green` | system_hair_materials01 | <http://www.makehumancommunity.org/node/2676> | CC0 | B | all, by page | none | hair |
| `dariush086_ponytail01_pink` | system_hair_materials01 | <http://www.makehumancommunity.org/node/2675> | CC0 | B | all, by page | none | hair |
| `dariush086_ponytail01_platinum` | system_hair_materials01 | <http://www.makehumancommunity.org/node/2680> | CC0 | B | all, by page | none | hair |
| `dariush086_ponytail01_red` | system_hair_materials01 | <http://www.makehumancommunity.org/node/2681> | CC0 | B | all, by page | none | hair |
| `dariush086_ponytail01_violet` | system_hair_materials01 | <http://www.makehumancommunity.org/node/2674> | CC0 | B | all, by page | none | hair |
| `elvs_double_mh_braid` | hair01 | <http://www.makehumancommunity.org/node/1336> | CC0 | B | all, by page | none required; header says AGPL: double_mhbraid.obj, elvs_double_mh_braid.mhclo | hair |
| `elvs_french_braid_variation` | hair01 | <http://www.makehumancommunity.org/node/1335> | CC0 | B | all, by page | none required; header says AGPL: elvs_french_braid_variation.mhclo, frenchbraid1mh01.obj | hair |
| `elvs_reverse_french_braid_bun` | hair01 | <http://www.makehumancommunity.org/node/1337> | CC0 | B | all, by page | none | hair |
| `elvs_unkempt_french_braid` | hair01 | <http://www.makehumancommunity.org/node/1334> | CC0 | B | all, by page | none required; header says AGPL: elvs_unkempt_french_braid.mhclo, unkempt_mhbraidfr.obj | hair |
| `learning_anime_hair` | hair01 | <http://www.makehumancommunity.org/node/253> | CC0 | B | all, by page | none required; header says AGPL: animehair.obj, learning_anime_hair.mhclo | hair |
| `littleright_bobcut_hair` | hair01 | <http://www.makehumancommunity.org/node/936> | CC0 | B | all, by page | none required; header says AGPL: littleright_bobcut_hair.mhclo, littleright_hair_bobcut.obj | hair |
| `mtknife_ponytail01_deep_red` | system_hair_materials01 | <http://www.makehumancommunity.org/node/886> | CC0 | B | all, by page | none | hair |
| `o4saken_long01` | hair01 | <http://www.makehumancommunity.org/node/1471> | CC0 | B | all, by page | none | hair |
| `rehmanpolanski_hair_bun_brown` | hair01 | <http://www.makehumancommunity.org/node/2477> | CC0 | B | all, by page | none required; header says AGPL: hair_bun_brown.obj, rehmanpolanski_hair_bun_brown.mhclo | hair |
| `sonntag78_blond_with_headband` | hair01 | <http://www.makehumancommunity.org/node/207> | CC0 | B | all, by page | none required; header says AGPL: blondwithheadband.obj, sonntag78_blond_with_headband.mhclo | hair |
| `sonntag78_junglebook_hair` | hair01 | <http://www.makehumancommunity.org/node/174> | CC0 | B | all, by page | none required; header says AGPL: sonntag78_junglebook_hair.mhclo, junglebookhair.obj | hair |
| `toigo_braid01_ash` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1175> | CC0 | B | all, by page | none | hair |
| `toigo_braid01_black` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1176> | CC0 | B | all, by page | none | hair |
| `toigo_braid01_fuchsia` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1177> | CC0 | B | all, by page | none | hair |
| `toigo_braid01_ginger` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1178> | CC0 | B | all, by page | none | hair |
| `toigo_braid01_golden` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1179> | CC0 | B | all, by page | none | hair |
| `toigo_braid01_gray` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1180> | CC0 | B | all, by page | none | hair |
| `toigo_braid01_red` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1181> | CC0 | B | all, by page | none | hair |
| `toigo_braid01_strawberry` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1182> | CC0 | B | all, by page | none | hair |
| `toigo_braid01_teal` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1183> | CC0 | B | all, by page | none | hair |
| `toigo_braid01_violet` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1184> | CC0 | B | all, by page | none | hair |
| `toigo_long_01_ash` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1167> | CC0 | B | all, by page | none | hair |
| `toigo_long_01_black` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1168> | CC0 | B | all, by page | none | hair |
| `toigo_long_01_fuchsia` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1169> | CC0 | B | all, by page | none | hair |
| `toigo_long_01_ginger` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1170> | CC0 | B | all, by page | none | hair |
| `toigo_long_01_gray` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1171> | CC0 | B | all, by page | none | hair |
| `toigo_long_01_red` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1172> | CC0 | B | all, by page | none | hair |
| `toigo_long_01_teal` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1173> | CC0 | B | all, by page | none | hair |
| `toigo_long_01_violet` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1174> | CC0 | B | all, by page | none | hair |
| `toigo_short_04_auburn` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1005> | CC0 | B | all, by page | none | hair |
| `toigo_short_04_blonde` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1006> | CC0 | B | all, by page | none | hair |
| `toigo_short_04_blue` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1007> | CC0 | B | all, by page | none | hair |
| `toigo_short_04_brown` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1008> | CC0 | B | all, by page | none | hair |
| `toigo_short_04_ginger` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1009> | CC0 | B | all, by page | none | hair |
| `toigo_short_04_gray` | system_hair_materials01 | <http://www.makehumancommunity.org/node/1010> | CC0 | B | all, by page | none | hair |
| `grinsegold_fingernails_female_natural` | bodyparts04 | <http://www.makehumancommunity.org/node/195> | CC0 | B | all, by page | none required; header says AGPL: fingernails_elegant.obj, grinsegold_fingernails_female_natural.mhclo | hands |
| `bobby_03_daz_dragon_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/2443> | CC0 | B | all, by page | none | unassigned (eye material) |
| `bobby_03_diffuse_amber_eyes` | system_eye_materials01 | <http://www.makehumancommunity.org/node/2340> | CC0 | B | all, by page | none | unassigned (eye material) |
| `bobby_03_diffuse_blue_eyes` | system_eye_materials01 | <http://www.makehumancommunity.org/node/2341> | CC0 | B | all, by page | none | unassigned (eye material) |
| `bobby_03_diffuse_grey_eyes` | system_eye_materials01 | <http://www.makehumancommunity.org/node/2342> | CC0 | B | all, by page | none | unassigned (eye material) |
| `bobby_03_diffuse_hazel_eyes` | system_eye_materials01 | <http://www.makehumancommunity.org/node/2305> | CC0 | B | all, by page | none | unassigned (eye material) |
| `bobby_03_diffuse_sea_breeze_eyes` | system_eye_materials01 | <http://www.makehumancommunity.org/node/2343> | CC0 | B | all, by page | none | unassigned (eye material) |
| `culturalibre_6_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/3263> | CC0 | B | all, by page | none | unassigned (eye material) |
| `culturalibre_hero_white_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/2123> | CC0 | B | all, by page | none | unassigned (eye material) |
| `culturalibre_hero_yellow_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/3243> | CC0 | B | all, by page | none | unassigned (eye material) |
| `culturalibre_zombie_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/2531> | CC0 | B | all, by page | none | unassigned (eye material) |
| `gpedroso_blank_eye` | system_eye_materials02 | <http://www.makehumancommunity.org/node/1066> | CC0 | B | all, by page | none | unassigned (eye material) |
| `hatshj_alien_eye_2` | system_eye_materials02 | <http://www.makehumancommunity.org/node/321> | CC0 | B | all, by page | none | unassigned (eye material) |
| `hatshj_alien_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/320> | CC0 | B | all, by page | none | unassigned (eye material) |
| `hatshj_cross_eye` | system_eye_materials02 | <http://www.makehumancommunity.org/node/322> | CC0 | B | all, by page | none | unassigned (eye material) |
| `hatshj_facette_eye_2` | system_eye_materials02 | <http://www.makehumancommunity.org/node/324> | CC0 | B | all, by page | none | unassigned (eye material) |
| `hatshj_facette_eye` | system_eye_materials02 | <http://www.makehumancommunity.org/node/323> | CC0 | B | all, by page | none | unassigned (eye material) |
| `hatshj_reptile_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/325> | CC0 | B | all, by page | none | unassigned (eye material) |
| `mindfront_brown_eye_02` | system_eye_materials01 | <http://www.makehumancommunity.org/node/527> | CC0 | B | all, by page | none | unassigned (eye material) |
| `nyloseth_bluecateyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/1891> | CC0 | B | all, by page | none | unassigned (eye material) |
| `nyloseth_brown_cat_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/1892> | CC0 | B | all, by page | none | unassigned (eye material) |
| `nyloseth_green_cat_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/1911> | CC0 | B | all, by page | none | unassigned (eye material) |
| `nyloseth_sapphire_blue_eyes` | system_eye_materials01 | <http://www.makehumancommunity.org/node/1887> | CC0 | B | all, by page | none | unassigned (eye material) |
| `nyloseth_sapphire_cat_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/1912> | CC0 | B | all, by page | none | unassigned (eye material) |
| `nyloseth_yellow_cat_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/1913> | CC0 | B | all, by page | none | unassigned (eye material) |
| `sonntag78_orcifyhead_eye` | system_eye_materials02 | <http://www.makehumancommunity.org/node/216> | CC0 | B | all, by page | none | unassigned (eye material) |
| `spamrakuen_sr_anime_eyes_navy` | system_eye_materials01 | <http://www.makehumancommunity.org/node/3625> | CC0 | B | all, by page | none | unassigned (eye material) |
| `spamrakuen_sr_anime_maid-san_blue_eyes` | system_eye_materials01 | <http://www.makehumancommunity.org/node/3346> | CC0 | B | all, by page | none | unassigned (eye material) |
| `spamrakuen_sr_anime_maid-san_red_eyes` | system_eye_materials01 | <http://www.makehumancommunity.org/node/3427> | CC0 | B | all, by page | none | unassigned (eye material) |
| `titleknown_trans_eyes` | system_eye_materials02 | <http://www.makehumancommunity.org/node/3156> | CC0 | B | all, by page | none | unassigned (eye material) |
| `wojackowl_blue_eyes_toon` | system_eye_materials01 | <http://www.makehumancommunity.org/node/3481> | CC0 | B | all, by page | none | unassigned (eye material) |
| `wojackowl_brown_eyes_toon` | system_eye_materials01 | <http://www.makehumancommunity.org/node/3480> | CC0 | B | all, by page | none | unassigned (eye material) |
| `wojackowl_green_eyes_toon` | system_eye_materials01 | <http://www.makehumancommunity.org/node/3482> | CC0 | B | all, by page | none | unassigned (eye material) |
| `blindsaypatten_uniform_skin_texture` | skins01 | <http://www.makehumancommunity.org/node/743> | CC0 | B | all, by page | none | unassigned (skin) |
| `bobby_03_grey_skinned_person` | skins03 | <http://www.makehumancommunity.org/node/2347> | CC0 | B | all, by page | none | unassigned (skin) |
| `bobby_03_young_female_hairless` | skins01 | <http://www.makehumancommunity.org/node/2346> | CC0 | B | all, by page | none | unassigned (skin) |
| `bogdan666_elfskinsohlen` | skins03 | <http://www.makehumancommunity.org/node/1571> | CC0 | B | all, by page | none | unassigned (skin) |
| `callharvey3d_baboon_people` | skins03 | <http://www.makehumancommunity.org/node/1146> | CC0 | B | all, by page | none | unassigned (skin) |
| `callharvey3d_midtoned_female` | skins01 | <http://www.makehumancommunity.org/node/802> | CC0 | B | all, by page | none | unassigned (skin) |
| `culturalibre_dr_manhattan` | skins03 | <http://www.makehumancommunity.org/node/2536> | CC0 | B | all, by page | none | unassigned (skin) |
| `culturalibre_tigra_skin` | skins03 | <http://www.makehumancommunity.org/node/3256> | CC0 | B | all, by page | none | unassigned (skin) |
| `culturalibre_tigra_white_skin` | skins03 | <http://www.makehumancommunity.org/node/3257> | CC0 | B | all, by page | none | unassigned (skin) |
| `cutoff3d_indian_female_enhanced` | skins01 | <http://www.makehumancommunity.org/node/3017> | CC0 | B | all, by page | none | unassigned (skin) |
| `cutoff3d_indian_female_skin` | skins01 | <http://www.makehumancommunity.org/node/3013> | CC0 | B | all, by page | none | unassigned (skin) |
| `darthfurby_caucasian_female` | skins01 | <http://www.makehumancommunity.org/node/1549> | CC0 | B | all, by page | none | unassigned (skin) |
| `flower-angel_red_head_skin` | skins01 | <http://www.makehumancommunity.org/node/1933> | CC0 | B | all, by page | none | unassigned (skin) |
| `ken1138_caucasian_male_tattooed_skin` | skins02 | <http://www.makehumancommunity.org/node/1601> | CC0 | B | all, by page | none | unassigned (skin) |
| `mindfront_aksel_skin` | skins02 | <http://www.makehumancommunity.org/node/850> | CC0 | B | all, by page | none | unassigned (skin) |
| `mindfront_skin_male_african_middleage` | skins02 | <http://www.makehumancommunity.org/node/526> | CC0 | B | all, by page | none | unassigned (skin) |
| `naim_abbassi_zombie_skin` | skins03 | <http://www.makehumancommunity.org/node/1757> | CC0 | B | all, by page | none | unassigned (skin) |
| `nyloseth_zoeyskin` | skins01 | <http://www.makehumancommunity.org/node/1914> | CC0 | B | all, by page | none | unassigned (skin) |
| `onlytheghosts_middle_aged_eurasian_female` | skins01 | <http://www.makehumancommunity.org/node/1579> | CC0 | B | all, by page | none | unassigned (skin) |
| `onlytheghosts_old_eurasian_female` | skins01 | <http://www.makehumancommunity.org/node/1580> | CC0 | B | all, by page | none | unassigned (skin) |
| `onlytheghosts_old_eurasian_male` | skins02 | <http://www.makehumancommunity.org/node/1581> | CC0 | B | all, by page | none | unassigned (skin) |
| `onlytheghosts_young_eurasian_female` | skins01 | <http://www.makehumancommunity.org/node/1578> | CC0 | B | all, by page | none | unassigned (skin) |
| `rehmanpolanski_skin_viking_tattoos` | skins02 | <http://www.makehumancommunity.org/node/2623> | CC0 | B | all, by page | none | unassigned (skin) |
| `reizibarrientos_blue_leopard_skin` | skins03 | <http://www.makehumancommunity.org/node/1478> | CC0 | B | all, by page | none | unassigned (skin) |
| `reizibarrientos_white_walker_skin` | skins03 | <http://www.makehumancommunity.org/node/1470> | CC0 | B | all, by page | none | unassigned (skin) |
| `skalldyrssuppe_creamy_female` | skins01 | <http://www.makehumancommunity.org/node/935> | CC0 | B | all, by page | none | unassigned (skin) |
| `sohh_female_zombie_skin` | skins03 | <http://www.makehumancommunity.org/node/2529> | CC0 | B | all, by page | none | unassigned (skin) |
| `sonntag78_orkifyheadtarget_custom_skin` | skins03 | <http://www.makehumancommunity.org/node/213> | CC0 | B | all, by page | none | unassigned (skin) |
| `spreadcore_gray_alien_bio_armor_skin_1` | skins03 | <http://www.makehumancommunity.org/node/3108> | CC0 | B | all, by page | none | unassigned (skin) |
| `spreadcore_green_alien_skin_1` | skins03 | <http://www.makehumancommunity.org/node/3105> | CC0 | B | all, by page | none | unassigned (skin) |
| `spreadcore_green_alien_skin_2` | skins03 | <http://www.makehumancommunity.org/node/3107> | CC0 | B | all, by page | none | unassigned (skin) |
| `titleknown_trans_flag` | skins03 | <http://www.makehumancommunity.org/node/3155> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_female_bronze_with_makeup` | skins01 | <http://www.makehumancommunity.org/node/1129> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_female_bronze` | skins01 | <http://www.makehumancommunity.org/node/1133> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_female_freckles` | skins01 | <http://www.makehumancommunity.org/node/1134> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_female_ginger_2` | skins01 | <http://www.makehumancommunity.org/node/1132> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_female_ginger_with_makeup` | skins01 | <http://www.makehumancommunity.org/node/1131> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_female_ginger` | skins01 | <http://www.makehumancommunity.org/node/1130> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_female_with_violet_makeup` | skins01 | <http://www.makehumancommunity.org/node/1126> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_male_bronze` | skins02 | <http://www.makehumancommunity.org/node/1136> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_male_freckles` | skins02 | <http://www.makehumancommunity.org/node/1137> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_male_ginger` | skins02 | <http://www.makehumancommunity.org/node/1135> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_male_with_emo_eyes` | skins02 | <http://www.makehumancommunity.org/node/1139> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_male_with_eyeliner` | skins02 | <http://www.makehumancommunity.org/node/1138> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_male_with_goth_makeup` | skins02 | <http://www.makehumancommunity.org/node/1140> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_with_makeup` | skins01 | <http://www.makehumancommunity.org/node/1116> | CC0 | B | all, by page | none | unassigned (skin) |
| `toigo_light_skin_with_natural_makeup` | skins01 | <http://www.makehumancommunity.org/node/1125> | CC0 | B | all, by page | none | unassigned (skin) |
| `trashhunter_black_kameri_fur` | skins03 | <http://www.makehumancommunity.org/node/3220> | CC0 | B | all, by page | none | unassigned (skin) |
| `xhado84_middleage_afro_female_special_suit_green` | skins03 | <http://www.makehumancommunity.org/node/1444> | CC0 | B | all, by page | none | unassigned (skin) |
| `xhado84_young_asian_female_body_suit_gold` | skins03 | <http://www.makehumancommunity.org/node/2887> | CC0 | B | all, by page | none | unassigned (skin) |
| `xhado84_young_asian_female_special_suit_red` | skins03 | <http://www.makehumancommunity.org/node/1443> | CC0 | B | all, by page | none | unassigned (skin) |

## 5. Adding a community asset

1. Open its page on makehumancommunity.org and capture a `CommunityPage`: the URL, the "Submitted by … on …" line, the licence exactly as the page states it, and the date you read it.
2. Pass the record as `compileAsset(file, id, kind, { page })`. The packer packs it when the page licence is CC0, and each packed file's evidence names the page and its submission date.
3. When the page does not say CC0 but the `.obj` does, pass the base body as well, `{ page, body }`. The packer rebuilds the binding from the mesh, leaves out any material or texture that is not CC0, and records the asset's own binding file as "not shipped". Without `body` it refuses the asset. Expect to re-fit what the rebuilt binding cannot carry: the original's hidden body vertices (`delete_verts`), its z-depth and its per-axis scaling are not taken over.
