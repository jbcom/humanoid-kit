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
| f-slim | seated | default | 5.48 (431, 22.2, trunk~trunk) | 1 (8.7) | 0 | 171 | 79.31 (701) | - | 112 (179) | 0.0 |
| f-slim | squat | default | 13.52 (231, 23.4, trunk~trunk) | 4 (5.7) | 0 | 104 | 305.20 (1398) | hip.L 0.77, knee.L 0.51, hip.R 0.76, knee.R 0.52 | 178 (180) | 0.0 |
| f-heavy | seated | default | 5.07 (108, 18.1, trunk~trunk) | 59 (10.8) | 0 | 160 | 165.04 (498) | - | 65 (169) | 0.0 |
| f-heavy | overhead | default | 0 | 0 | 0 | 0 | 14.27 (30) | - | 4 (73) | 0.0 |
| f-heavy | squat | default | 7.17 (149, 24.7, trunk~trunk) | 43 (22.4) | 0 | 98 | 354.56 (1008) | knee.L 0.50, knee.R 0.52 | 169 (179) | 0.0 |
| m-muscular | seated | default | 36.62 (863, 14.8, trunk~trunk) | 482 (9.9) | 0 | 358 | 186.57 (613) | - | 333 (179) | 0.0 |
| m-muscular | squat | default | 45.53 (811, 17.8, trunk~trunk) | 30 (9.2) | 0 | 432 | 360.32 (932) | hip.L 0.70, knee.L 0.55, hip.R 0.70, knee.R 0.55 | 385 (179) | 0.0 |
| m-heavy | seated | default | 20.81 (341, 18.1, trunk~trunk) | 850 (13.1) | 0 | 220 | 214.85 (726) | - | 333 (166) | 0.0 |
| m-heavy | overhead | default | 0 | 0 | 0 | 0 | 10.83 (18) | - | 0 | 0.0 |
| m-heavy | squat | default | 29.34 (537, 23.1, trunk~trunk) | 29 (8.1) | 0 | 343 | 511.28 (1139) | hip.L 0.77, knee.L 0.52, hip.R 0.77, knee.R 0.52 | 368 (179) | 0.0 |
| f-elder | seated | default | 4.08 (182, 22.3, trunk~trunk) | 81 (16.6) | 0 | 199 | 126.16 (573) | - | 93 (179) | 0.0 |
| f-elder | overhead | default | 0 | 12 (14.9) | 0 | 16 | 10.18 (30) | - | 8 (91) | 0.0 |
| f-elder | squat | default | 4.65 (158, 21.3, trunk~trunk) | 20 (4.4) | 0.01 (1) | 151 | 300.22 (1109) | hip.L 0.80, knee.L 0.56, hip.R 0.79, knee.R 0.56 | 178 (179) | 0.0 |
| child | seated | none | 0.36 (2, 6.2, trunk~trunk) | 0 | 0 | 4 | 39.79 (193) | - | 32 (140) | 0.0 |
| child | overhead | none | 0 | 0 | 0 | 0 | 7.88 (44) | - | 4 (91) | 0.0 |
| child | squat | none | 2.21 (10, 10.0, thigh.R~thigh.R) | 6 (4.6) | 0 | 8 | 110.17 (662) | knee.L 0.51, knee.R 0.50 | 91 (176) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-slim | overhead | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | overhead | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
