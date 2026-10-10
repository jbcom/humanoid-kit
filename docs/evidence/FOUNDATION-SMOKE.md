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
| f-slim | seated | default | 13.31 (67, 23.2, trunk~trunk) | 22 (20.5) | 468 | 82.74 (609) | - | 215 (179) | 0.0 |
| f-slim | overhead | default | 20.52 (7, 26.2, trunk~head) | 10 (22.8) | 138 | 6.91 (18) | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 19.25 (62, 24.0, trunk~trunk) | 161 (29.9) | 638 | 178.15 (809) | hip.L 0.71, hip.R 0.71 | 210 (179) | 0.0 |
| f-heavy | seated | default | 22.85 (107, 17.6, trunk~trunk) | 44 (16.8) | 834 | 167.35 (534) | - | 161 (178) | 0.0 |
| f-heavy | overhead | default | 22.58 (7, 27.0, trunk~trunk) | 13 (18.5) | 164 | 55.13 (108) | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 35.21 (147, 28.3, trunk~trunk) | 213 (29.9) | 1319 | 214.14 (572) | hip.L 0.66, hip.R 0.66 | 251 (177) | 0.0 |
| m-muscular | seated | default | 50.17 (319, 16.6, trunk~trunk) | 37 (14.5) | 1471 | 183.22 (561) | hip.L 0.68, hip.R 0.69 | 408 (180) | 0.0 |
| m-muscular | overhead | default | 24.97 (9, 27.5, trunk~trunk) | 14 (28.4) | 170 | 13.63 (26) | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 77.96 (310, 22.4, trunk~trunk) | 172 (29.5) | 1521 | 235.63 (596) | hip.L 0.50, hip.R 0.51 | 553 (180) | 0.0 |
| m-heavy | seated | default | 48.23 (289, 15.9, trunk~trunk) | 245 (16.3) | 1722 | 216.09 (700) | hip.L 0.75, hip.R 0.75 | 408 (179) | 0.0 |
| m-heavy | overhead | default | 57.12 (15, 26.2, trunk~head) | 24 (25.6) | 252 | 10.37 (20) | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 66.72 (336, 23.3, trunk~trunk) | 202 (29.9) | 2002 | 285.49 (658) | hip.L 0.59, hip.R 0.60 | 511 (180) | 0.0 |
| f-elder | seated | default | 21.52 (106, 21.1, trunk~trunk) | 15 (19.1) | 661 | 113.10 (473) | - | 178 (180) | 0.0 |
| f-elder | overhead | default | 35.94 (14, 27.5, trunk~trunk) | 15 (26.7) | 228 | 8.61 (30) | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 23.99 (123, 27.2, trunk~trunk) | 179 (29.8) | 1031 | 196.66 (745) | hip.L 0.73, hip.R 0.74 | 213 (180) | 0.0 |
| child | seated | none | 2.66 (3, 20.6, shin.L~shin.L) | 48 (21.1) | 158 | 47.23 (243) | - | 47 (150) | 0.0 |
| child | overhead | none | 14.64 (15, 24.7, head~head) | 27 (23.7) | 284 | 10.80 (86) | shoulder.L 0.49, shoulder.R 0.49 | 126 (173) | 0.0 |
| child | squat | none | 15.38 (17, 23.2, trunk~trunk) | 209 (29.7) | 329 | 62.17 (330) | hip.L 0.69, hip.R 0.69 | 114 (172) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
