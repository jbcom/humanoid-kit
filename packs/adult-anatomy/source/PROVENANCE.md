# Sculpted sources of the adult anatomy pack

The adult pack's genital forms are transferred from CC0 community sculpts
(docs/research/ADULT-SCULPT-PLAN.md, sections 6d and 6e). This directory holds
each source as downloaded and the parts cut from it. It is not part of the
published package (`packs/adult-anatomy/package.json` ships `data/` only), and
nothing the public site builds from reads it.

The licence rule's clause B governs: an asset's page licence is its licence
(owner ruling, 2026-10-09). Each source below was judged from its page.

| Source | Page | Submitted | Page licence | Read | Files (SHA-256) |
| --- | --- | --- | --- | --- | --- |
| `adult_male_genitalia_breast_fix` | <http://www.makehumancommunity.org/proxy/adult_male_genitalia_breast_fix.html> | ieroglif, 2026-05-04 (updated 2026-05-18, 2026-05-22) | "CC0 - Creative Commons Zero" (the proxy's own header says `license: CC0` too) | 2026-10-09 | `adult_male_genitalia_breast_fix.obj` `78092e99e7165d5ee6d0e48dca48ee360fbb73b61206325dca8746dcf65c8095`; `adult_male_genitalia_breast_fix.proxy` `fd4a710a4bcf7a9e7eefef70ce80a41419549bd4bab3fc1499cc0a91f2e414c1` |
| `Male_Gen-Heal1` | <http://www.makehumancommunity.org/proxy/erect_penis_only_works_with_males.html> | Slayer227, 2022-01-06 | "CC0 - Creative Commons Zero" (the proxy's own header says `license: CC0` too) | 2026-10-09 | `Male_Gen-Heal1.obj` `716972d16f57ae478bf0d2b3d84a7d5d9418a078e5815db6c01a99eff0aec5a4`; `Male_Gen-Heal1.proxy` `d6a8b8e52570a910840af7148dafc49408d976ff341d907bb7b9b75b90524f5d` |

`LICENSE-SOURCE.txt` in each source's directory quotes its page and lists the
URLs the files came from.

## How each file is used

- `adult_male_genitalia_breast_fix.obj`: a whole-body proxy in metres with
  flaccid genitals. `scripts/blender/cut_male.py` subdivides it twice and cuts
  out the hanging shaft with its glans (`phallus.obj`, cut across the shaft's
  own axis a centimetre below the root) and the sac (`scrotum.obj`, cut just
  below its neck: the sac hangs free, with two lobes and a median raphe).
- `Male_Gen-Heal1.obj`: a whole-body proxy in metres with an erect penis. The
  same script cuts out the erect shaft with its glans (`phallus.obj`).
- In each directory, `cuts.json` holds the cut's planes, the source's hash and
  each part's topology numbers. The packer refuses a part whose source no longer
  has that hash.
- Each `.proxy`: the asset's own binding. It is read only to place the sculpt on
  our base: it is evaluated on our rest body, and a per-axis scale and
  translation is fitted to it (`scripts/lib/detail/sculpt.ts`). The parts are
  then bound to our base by our own regenerated binding. No part of these files
  ships. The erect shaft is then moved, without turning, so its cut is centred on
  the flaccid shaft's: the two authors put the root in different places, and one
  organ has one root.
- No material (`.mhmat`) or weights (`.mhw`) file is used or kept.

## Not used, and why

- ukiyoe's `man_genital` (<http://www.makehumancommunity.org/clothes/man_genital.html>,
  CC0) was the first source. It is a clothes piece whose sac is merged with the
  skin round it, and whose glans is a plain cap; the two proxies above have a free
  two-lobed sac and a glans with its corona and meatus, and between them a flaccid
  and an erect form, so the organ is drawn from sculpts in both states rather than
  posed from one (owner ruling, 2026-10-09: no procedural forms).
- xsuprem3x's `adult_male_genitalia` (adult_male_genitalia.html_0) is the same
  body as ieroglif's fixed version above, which corrects its chest.
