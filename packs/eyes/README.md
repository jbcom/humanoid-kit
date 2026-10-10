# humanoid-kit-eyes

Eye materials for [humanoid-kit](https://github.com/jbcom/humanoid-kit): 32
irises and sclerae (human eyes in amber, blue, grey, hazel and brown; cats' slit
pupils; toon and anime eyes; reptile, alien and other creatures') for the kit's eye
shader.

It is a separate install so that an application that is happy with one eye does not
download it. Only its small manifest loads up front; a material's texture (about
100 KB) is fetched when a figure first wears it.

```tsx
import { Humanoid, loadEyeLibrary } from "humanoid-kit";
import { eyesPack } from "humanoid-kit-eyes";

const eyes = await loadEyeLibrary(eyesPack);
<Humanoid recipe={createRecipe({ eyes: { material: "nyloseth_green_cat_eyes" } })} eyeMaterials={eyes} />;
```

A material supplies an iris's pattern and a sclera's detail, not its colour: the
colour stays the recipe's (`eyes.iris`, `eyes.scleraWarmth`), so any material takes
any iris colour, and an iris's mean colour is what the recipe says. The manifest
carries, measured from each texture's pixels, where its iris ends and how bright its
iris and sclera are against the built-in eye's; `paintedIris` is the recipe colour
at which a material shows the colour it was painted in.

## Licence

CC0 1.0 ([LICENSE](LICENSE)). The materials are the MakeHuman community's
`system_eye_materials01` and `02`, each asset's page saying CC0; see
[data/PROVENANCE.md](data/PROVENANCE.md) for the archives' hashes and the licence
evidence per material. This package is not affiliated with the MakeHuman project.
