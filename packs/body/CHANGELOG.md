# Changelog

## 1.0.0 (2026-10-17)


### Features

* add an authored relaxed body pose ([95dae77](https://github.com/jbcom/humanoid-kit/commit/95dae77036273272f396f88e27f64ddccdd97312))
* attachment occlusion follows the pose through baked key-pose corners ([87429a8](https://github.com/jbcom/humanoid-kit/commit/87429a869e184cbf807d0576114382307bd13e54))
* M2 follow-ups — Lighthouse gate, relaxed pose, delete_verts rule ([ea02689](https://github.com/jbcom/humanoid-kit/commit/ea026893939bee5b34fd6a8b8a1332eb6b013d59))
* M2 rig, skin layer stack, presence and skin states ([c12322a](https://github.com/jbcom/humanoid-kit/commit/c12322aaed73e906c8766313ff900342da66b941))
* mirror MakeHuman's age handling and add an eye shader ([c0c6ae2](https://github.com/jbcom/humanoid-kit/commit/c0c6ae2db9482879ef87e1cf05cceb7b94725b8b))
* pack MakeHuman's slider taxonomy with its measure and body-shape modifiers ([161578c](https://github.com/jbcom/humanoid-kit/commit/161578c382a136dae30d76a00745da5d9ae0ef80))
* pack the CC0 MakeHuman base body and adult anatomy as data packages ([ec0a46c](https://github.com/jbcom/humanoid-kit/commit/ec0a46cdb11b59c5b87d4f3c2ecdab5fb3a59373))
* whole-body poses from the pack, grounded on the posed figure ([faa5ccb](https://github.com/jbcom/humanoid-kit/commit/faa5ccbc937a417e4578516205895d2ceafa1e37))


### Bug Fixes

* age-gate breast and nipple shape modifiers ([106f52d](https://github.com/jbcom/humanoid-kit/commit/106f52d2217a0f6ba98385e2e375817d0f9eb574))
* convert MakeHuman's Z-up BVH rotations into the figure's Y-up axes ([dd2530b](https://github.com/jbcom/humanoid-kit/commit/dd2530b3affdeab2606d81a6fd8c51254f3982e7))


### Performance Improvements

* bake attachment occlusion at pack time, not on every load ([8960be6](https://github.com/jbcom/humanoid-kit/commit/8960be69ca5bf0a2ad2752772510d33287aed6c2))
* hand over a figure before the modifier targets arrive ([b766459](https://github.com/jbcom/humanoid-kit/commit/b766459d77ccb4725a24506ce47f51076c9190e3))
* load a figure's own age anchors first, the rest behind it ([8949795](https://github.com/jbcom/humanoid-kit/commit/894979545a9948e5f58eb6cb4eb07606fdbf5700))
* ship morph targets delta-coded, planar and gzipped (18.8 to 5.5 MB) ([56438da](https://github.com/jbcom/humanoid-kit/commit/56438da090d087201667401a19e534ac22c38cb2))
* ship pack binaries gzipped and textures as WebP (9.1 to 7.0 MB) ([9b3d569](https://github.com/jbcom/humanoid-kit/commit/9b3d569fdea8f7452396a4e9683c0347a57fc4d7))
