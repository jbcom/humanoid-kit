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
| f-slim | seated | default | 68 (22.6, trunk~trunk) | 33 (17.2) | 466 | 385 | - | 319 (180) | 0.0 |
| f-slim | overhead | default | 7 (26.2, trunk~head) | 10 (22.8) | 138 | 18 | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 49 (28.9, trunk~trunk) | 158 (29.7) | 538 | 512 | hip.L 0.66, hip.R 0.66 | 341 (179) | 0.0 |
| f-heavy | seated | default | 119 (18.3, trunk~trunk) | 78 (18.4) | 851 | 312 | - | 307 (179) | 0.0 |
| f-heavy | overhead | default | 7 (27.0, trunk~trunk) | 13 (18.5) | 164 | 108 | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 115 (23.7, trunk~trunk) | 227 (29.7) | 1090 | 417 | hip.L 0.66, hip.R 0.66 | 364 (179) | 0.0 |
| m-muscular | seated | default | 104 (16.0, trunk~trunk) | 20 (12.9) | 739 | 368 | hip.L 0.69, hip.R 0.69 | 449 (180) | 0.0 |
| m-muscular | overhead | default | 9 (27.5, trunk~trunk) | 14 (28.4) | 170 | 26 | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 75 (22.4, trunk~trunk) | 176 (30.0) | 732 | 384 | hip.L 0.50, hip.R 0.52 | 425 (179) | 0.0 |
| m-heavy | seated | default | 168 (17.3, trunk~trunk) | 32 (12.0) | 1574 | 513 | hip.L 0.76, hip.R 0.76 | 423 (180) | 0.0 |
| m-heavy | overhead | default | 15 (26.2, trunk~head) | 24 (25.6) | 252 | 20 | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 175 (24.6, trunk~trunk) | 183 (29.8) | 1662 | 391 | hip.L 0.61, hip.R 0.62 | 395 (180) | 0.0 |
| f-elder | seated | default | 86 (21.2, trunk~trunk) | 29 (19.8) | 586 | 274 | - | 290 (180) | 0.0 |
| f-elder | overhead | default | 14 (27.5, trunk~trunk) | 14 (26.7) | 228 | 30 | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 92 (25.3, trunk~trunk) | 185 (29.9) | 861 | 389 | hip.L 0.72, hip.R 0.72 | 362 (180) | 0.0 |
| child | seated | none | 12 (21.4, trunk~trunk) | 48 (21.1) | 227 | 157 | - | 128 (179) | 0.0 |
| child | overhead | none | 15 (24.7, head~head) | 27 (23.7) | 284 | 86 | shoulder.L 0.49, shoulder.R 0.49 | 126 (173) | 0.0 |
| child | squat | none | 25 (23.2, trunk~trunk) | 209 (29.7) | 374 | 183 | hip.L 0.69, hip.R 0.69 | 175 (179) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
