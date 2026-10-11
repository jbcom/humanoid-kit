# The foundation's smoke tier: invariant failures

Written by `node scripts/foundation-smoke.ts` from the invariant suite
(src/foundation/invariants.ts) over the smoke tier (the cross set's six shape
extremes, rest, seated, overhead and the deep squat). Tone changes no
position, so each row holds for tones 1, 3 and 6. Penetration samples every
4th welded vertex. This is the foundation lanes' worklist: the
smoke test fails if a row gets worse, and a lane that fixes one rewrites this
file in its commit.

| body | pose | anatomy | penetrating cm² (vertices, deepest mm, parts) | contacts (deepest mm) | lumen self-contact cm² (vertices) | inverted | squashed cm² (triangles) | joint volume out of band | folds (sharpest °) | seam gap (mm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f-slim | seated | default | 12.44 (61, 27.5, trunk~trunk) | 26 (26.1) | 0.04 (3) | 414 | 83.55 (662) | - | 224 (180) | 0.0 |
| f-slim | overhead | default | 20.52 (7, 26.2, trunk~head) | 10 (22.8) | 0 | 138 | 6.91 (18) | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 23.67 (105, 28.5, trunk~trunk) | 161 (29.9) | 0.90 (10) | 804 | 178.50 (815) | hip.L 0.71, hip.R 0.71 | 292 (179) | 0.0 |
| f-heavy | seated | default | 23.07 (92, 18.4, trunk~trunk) | 51 (28.5) | 0.25 (7) | 701 | 168.05 (567) | - | 196 (179) | 0.0 |
| f-heavy | overhead | default | 22.58 (7, 27.0, trunk~trunk) | 13 (18.5) | 0 | 164 | 55.13 (108) | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 37.57 (166, 28.8, trunk~trunk) | 210 (29.9) | 0.58 (10) | 1328 | 214.60 (590) | hip.L 0.66, hip.R 0.66 | 348 (177) | 0.0 |
| m-muscular | seated | default | 48.01 (282, 20.8, trunk~trunk) | 89 (14.5) | 0 | 882 | 183.15 (556) | hip.L 0.68, hip.R 0.69 | 417 (180) | 0.0 |
| m-muscular | overhead | default | 24.97 (9, 27.5, trunk~trunk) | 14 (28.4) | 0 | 170 | 13.63 (26) | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 74.20 (272, 22.4, trunk~trunk) | 170 (29.5) | 0 | 1160 | 235.58 (593) | hip.L 0.50, hip.R 0.51 | 508 (180) | 0.0 |
| m-heavy | seated | default | 37.20 (220, 17.8, trunk~trunk) | 261 (24.8) | 0.34 (4) | 1257 | 216.34 (708) | hip.L 0.75, hip.R 0.75 | 433 (178) | 0.0 |
| m-heavy | overhead | default | 57.12 (15, 26.2, trunk~head) | 24 (25.6) | 0 | 252 | 10.37 (20) | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 67.24 (311, 22.8, trunk~trunk) | 204 (29.9) | 0.02 (1) | 1863 | 285.45 (653) | hip.L 0.59, hip.R 0.60 | 498 (180) | 0.0 |
| f-elder | seated | default | 21.04 (98, 29.2, trunk~trunk) | 20 (28.1) | 0.28 (8) | 547 | 113.58 (488) | - | 219 (178) | 0.0 |
| f-elder | overhead | default | 35.94 (14, 27.5, trunk~trunk) | 15 (26.7) | 0 | 228 | 8.61 (30) | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 25.50 (144, 28.6, trunk~trunk) | 179 (29.8) | 0.79 (12) | 1099 | 197.13 (757) | hip.L 0.73, hip.R 0.74 | 288 (179) | 0.0 |
| child | seated | none | 2.66 (3, 20.6, shin.L~shin.L) | 48 (21.1) | 0 | 158 | 47.23 (243) | - | 47 (150) | 0.0 |
| child | overhead | none | 14.64 (15, 24.7, head~head) | 27 (23.7) | 0 | 284 | 10.80 (86) | shoulder.L 0.49, shoulder.R 0.49 | 126 (173) | 0.0 |
| child | squat | none | 15.38 (17, 23.2, trunk~trunk) | 209 (29.7) | 0 | 329 | 62.17 (330) | hip.L 0.69, hip.R 0.69 | 114 (172) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
