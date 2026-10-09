# Notice

This repository contains four separately licensed works:

| Work | Location | Licence |
| --- | --- | --- |
| `humanoid-kit`, the code | `src/`, `scripts/`, `playground/`, `tests/` | MIT (see `LICENSE`) |
| `humanoid-kit-body`, the base body data | `packs/body/` | CC0 1.0 (see `packs/body/LICENSE`) |
| `humanoid-kit-adult-anatomy`, the adult anatomy data | `packs/adult-anatomy/` | CC0 1.0 (see `packs/adult-anatomy/LICENSE`) |
| `humanoid-kit-hair`, the scalp hair data | `packs/hair/` | CC0 1.0 (see `packs/hair/LICENSE`) |
| `humanoid-kit-clothing`, the garment data | `packs/clothing/` | CC0 1.0 (see `packs/clothing/LICENSE`) |

## MakeHuman asset data (CC0 1.0)

The data in `packs/body/data`, `packs/adult-anatomy/data` and `packs/hair/data` is derived from the
asset files of the MakeHuman project
(`github.com/makehumancommunity/makehuman`, directory `makehuman/data`): the hm08
base mesh, morph targets, the modifier table, the default skeleton, the skin
weights and the facial pose units. The MakeHuman project released those assets
into the public domain under the
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
dedication in September 2020. The copyright holders at the point of release, as
named in the asset file headers, were Data Collection AB, Joel Palmius and Jonas
Hauquier; the target files also record "Original copyright (C) 2014 Manuel
Bastioni", transferred to the team in 2016. Credit to all of them for this work.

What this repository uses is **asset data only**. No MakeHuman program code is
included, linked, translated or otherwise used.

### How the data is made

`scripts/pack-makehuman.ts` repacks the assets into the binary layout the runtime
loads (`src/format/assetFormat.ts`). It converts MakeHuman's decimetres to metres
and writes:

- `packs/body/data`: `manifest.json`, `body.bin` (positions, UVs, quad faces and
  skin weights) and `targets.bin` (sparse morph targets), covering every age
  MakeHuman models.
- `packs/adult-anatomy/data`: `manifest.json` and `targets.bin` for the targets
  that apply only to adults (genital, bulge and pregnancy targets). Its manifest
  records the SHA-256 of the exact `body.bin` it was built against.
- `packs/hair/data`: `manifest.json` and, per style, a binary and a strand map,
  from the scalp hair in the MakeHuman system assets pack
  (`makehuman_system_assets_cc0.zip`, released CC0 in September 2020 with every
  file's header saying so). `scripts/lib/packHair.ts` packs them, last in
  `pnpm pack:data` or alone with `pnpm pack:hair <system-assets-dir>`. The
  texture is the source atlas's luminance, normalised, with its alpha: a
  derived work of CC0 data, also CC0. The manifest records the SHA-256 of the
  body pack it binds to.

The body pack's nail plates are two CC0 community meshes from MakeHuman's
bodyparts04 pack, "Mind nails 01 short" and "Mind nails toes 01" by Mindfront
(2018), whose files say `license CC0` and whose asset pages say "CC0 - Creative
Commons Zero". Their geometry and binding are vendored in
`vendor/makehuman-bodyparts04/`, with the provenance of each file in its
`PROVENANCE.md`, and pass the licence rule's clause B (a community asset with
its captured page). Credit to Mindfront for them.

Height and proportion targets are kept for average muscle and weight only. The
universal muscle and weight targets already carry that variation, and the dense
variants would roughly triple the size of the package.

### The licence gate

The packer refuses to run on any source file that does not prove CC0 from its own
content. It accepts, in this order:

1. the asset file header, "This asset was explicitly released as CC0";
2. a `"license": "CC0"` field in a JSON asset;
3. for the two file kinds that carry no statement of their own (the modifier table
   and the facial pose-unit BVH), the upstream `LICENSE.md` naming their category,
   "Targets and modifiers" or "Poses and expressions", under "These assets have
   been released under CC0 1.0 Universal." The packer checks that sentence
   verbatim, so a changed upstream licence fails the pack.

Attachments (eyes, teeth, tongue and hair) are held to the first form only:
each of a style's `.mhclo`, `.obj` and `.mhmat` must carry the header, and a
bare `license CC0` line, which community exporters write by default and which a
sibling file can contradict, is refused.

An asset from the community repositories on makehumancommunity.org is CC0 when
its asset page says so: the page's stated licence governs (owner ruling,
2026-10-09: "If the website says cc0 then it's cc0"). The packer accepts such an
asset only with the page captured beside it (`scripts/lib/licenceRule.ts`) and
records the page and its submission date as the evidence for every file. A page
that says CC-BY or AGPL is refused. `docs/licence-history.md` gives the rule, the
history behind it and the verdict on every community asset checked so far.

`packs/clothing/data` is derived from MakeHuman's system assets pack
(`makehuman_system_assets_cc0.zip`), whose clothes, meshes and materials each
open with the same header, "This asset was explicitly released as CC0 in
september 2020", naming the same copyright holders. `scripts/pack-clothing.ts`
accepts a garment's `.mhclo`, `.obj` and `.mhmat` only on that statement in the
file itself (a bare `license CC0` line is refused), and a texture only through a material
that passes. The clothing pack holds only these system assets; a community
garment would enter it on its page licence, as above.

Each pack's `data/PROVENANCE.md` is written by the packer. It records the
upstream commit, how many files were accepted on which evidence, and the SHA-256
of every output file. Do not edit it by hand.

## Skin colour data (CC BY 4.0)

The melanin anchors in `src/surface/skinTone.ts` are eleven median diffuse
albedos derived from the International Skin Spectra Archive: Yan, L. et al.
(2025), "The International Skin Spectra Archive (ISSA): a multicultural human
skin phenotype and colour spectra collection", Scientific Data,
<https://www.nature.com/articles/s41597-025-04857-5>. The dataset
(<https://doi.org/10.6084/m9.figshare.28228571.v4>) is licensed CC BY 4.0
(<https://creativecommons.org/licenses/by/4.0/>), confirmed from figshare's
record. The values were changed from the source: facial readings binned by
ITA°, medians taken per bin, and surface reflection removed. The derivation is
in `docs/research/SKIN-RENDERING.md`.

## Trademarks and affiliation

"MakeHuman" is the name of the upstream project. humanoid-kit is an independent
project. It is not affiliated with, endorsed by or sponsored by the MakeHuman
project, Data Collection AB or any of the people named above, and the name is
used here only to say where the asset data came from. CC0 1.0 section 4(a) states
that the dedication does not license trademarks, and none is claimed.
