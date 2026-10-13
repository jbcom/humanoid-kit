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
| f-slim | seated | default | 9.45 (434, 23.4, trunk~trunk) | 40 (23.4) | 0 | 224 | 86.96 (683) | - | 181 (179) | 0.0 |
| f-slim | overhead | default | 23.63 (34, 28.6, head~trunk) | 42 (22.8) | 0 | 138 | 6.91 (18) | - | 94 (168) | 0.0 |
| f-slim | squat | default | 15.44 (183, 23.9, trunk~trunk) | 5 (7.0) | 0 | 200 | 296.20 (1308) | hip.L 0.77, knee.L 0.51, hip.R 0.77, knee.R 0.52 | 231 (180) | 0.0 |
| f-heavy | seated | default | 6.66 (168, 17.7, trunk~trunk) | 74 (17.8) | 0 | 261 | 178.23 (584) | - | 110 (169) | 0.0 |
| f-heavy | overhead | default | 27.22 (32, 27.0, trunk~trunk) | 58 (18.5) | 0 | 164 | 55.13 (108) | - | 106 (174) | 0.0 |
| f-heavy | squat | default | 6.12 (179, 27.8, trunk~trunk) | 18 (6.8) | 0 | 168 | 350.22 (995) | knee.L 0.50, knee.R 0.52 | 226 (177) | 0.0 |
| m-muscular | seated | default | 39.80 (906, 19.4, trunk~trunk) | 333 (9.0) | 0 | 369 | 200.21 (636) | - | 369 (180) | 0.0 |
| m-muscular | overhead | default | 35.39 (40, 27.5, trunk~trunk) | 52 (30.0) | 0 | 170 | 13.63 (26) | - | 120 (178) | 0.0 |
| m-muscular | squat | default | 41.28 (832, 27.2, trunk~trunk) | 16 (4.7) | 0 | 407 | 381.36 (960) | hip.L 0.70, knee.L 0.55, hip.R 0.71, knee.R 0.55 | 441 (180) | 0.0 |
| m-heavy | seated | default | 17.74 (339, 17.8, trunk~trunk) | 933 (13.6) | 0 | 223 | 235.92 (748) | - | 356 (178) | 0.0 |
| m-heavy | overhead | default | 48.57 (48, 26.6, head~trunk) | 92 (29.0) | 0 | 252 | 10.37 (20) | - | 112 (175) | 0.0 |
| m-heavy | squat | default | 34.38 (562, 28.2, trunk~trunk) | 15 (8.6) | 0 | 336 | 535.33 (1117) | hip.L 0.77, knee.L 0.52, hip.R 0.77, knee.R 0.52 | 376 (180) | 0.0 |
| f-elder | seated | default | 7.58 (246, 24.5, trunk~trunk) | 110 (21.3) | 0.01 (1) | 278 | 129.37 (545) | - | 152 (180) | 0.0 |
| f-elder | overhead | default | 32.83 (52, 27.9, head~trunk) | 70 (26.7) | 0 | 228 | 8.61 (30) | - | 144 (172) | 0.0 |
| f-elder | squat | default | 3.66 (197, 27.2, trunk~trunk) | 3 (4.0) | 0.01 (1) | 136 | 310.69 (1156) | hip.L 0.80, knee.L 0.56, hip.R 0.80, knee.R 0.56 | 198 (179) | 0.0 |
| child | seated | none | 0 | 0 | 0 | 0 | 50.76 (243) | - | 38 (128) | 0.0 |
| child | overhead | none | 14.83 (56, 26.1, head~trunk) | 106 (20.8) | 0 | 274 | 11.13 (82) | - | 122 (179) | 0.0 |
| child | squat | none | 5.78 (25, 26.0, trunk~trunk) | 4 (4.8) | 0 | 31 | 118.22 (711) | knee.L 0.51, knee.R 0.50 | 119 (176) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
