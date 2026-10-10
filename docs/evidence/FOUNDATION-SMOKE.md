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
| f-slim | seated | default | 12.89 (62, 21.4, trunk~trunk) | 22 (20.5) | 420 | 82.68 (601) | - | 181 (179) | 0.0 |
| f-slim | overhead | default | 20.52 (7, 26.2, trunk~head) | 10 (22.8) | 138 | 6.91 (18) | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 18.72 (56, 24.0, trunk~trunk) | 161 (29.9) | 589 | 178.15 (809) | hip.L 0.71, hip.R 0.71 | 188 (179) | 0.0 |
| f-heavy | seated | default | 22.14 (98, 17.6, trunk~trunk) | 44 (16.8) | 744 | 167.53 (549) | - | 107 (170) | 0.0 |
| f-heavy | overhead | default | 22.58 (7, 27.0, trunk~trunk) | 13 (18.5) | 164 | 55.13 (108) | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 34.83 (143, 28.0, trunk~trunk) | 213 (29.9) | 1301 | 214.14 (572) | hip.L 0.66, hip.R 0.66 | 228 (177) | 0.0 |
| m-muscular | seated | default | 42.07 (270, 16.6, trunk~trunk) | 33 (14.5) | 820 | 183.11 (553) | hip.L 0.68, hip.R 0.69 | 381 (180) | 0.0 |
| m-muscular | overhead | default | 24.97 (9, 27.5, trunk~trunk) | 14 (28.4) | 170 | 13.63 (26) | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 71.51 (278, 22.4, trunk~trunk) | 172 (29.5) | 1089 | 235.58 (593) | hip.L 0.50, hip.R 0.51 | 470 (180) | 0.0 |
| m-heavy | seated | default | 49.58 (291, 15.9, trunk~trunk) | 266 (16.3) | 1303 | 215.95 (693) | hip.L 0.75, hip.R 0.75 | 355 (178) | 0.0 |
| m-heavy | overhead | default | 57.12 (15, 26.2, trunk~head) | 24 (25.6) | 252 | 10.37 (20) | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 65.96 (335, 22.9, trunk~trunk) | 201 (29.9) | 1825 | 285.35 (648) | hip.L 0.59, hip.R 0.60 | 393 (178) | 0.0 |
| f-elder | seated | default | 20.92 (99, 21.1, trunk~trunk) | 15 (19.1) | 580 | 112.90 (448) | - | 138 (175) | 0.0 |
| f-elder | overhead | default | 35.94 (14, 27.5, trunk~trunk) | 15 (26.7) | 228 | 8.61 (30) | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 23.54 (118, 27.1, trunk~trunk) | 179 (29.8) | 985 | 196.66 (745) | hip.L 0.73, hip.R 0.74 | 192 (180) | 0.0 |
| child | seated | none | 2.66 (3, 20.6, shin.L~shin.L) | 48 (21.1) | 158 | 47.23 (243) | - | 47 (150) | 0.0 |
| child | overhead | none | 14.64 (15, 24.7, head~head) | 27 (23.7) | 284 | 10.80 (86) | shoulder.L 0.49, shoulder.R 0.49 | 126 (173) | 0.0 |
| child | squat | none | 15.38 (17, 23.2, trunk~trunk) | 209 (29.7) | 329 | 62.17 (330) | hip.L 0.69, hip.R 0.69 | 114 (172) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
