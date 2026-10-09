# humanoid-kit-adult-anatomy

Adult-only anatomy for [humanoid-kit](https://github.com/jbcom/humanoid-kit).

humanoid-kit models people of every age. Anatomy is the one part that is
adult-only, and it is enforced in code rather than by convention:

- this pack is a separate install, so an application that never installs it
  cannot render adult anatomy at all;
- humanoid-kit evaluates its targets only for figures aged 18 or over, and a
  recipe that sets any adult-only value for a younger figure is rejected with an
  error rather than silently adjusted;
- the loader refuses this pack unless it was built against the exact body pack
  it is loaded with.

```ts
import { loadHumanoidAssets } from "humanoid-kit";
import { adultAnatomyPack } from "humanoid-kit-adult-anatomy";
import { bodyPack } from "humanoid-kit-body";

const assets = await loadHumanoidAssets({ body: bodyPack, adultAnatomy: adultAnatomyPack });
```

## Licence

CC0 1.0 ([LICENSE](LICENSE)). The current contents are MakeHuman's own
adult-only targets (released CC0 in September 2020); see
[data/PROVENANCE.md](data/PROVENANCE.md) for the evidence per file. This package
is not affiliated with the MakeHuman project.
