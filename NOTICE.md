# Notice

This repository contains three separately licensed works:

| Work | Location | Licence |
| --- | --- | --- |
| `humanoid-kit`, the code | `src/`, `scripts/`, `playground/`, `tests/` | MIT (see `LICENSE`) |
| `humanoid-kit-body`, the base body data | `packs/body/` | CC0 1.0 (see `packs/body/LICENSE`) |
| `humanoid-kit-adult-anatomy`, the adult anatomy data | `packs/adult-anatomy/` | CC0 1.0 (see `packs/adult-anatomy/LICENSE`) |

## MakeHuman asset data (CC0 1.0)

The data in `packs/body/data` and `packs/adult-anatomy/data` is derived from the
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
