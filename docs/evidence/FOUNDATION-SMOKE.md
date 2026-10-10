# The foundation's smoke tier: invariant failures

Written by `node scripts/foundation-smoke.ts` from the invariant suite
(src/foundation/invariants.ts) over the smoke tier (the cross set's six shape
extremes, rest, seated, overhead and the deep squat). Tone changes no
position, so each row holds for tones 1, 3 and 6. Penetration samples every
4th welded vertex. This is the foundation lanes' worklist: the
smoke test fails if a row gets worse, and a lane that fixes one rewrites this
file in its commit.

| body | pose | anatomy | penetrating cm² (vertices, deepest mm, parts) | contacts (deepest mm) | inverted | squashed cm² (triangles) | joint volume out of band | folds (sharpest °) | seam gap (mm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f-slim | seated | default | 7.95 (50, 19.3, trunk~trunk) | 10 (12.1) | 240 | 86.42 (638) | - | 168 (179) | 0.0 |
| f-slim | overhead | default | 20.52 (7, 26.2, trunk~head) | 10 (22.8) | 138 | 6.91 (18) | - | 94 (168) | 0.0 |
| f-slim | squat | default | 18.94 (28, 24.0, trunk~trunk) | 0 | 134 | 296.20 (1304) | hip.L 0.77, knee.L 0.51, hip.R 0.77, knee.R 0.52 | 180 (180) | 0.0 |
| f-heavy | seated | default | 3.62 (23, 14.0, trunk~trunk) | 17 (10.3) | 187 | 177.90 (569) | - | 99 (175) | 0.0 |
| f-heavy | overhead | default | 22.58 (7, 27.0, trunk~trunk) | 13 (18.5) | 164 | 55.13 (108) | - | 106 (174) | 0.0 |
| f-heavy | squat | default | 5.70 (20, 28.0, trunk~trunk) | 1 (2.8) | 139 | 350.22 (995) | knee.L 0.50, knee.R 0.52 | 218 (177) | 0.0 |
| m-muscular | seated | default | 33.08 (216, 15.3, trunk~trunk) | 27 (7.8) | 361 | 200.21 (636) | - | 373 (180) | 0.0 |
| m-muscular | overhead | default | 24.97 (9, 27.5, trunk~trunk) | 14 (28.4) | 170 | 13.63 (26) | - | 120 (178) | 0.0 |
| m-muscular | squat | default | 33.96 (214, 22.4, trunk~trunk) | 6 (4.6) | 390 | 381.35 (960) | hip.L 0.70, knee.L 0.55, hip.R 0.71, knee.R 0.55 | 442 (180) | 0.0 |
| m-heavy | seated | default | 33.01 (165, 15.9, trunk~trunk) | 242 (13.2) | 266 | 235.95 (748) | - | 355 (178) | 0.0 |
| m-heavy | overhead | default | 57.12 (15, 26.2, trunk~head) | 24 (25.6) | 252 | 10.37 (20) | - | 112 (175) | 0.0 |
| m-heavy | squat | default | 39.76 (179, 22.9, trunk~trunk) | 7 (8.6) | 330 | 535.32 (1116) | hip.L 0.77, knee.L 0.52, hip.R 0.77, knee.R 0.52 | 377 (178) | 0.0 |
| f-elder | seated | default | 4.69 (29, 17.3, trunk~trunk) | 26 (16.2) | 186 | 128.55 (489) | - | 135 (175) | 0.0 |
| f-elder | overhead | default | 35.94 (14, 27.5, trunk~trunk) | 15 (26.7) | 228 | 8.61 (30) | - | 144 (172) | 0.0 |
| f-elder | squat | default | 1.26 (11, 27.1, trunk~trunk) | 1 (3.9) | 83 | 310.50 (1150) | hip.L 0.80, knee.L 0.56, hip.R 0.80, knee.R 0.56 | 192 (180) | 0.0 |
| child | seated | none | 0 | 0 | 2 | 46.97 (242) | - | 39 (150) | 0.0 |
| child | overhead | none | 14.64 (15, 24.7, head~head) | 27 (23.7) | 284 | 10.80 (86) | - | 126 (173) | 0.0 |
| child | squat | none | 3.75 (3, 23.2, trunk~trunk) | 0 | 30 | 105.75 (684) | knee.L 0.51, knee.R 0.51 | 112 (175) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
