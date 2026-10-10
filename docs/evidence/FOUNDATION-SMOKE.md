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
| f-slim | seated | default | 7.24 (52, 23.5, trunk~trunk) | 10 (12.1) | 300 | 86.51 (649) | - | 239 (179) | 0.0 |
| f-slim | overhead | default | 20.52 (7, 26.2, trunk~head) | 10 (22.8) | 138 | 6.91 (18) | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 19.23 (33, 23.5, trunk~trunk) | 0 | 198 | 296.66 (1325) | hip.L 0.71, knee.L 0.56, hip.R 0.71, knee.R 0.57 | 245 (180) | 0.0 |
| f-heavy | seated | default | 4.43 (31, 14.0, trunk~trunk) | 16 (10.3) | 275 | 177.70 (549) | - | 211 (180) | 0.0 |
| f-heavy | overhead | default | 22.58 (7, 27.0, trunk~trunk) | 13 (18.5) | 164 | 55.13 (108) | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 6.90 (31, 27.9, trunk~trunk) | 1 (2.8) | 182 | 350.38 (1006) | hip.L 0.66, knee.L 0.57, hip.R 0.66, knee.R 0.58 | 274 (177) | 0.0 |
| m-muscular | seated | default | 30.98 (189, 16.7, trunk~trunk) | 17 (7.8) | 388 | 200.22 (649) | hip.L 0.68, hip.R 0.69 | 457 (179) | 0.0 |
| m-muscular | overhead | default | 24.97 (9, 27.5, trunk~trunk) | 14 (28.4) | 170 | 13.63 (26) | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 31.64 (181, 22.4, trunk~trunk) | 6 (4.6) | 427 | 381.50 (968) | hip.L 0.50, knee.L 0.67, hip.R 0.51, knee.R 0.68 | 634 (180) | 0.0 |
| m-heavy | seated | default | 29.70 (139, 16.6, trunk~trunk) | 213 (12.9) | 302 | 235.85 (736) | hip.L 0.75, hip.R 0.75 | 535 (180) | 0.0 |
| m-heavy | overhead | default | 57.12 (15, 26.2, trunk~head) | 24 (25.6) | 252 | 10.37 (20) | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 38.80 (154, 23.3, trunk~trunk) | 9 (8.6) | 390 | 535.39 (1125) | hip.L 0.59, knee.L 0.62, hip.R 0.60, knee.R 0.62 | 635 (180) | 0.0 |
| f-elder | seated | default | 4.90 (34, 18.0, trunk~trunk) | 28 (16.2) | 248 | 128.93 (523) | - | 214 (176) | 0.0 |
| f-elder | overhead | default | 35.94 (14, 27.5, trunk~trunk) | 15 (26.7) | 228 | 8.61 (30) | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 1.54 (17, 26.9, trunk~trunk) | 1 (3.9) | 141 | 310.64 (1159) | hip.L 0.73, knee.L 0.63, hip.R 0.74, knee.R 0.63 | 247 (180) | 0.0 |
| child | seated | none | 0 | 0 | 2 | 46.97 (242) | - | 39 (150) | 0.0 |
| child | overhead | none | 14.64 (15, 24.7, head~head) | 27 (23.7) | 284 | 10.80 (86) | shoulder.L 0.49, shoulder.R 0.49 | 126 (173) | 0.0 |
| child | squat | none | 3.75 (3, 23.2, trunk~trunk) | 0 | 30 | 105.75 (684) | hip.L 0.69, knee.L 0.56, hip.R 0.69, knee.R 0.56 | 112 (175) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
