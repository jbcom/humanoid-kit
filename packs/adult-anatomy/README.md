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

## Public deploys

Nothing in this pack stops a host app from shipping it to the public. The
gate in the library is on the figure's age; whether this package reaches a
build is the host's, and a build-time constant such as `import.meta.env.DEV` is
not proof. Any app or fork that deploys publicly must check the built output
and fail the deploy when it contains the pack. humanoid-kit does this with
[`scripts/check-pages-build.mjs`](https://github.com/jbcom/humanoid-kit/blob/main/scripts/check-pages-build.mjs)
(`pnpm check:pages`): it fails when any built file matches this pack's data by
SHA-256, or when an app build names the package, its targets or its modifiers.
Copy it, or run it, before every upload.

## Licence

`CC0-1.0 AND CC-BY-4.0`. Most of the pack is CC0 1.0 ([LICENSE](LICENSE)):
MakeHuman's own adult-only targets (released CC0 in September 2020) and the CC0
community sculpts the genital forms are transferred from; see
[data/PROVENANCE.md](data/PROVENANCE.md) for the evidence per file. The female
genital detail taken from NIH 3D entry 3DPX-017321 (Emullen45; National Institute
of Allergy and Infectious Disease) is CC BY 4.0
([LICENSE-CC-BY-4.0](LICENSE-CC-BY-4.0)); [NOTICE.md](NOTICE.md) carries its
attribution, which redistribution must keep. This package is not affiliated with
the MakeHuman project or the NIH.
