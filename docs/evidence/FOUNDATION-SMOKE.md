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
| f-slim | seated | default | 77 (22.7, trunk~trunk) | 34 (20.5) | 532 | 372 | - | 385 (179) | 0.0 |
| f-slim | overhead | default | 7 (26.2, trunk~head) | 10 (22.8) | 138 | 18 | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 72 (25.6, trunk~trunk) | 165 (29.9) | 751 | 574 | hip.L 0.53, hip.R 0.54 | 526 (179) | 0.0 |
| f-heavy | seated | default | 152 (19.4, trunk~trunk) | 59 (16.8) | 1139 | 292 | hip.L 0.76, hip.R 0.76 | 381 (179) | 0.0 |
| f-heavy | overhead | default | 7 (27.0, trunk~trunk) | 13 (18.5) | 164 | 108 | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 227 (27.6, trunk~trunk) | 222 (30.0) | 1941 | 585 | hip.L 0.43, hip.R 0.43 | 533 (180) | 0.0 |
| m-muscular | seated | default | 340 (25.2, trunk~trunk) | 38 (14.5) | 1579 | 388 | hip.L 0.59, hip.R 0.59 | 819 (180) | 0.0 |
| m-muscular | overhead | default | 9 (27.5, trunk~trunk) | 14 (28.4) | 170 | 26 | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 405 (29.1, trunk~trunk) | 178 (29.5) | 2171 | 730 | hip.L 0.27, hip.R 0.23 | 1307 (180) | 0.0 |
| m-heavy | seated | default | 358 (16.8, trunk~trunk) | 162 (16.3) | 2307 | 531 | hip.L 0.65, hip.R 0.65 | 899 (180) | 0.0 |
| m-heavy | overhead | default | 15 (26.2, trunk~head) | 24 (25.6) | 252 | 20 | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 581 (29.6, trunk~trunk) | 213 (29.9) | 2460 | 452 | hip.L 0.36, hip.R 0.37 | 1228 (180) | 0.0 |
| f-elder | seated | default | 111 (22.6, trunk~trunk) | 24 (19.1) | 718 | 299 | - | 380 (180) | 0.0 |
| f-elder | overhead | default | 14 (27.5, trunk~trunk) | 15 (26.7) | 228 | 30 | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 147 (27.2, trunk~trunk) | 184 (29.8) | 1374 | 588 | hip.L 0.57, hip.R 0.56 | 532 (180) | 0.0 |
| child | seated | none | 13 (21.4, trunk~trunk) | 49 (21.1) | 234 | 164 | - | 135 (179) | 0.0 |
| child | overhead | none | 15 (24.7, head~head) | 27 (23.7) | 284 | 86 | shoulder.L 0.49, shoulder.R 0.49 | 126 (173) | 0.0 |
| child | squat | none | 35 (23.2, trunk~trunk) | 212 (29.7) | 434 | 256 | hip.L 0.45, hip.R 0.45 | 234 (180) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
