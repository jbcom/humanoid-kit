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
| f-slim | seated | default | 63 (22.7, trunk~trunk) | 72 (17.2) | 494 | 514 | - | 345 (174) | 0.0 |
| f-slim | overhead | default | 7 (26.2, trunk~head) | 10 (22.8) | 138 | 18 | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 120 (25.6, trunk~trunk) | 421 (29.7) | 972 | 508 | hip.L 0.78, hip.R 0.78 | 337 (175) | 0.0 |
| f-heavy | seated | default | 116 (23.4, thigh.R~upperarm.R) | 832 (28.4) | 2067 | 192 | - | 180 (179) | 0.0 |
| f-heavy | overhead | default | 7 (27.0, trunk~trunk) | 13 (18.5) | 164 | 108 | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 137 (28.8, thigh.L~upperarm.R) | 927 (29.8) | 2394 | 308 | hip.L 0.76, hip.R 0.76 | 218 (171) | 0.0 |
| m-muscular | seated | default | 88 (13.9, trunk~trunk) | 572 (25.6) | 2109 | 194 | hip.L 0.75, hip.R 0.75 | 291 (176) | 0.0 |
| m-muscular | overhead | default | 9 (27.5, trunk~trunk) | 14 (28.4) | 170 | 26 | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 169 (29.4, thigh.R~upperarm.L) | 791 (30.0) | 1973 | 250 | hip.L 0.68, hip.R 0.68 | 301 (159) | 0.0 |
| m-heavy | seated | default | 114 (22.9, thigh.R~upperarm.R) | 772 (29.1) | 2819 | 232 | - | 237 (168) | 0.0 |
| m-heavy | overhead | default | 15 (26.2, trunk~head) | 24 (25.6) | 252 | 20 | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 272 (29.6, trunk~trunk) | 790 (29.9) | 2786 | 248 | hip.L 0.70, hip.R 0.70 | 238 (161) | 0.0 |
| f-elder | seated | default | 93 (21.5, trunk~trunk) | 505 (19.8) | 1383 | 156 | - | 225 (169) | 0.0 |
| f-elder | overhead | default | 14 (27.5, trunk~trunk) | 14 (26.7) | 228 | 30 | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 113 (25.4, trunk~trunk) | 734 (29.9) | 1840 | 374 | - | 244 (171) | 0.0 |
| child | seated | none | 17 (21.4, trunk~trunk) | 128 (21.1) | 345 | 128 | - | 74 (175) | 0.0 |
| child | overhead | none | 15 (24.7, head~head) | 27 (23.7) | 284 | 86 | shoulder.L 0.49, shoulder.R 0.49 | 126 (173) | 0.0 |
| child | squat | none | 24 (24.6, thigh.L~upperarm.R) | 332 (29.7) | 555 | 182 | hip.L 0.79, hip.R 0.79 | 117 (161) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
