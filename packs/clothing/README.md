# humanoid-kit-clothing

Garments and shoes for [humanoid-kit](https://github.com/jbcom/humanoid-kit).

A garment is a MakeHuman clothes asset (`.mhclo`): a mesh bound to the base
mesh's vertices, so it follows every shape the figure takes, plus the list of
base vertices it covers, so the skin under it is hidden. This pack ships 87
CC0 garments: nineteen from MakeHuman's system assets (casual, sport, work and
elegant suits, six pairs of shoes and a fedora) and 68 from the MakeHuman
community's clothing packs whose asset pages state CC0 (trousers, skirts,
tops, hero suits, stockings, arm sleeves, gloves, boots, masks, glasses, hats,
hoods and held props). `PROVENANCE.md` lists each with its source and page.

```ts
import { loadHumanoidAssets } from "humanoid-kit";
import { bodyPack } from "humanoid-kit-body";
import { clothingPack } from "humanoid-kit-clothing";

const assets = await loadHumanoidAssets({ body: bodyPack, clothing: clothingPack });
// A figure wears garments by id: recipe.outfit = ["suits/male_casualsuit01", "shoes/shoes01"]
```

The pack is a separate install, and the loader refuses it unless it was built
against the exact body pack it is loaded with. An application that never installs
it carries no garment data at all.

## Licence

CC0 1.0 ([LICENSE](LICENSE)). Every source file is checked for MakeHuman's
"explicitly released as CC0" header before it is packed; see
[data/PROVENANCE.md](data/PROVENANCE.md) for the evidence per file. This package
is not affiliated with the MakeHuman project.
