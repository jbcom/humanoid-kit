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
| f-slim | seated | default | 75 (22.7, trunk~trunk) | 34 (20.5) | 532 | 393 | - | 385 (179) | 0.0 |
| f-slim | overhead | default | 7 (26.2, trunk~head) | 10 (22.8) | 138 | 18 | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 60 (25.6, trunk~trunk) | 171 (29.9) | 667 | 628 | hip.L 0.72, hip.R 0.73 | 461 (179) | 0.0 |
| f-heavy | seated | default | 122 (17.7, trunk~trunk) | 55 (16.8) | 991 | 318 | - | 428 (180) | 0.0 |
| f-heavy | overhead | default | 7 (27.0, trunk~trunk) | 13 (18.5) | 164 | 108 | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 154 (27.6, trunk~trunk) | 214 (29.9) | 1657 | 347 | hip.L 0.67, hip.R 0.67 | 514 (179) | 0.0 |
| m-muscular | seated | default | 311 (19.8, trunk~trunk) | 26 (14.5) | 1268 | 365 | hip.L 0.68, hip.R 0.68 | 733 (180) | 0.0 |
| m-muscular | overhead | default | 9 (27.5, trunk~trunk) | 14 (28.4) | 170 | 26 | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 295 (22.4, trunk~trunk) | 178 (29.5) | 1522 | 285 | hip.L 0.51, hip.R 0.51 | 832 (180) | 0.0 |
| m-heavy | seated | default | 316 (16.1, trunk~trunk) | 193 (16.3) | 1962 | 551 | hip.L 0.75, hip.R 0.75 | 813 (180) | 0.0 |
| m-heavy | overhead | default | 15 (26.2, trunk~head) | 24 (25.6) | 252 | 20 | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 331 (29.6, trunk~trunk) | 207 (29.9) | 2368 | 318 | hip.L 0.61, hip.R 0.61 | 878 (180) | 0.0 |
| f-elder | seated | default | 110 (21.6, trunk~trunk) | 23 (19.1) | 661 | 280 | - | 389 (180) | 0.0 |
| f-elder | overhead | default | 14 (27.5, trunk~trunk) | 15 (26.7) | 228 | 30 | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 123 (27.2, trunk~trunk) | 183 (29.8) | 1259 | 490 | hip.L 0.74, hip.R 0.75 | 534 (179) | 0.0 |
| child | seated | none | 12 (21.4, trunk~trunk) | 48 (21.1) | 228 | 160 | - | 129 (179) | 0.0 |
| child | overhead | none | 15 (24.7, head~head) | 27 (23.7) | 284 | 86 | shoulder.L 0.49, shoulder.R 0.49 | 126 (173) | 0.0 |
| child | squat | none | 35 (23.2, trunk~trunk) | 210 (29.7) | 444 | 199 | hip.L 0.71, hip.R 0.71 | 180 (176) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
