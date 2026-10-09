# humanoid-kit-hair

Scalp hair for [humanoid-kit](https://github.com/jbcom/humanoid-kit): ten
alpha-card styles (short, bob, long, afro, ponytail, braid) that bind to the
base body and follow every shape, rendered in any colour the recipe asks for.

It is a separate install so that an application whose figures never wear hair
does not download it. Only its small manifest loads up front; each style's
geometry and texture are fetched when a figure first wears that style, a few
hundred kilobytes each.

```ts
import { HumanoidWorkerClient, createRecipe } from "humanoid-kit";
import { bodyPack } from "humanoid-kit-body";
import { hairPack } from "humanoid-kit-hair";

const client = new HumanoidWorkerClient({ body: bodyPack, hair: hairPack });
const recipe = createRecipe({ hair: { style: "short02" } });
```

The loader refuses this pack unless it was built against the exact body pack it
is loaded with, and the pack's own manifest says so by hash.

## Coverage

The ten styles are every scalp hair the MakeHuman system pack's CC0 header proves, and they are
nearly all straight or wavy. Coily and kinky textures are mostly missing (one short afro, one
crop of loose curls): no locs, twists, cornrows, bantu knots or close crop and fade. No other
CC0-provable style closes this; it needs an authored or procedural style (see
`docs/ARCHITECTURE.md`, "Scalp hair", and `docs/evidence/hair.md`).

## Licence

CC0 1.0 ([LICENSE](LICENSE)). The styles are MakeHuman's own scalp hair from
its system assets pack (released CC0 in September 2020); see
[data/PROVENANCE.md](data/PROVENANCE.md) for the evidence per file. The
textures are luminance strand maps made from the source atlases: they carry the
strands' structure and none of the original colour. This package is not
affiliated with the MakeHuman project.
