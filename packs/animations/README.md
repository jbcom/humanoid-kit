# humanoid-kit-animations

Animation clips for [humanoid-kit](https://github.com/jbcom/humanoid-kit):
90 clips (walks, a jog and a sprint, idles, swims, crouches, combat, sitting, farm
work) on MakeHuman's default skeleton, played on any figure the kit makes, whatever
its size, shape or age.

It is a separate install so that an application whose figures never move does
not download it. Only its small manifest loads up front; each clip's binary (a
few tens of kilobytes) is fetched when a figure first plays it.

```ts
import { loadAnimationLibrary } from "humanoid-kit";
import { animationsPack } from "humanoid-kit-animations";

const animations = await loadAnimationLibrary(animationsPack);
const walk = await animations.load("walk_normal", rigData(assets).bones);
```

A clip is a list of frames, each a local rotation per bone it moves, relative to
the rest pose, so it says nothing about a figure's proportions. Where a walking
figure goes is derived from its own feet (`humanoid-kit`'s `planRootMotion`), so a
foot that is planted stays planted on a child as on an adult.

## Licence

CC0 1.0 ([LICENSE](LICENSE)). Six clips are punkduck's, from the MakeHuman
community's `makehuman2_additional_assets_cc0.zip`, and 84 are Quaternius's
Universal Animation Libraries 1 and 2, retargeted onto MakeHuman's skeleton; see
[data/PROVENANCE.md](data/PROVENANCE.md) for the archive's hash and the licence
evidence per clip. This package is not affiliated with the MakeHuman project.
