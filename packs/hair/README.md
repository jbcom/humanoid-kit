# humanoid-kit-hair

Hair for [humanoid-kit](https://github.com/jbcom/humanoid-kit): 41 alpha-card
entries that bind to the base body and follow every shape, rendered in any
colour the recipe asks for. They are 16 scalp styles (short, bob, long, afro,
ponytail, a side braid, box braids, cornrows, twists, locs, bantu knots and a
close crop), 12 eyebrows, 4 eyelashes and 9 facial-hair entries. Select
beard and moustache assets independently through `recipe.facialHair`.

It is a separate install so that an application whose figures never wear hair
does not download it. Only its small manifest loads up front; each style's
geometry and texture are fetched when a figure first wears that entry, from a
few kilobytes (an eyebrow) to about 2 MB (the largest curly styles). Total download
size depends on which entries the figure wears.

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

The ten MakeHuman styles are every scalp hair its CC0 header proves, and they are nearly all
straight or wavy. Five authored styles (box braids, cornrows, two-strand twists, locs, bantu knots; generated
by `scripts/lib/hairCards`, no one's mesh or texture used) cover the coily and braided textures.
A derived coily close crop with a fade (`crop01`) keeps `short04`'s cards under its own strand map.
Still missing: tight curls in the longer styles (see `docs/ARCHITECTURE.md`, "Scalp hair", and `docs/evidence/hair.md`).

## Licence

The system styles, five bodyparts05 facial entries, authored styles and `crop01`
are CC0. Four bodyparts06 facial entries are included by the default
`commercial` asset-licence profile: one is consistently CC-BY; three retain
AGPL3 source headers that conflict with the official pack's CC-BY record.
The `cc0-only` profile leaves those four features explicitly unavailable rather
than substituting an approximation. See [LICENSE](LICENSE),
[data/ASSET-ATTRIBUTION.md](data/ASSET-ATTRIBUTION.md),
[data/PROVENANCE.md](data/PROVENANCE.md), and
[source/](source/) for the per-asset terms, credit and source evidence. The
textures are luminance strand maps made from the source
atlases: they carry the strands' structure and none of the original colour.
This package is not affiliated with the MakeHuman project.
