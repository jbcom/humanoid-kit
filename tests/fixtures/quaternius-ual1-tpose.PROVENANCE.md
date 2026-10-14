# Quaternius UAL1 T-pose test fixture

`quaternius-ual1-tpose.glb` is a source-backed, no-mesh test fixture made from
the pinned `Universal Animation Library[Standard].zip` archive already recorded
in `scripts/lib/packQuaternius.ts`.

- Source archive SHA-256:
  `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724`
- Source member SHA-256:
  `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997`
- Fixture SHA-256:
  `1ba9545a31197fef2c3e5849626e51ad2b46338a6b5c62f9c7f6381b5ebd3303`
- Licence: CC0 1.0 Universal, as stated by the archive's `License.txt`.
- Author: Quaternius.

The fixture retains only the source skeleton, its rest transforms, and the
`A_TPose` rotation tracks needed by `readRig` and the retarget identity test.
It contains no mesh, material, texture, or non-T-pose animation data.
