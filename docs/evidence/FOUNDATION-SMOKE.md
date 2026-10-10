# The foundation's smoke tier: invariant failures

Written by `node scripts/foundation-smoke.ts` from the invariant suite
(src/foundation/invariants.ts) over the smoke tier (the cross set's six shape
extremes, rest, seated, overhead and the deep squat). Tone changes no
position, so each row holds for tones 1, 3 and 6. Penetration samples every
4th welded vertex. This is the foundation lanes' worklist: the
smoke test fails if a row gets worse, and a lane that fixes one rewrites this
file in its commit.

| body | pose | anatomy | penetrating (deepest mm, parts) | contacts (deepest mm) | inverted | squashed | joint volume out of band | folds (sharpest °) | seam gap (mm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f-slim | seated | default | 69 (22.7, trunk~trunk) | 34 (17.2) | 466 | 363 | - | 319 (178) | 0.0 |
| f-slim | overhead | default | 7 (26.2, trunk~head) | 10 (22.8) | 138 | 18 | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 62 (25.6, trunk~trunk) | 160 (29.7) | 644 | 570 | hip.L 0.53, hip.R 0.54 | 422 (179) | 0.0 |
| f-heavy | seated | default | 142 (18.9, trunk~trunk) | 72 (18.4) | 1048 | 289 | hip.L 0.76, hip.R 0.76 | 281 (179) | 0.0 |
| f-heavy | overhead | default | 7 (27.0, trunk~trunk) | 13 (18.5) | 164 | 108 | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 224 (25.3, trunk~trunk) | 236 (29.7) | 1820 | 584 | hip.L 0.43, hip.R 0.43 | 432 (180) | 0.0 |
| m-muscular | seated | default | 121 (18.3, trunk~trunk) | 26 (12.9) | 868 | 350 | hip.L 0.59, hip.R 0.59 | 436 (179) | 0.0 |
| m-muscular | overhead | default | 9 (27.5, trunk~trunk) | 14 (28.4) | 170 | 26 | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 170 (25.4, trunk~trunk) | 180 (30.0) | 1321 | 672 | hip.L 0.27, hip.R 0.23 | 760 (180) | 0.0 |
| m-heavy | seated | default | 194 (21.7, trunk~trunk) | 39 (12.0) | 1608 | 527 | hip.L 0.65, hip.R 0.65 | 445 (179) | 0.0 |
| m-heavy | overhead | default | 15 (26.2, trunk~head) | 24 (25.6) | 252 | 20 | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 418 (29.6, trunk~trunk) | 200 (29.8) | 2081 | 437 | hip.L 0.36, hip.R 0.37 | 597 (178) | 0.0 |
| f-elder | seated | default | 103 (21.5, trunk~trunk) | 30 (19.8) | 643 | 298 | - | 294 (180) | 0.0 |
| f-elder | overhead | default | 14 (27.5, trunk~trunk) | 14 (26.7) | 228 | 30 | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 128 (25.4, trunk~trunk) | 190 (29.9) | 1268 | 586 | hip.L 0.57, hip.R 0.56 | 432 (180) | 0.0 |
| child | seated | none | 13 (21.4, trunk~trunk) | 49 (21.1) | 234 | 164 | - | 135 (179) | 0.0 |
| child | overhead | none | 15 (24.7, head~head) | 27 (23.7) | 284 | 86 | shoulder.L 0.49, shoulder.R 0.49 | 126 (173) | 0.0 |
| child | squat | none | 35 (23.2, trunk~trunk) | 212 (29.7) | 434 | 256 | hip.L 0.45, hip.R 0.45 | 234 (180) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
