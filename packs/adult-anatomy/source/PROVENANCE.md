# Sculpted sources of the adult anatomy pack

The adult pack's genital forms are transferred from CC0 community sculpts
(docs/research/ADULT-SCULPT-PLAN.md, section 6d). This directory holds each
source as downloaded and the parts cut from it. It is not part of the published
package (`packs/adult-anatomy/package.json` ships `data/` only), and nothing the
public site builds from reads it.

The licence rule's clause B governs: an asset's page licence is its licence
(owner ruling, 2026-10-09). Each source below was judged from its page.

| Source | Page | Submitted | Page licence | Read | Files (SHA-256) |
| --- | --- | --- | --- | --- | --- |
| `man_genital` | <http://www.makehumancommunity.org/clothes/man_genital.html> | ukiyoe, 2022-11-05 | "CC0 - Creative Commons Zero" (the files' own headers say `license: CC0` too) | 2026-10-08 | `man_genital.obj` `8e9441b050350d588cb1e5415861f3939138354cc83ef13d5932eee59b9b8f13`; `man_genital.mhclo` `9457e4d46470a9790f47c9a0fdd7856a3c9ae874408f7d50b43610e6af86eaaf` |

`LICENSE-SOURCE.txt` in each source's directory quotes its page and lists the
URLs the files came from.

## How each file is used

- `man_genital.obj`: the sculpt. `scripts/blender/cut_male.py` subdivides it
  twice and cuts the shaft with the glans (`phallus.obj`) and the sac
  (`scrotum.obj`) out of it. The cut's planes, the source's hash and each part's
  topology numbers are in `cuts.json`. The packer refuses a part whose source no
  longer has that hash.
- `man_genital.mhclo`: the asset's own binding. It is read only to place the
  sculpt on our base: it is evaluated on our rest body, and a per-axis scale and
  translation is fitted to it (`scripts/lib/detail/sculpt.ts`). The parts are then
  bound to our base by our own regenerated binding. No part of this file ships.
- The asset's material (`.mhmat`) is not used.

## Not used, and why

`Male_Gen-Heal1` (erect_penis_only_works_with_males) and xsuprem3x's
`adult_male_genitalia` (adult_male_genitalia.html_0) are usable under the same
rulings, but their scrotums are the small two-ball form the sheets rejected. The
erect state is the transferred form posed and grown, so Heal1's erect shaft is
not needed.
