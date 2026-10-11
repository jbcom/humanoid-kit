# The foundation's smoke tier: invariant failures

Written by `node scripts/foundation-smoke.ts` from the invariant suite
(src/foundation/invariants.ts) over the smoke tier (the cross set's six shape
extremes, rest, seated, overhead and the deep squat). Tone changes no
position, so each row holds for tones 1, 3 and 6. Penetration samples every
1th welded vertex. This is the foundation lanes' worklist: the
smoke test fails if a row gets worse, and a lane that fixes one rewrites this
file in its commit.

| body | pose | anatomy | penetrating cm² (vertices, deepest mm, parts) | contacts (deepest mm) | lumen self-contact cm² (vertices) | inverted | squashed cm² (triangles) | joint volume out of band | folds (sharpest °) | seam gap (mm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f-slim | seated | default | 14.14 (468, 27.6, trunk~trunk) | 87 (27.5) | 0.27 (32) | 414 | 83.55 (662) | - | 224 (180) | 0.0 |
| f-slim | overhead | default | 23.63 (34, 28.6, head~trunk) | 42 (22.8) | 0.04 (1) | 138 | 6.91 (18) | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 26.10 (559, 29.4, trunk~trunk) | 647 (29.9) | 1.29 (60) | 804 | 178.50 (815) | hip.L 0.71, hip.R 0.71 | 292 (179) | 0.0 |
| f-heavy | rest | default | 0.04 (1, 29.1, trunk~trunk) | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | seated | default | 28.04 (384, 29.7, trunk~trunk) | 199 (28.5) | 0.41 (33) | 701 | 168.05 (567) | - | 196 (179) | 0.0 |
| f-heavy | overhead | default | 27.26 (33, 29.1, trunk~trunk) | 58 (18.5) | 0 | 164 | 55.13 (108) | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 42.36 (724, 29.3, trunk~trunk) | 892 (29.9) | 0.93 (47) | 1328 | 214.60 (590) | hip.L 0.66, hip.R 0.66 | 348 (177) | 0.0 |
| m-muscular | seated | default | 50.77 (1154, 20.9, trunk~trunk) | 344 (14.5) | 0.01 (1) | 882 | 183.15 (556) | hip.L 0.68, hip.R 0.69 | 417 (180) | 0.0 |
| m-muscular | overhead | default | 35.39 (40, 27.5, trunk~trunk) | 52 (30.0) | 0 | 170 | 13.63 (26) | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 74.73 (1087, 27.2, trunk~trunk) | 697 (30.0) | 0.01 (1) | 1160 | 235.58 (593) | hip.L 0.50, hip.R 0.51 | 508 (180) | 0.0 |
| m-heavy | seated | default | 38.29 (1429, 17.8, trunk~trunk) | 1031 (24.8) | 0.38 (19) | 1257 | 216.34 (708) | hip.L 0.75, hip.R 0.75 | 433 (178) | 0.0 |
| m-heavy | overhead | default | 48.57 (48, 26.6, head~trunk) | 92 (29.0) | 0 | 252 | 10.37 (20) | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 74.56 (1743, 28.2, trunk~trunk) | 746 (29.9) | 0.03 (2) | 1863 | 285.45 (653) | hip.L 0.59, hip.R 0.60 | 498 (180) | 0.0 |
| f-elder | seated | default | 24.05 (506, 29.8, trunk~trunk) | 110 (28.1) | 0.47 (37) | 547 | 113.58 (488) | - | 219 (178) | 0.0 |
| f-elder | overhead | default | 32.83 (52, 27.9, head~trunk) | 70 (26.7) | 0.04 (1) | 228 | 8.61 (30) | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 27.96 (770, 29.3, trunk~head) | 743 (29.9) | 1.21 (59) | 1099 | 197.13 (757) | hip.L 0.73, hip.R 0.74 | 288 (179) | 0.0 |
| child | seated | none | 3.91 (21, 20.6, shin.R~shin.R) | 178 (21.1) | 0 | 158 | 47.23 (243) | - | 47 (150) | 0.0 |
| child | overhead | none | 13.61 (56, 26.9, upperarm.R~upperarm.R) | 106 (23.7) | 0 | 284 | 10.80 (86) | shoulder.L 0.49, shoulder.R 0.49 | 126 (173) | 0.0 |
| child | squat | none | 12.21 (66, 29.0, trunk~trunk) | 812 (29.7) | 0 | 329 | 62.17 (330) | hip.L 0.69, hip.R 0.69 | 114 (172) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0.04 (1) | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0.04 (1) | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
