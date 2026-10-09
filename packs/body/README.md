# humanoid-kit-body

The universal base body for [humanoid-kit](https://github.com/jbcom/humanoid-kit):

- the base mesh (19,158 vertices, 18,486 quads) with UVs and helper geometry for
  eyes, teeth, tongue, lashes and clothing fit;
- shape targets for every age MakeHuman models (1 to 90 years), the macro
  targets (gender, age, muscle, weight, height, proportions, ethnic anchors,
  breast size for adults) and 230+ fine shape modifiers;
- the 163-bone default skeleton with skin weights;
- facial pose units for expressions.

Adult-only targets are not in this package; they live in
`humanoid-kit-adult-anatomy`.

```ts
import { loadHumanoidAssets } from "humanoid-kit";
import { bodyPack } from "humanoid-kit-body";

const assets = await loadHumanoidAssets({ body: bodyPack });
```

## Licence

The data is derived from the MakeHuman project's assets, which were released
under CC0 1.0 in September 2020, and is itself released under CC0 1.0
([LICENSE](LICENSE)). Every source file was checked for its CC0 statement when
packed; see [data/PROVENANCE.md](data/PROVENANCE.md) for the upstream commit,
the evidence for each file and the output hashes. This package is not affiliated
with the MakeHuman project.
