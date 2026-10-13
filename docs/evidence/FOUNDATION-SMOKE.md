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
| f-slim | seated | default | 14.29 (454, 26.3, trunk~trunk) | 76 (20.5) | 0 | 353 | 83.25 (647) | - | 194 (180) | 0.0 |
| f-slim | overhead | default | 23.63 (34, 28.6, head~trunk) | 42 (22.8) | 0 | 138 | 6.91 (18) | shoulder.L 0.71, shoulder.R 0.71 | 94 (168) | 0.0 |
| f-slim | squat | default | 23.94 (427, 24.8, trunk~trunk) | 634 (29.9) | 0 | 719 | 177.96 (802) | hip.L 0.71, hip.R 0.71 | 241 (179) | 0.0 |
| f-heavy | seated | default | 28.67 (401, 19.0, trunk~trunk) | 191 (18.4) | 0 | 682 | 167.67 (552) | - | 118 (174) | 0.0 |
| f-heavy | overhead | default | 27.22 (32, 27.0, trunk~trunk) | 58 (18.5) | 0 | 164 | 55.13 (108) | shoulder.L 0.74, shoulder.R 0.74 | 106 (174) | 0.0 |
| f-heavy | squat | default | 40.62 (631, 27.8, trunk~trunk) | 881 (29.9) | 0 | 1332 | 214.14 (572) | hip.L 0.66, hip.R 0.66 | 236 (177) | 0.0 |
| m-muscular | seated | default | 50.35 (1129, 19.4, trunk~trunk) | 344 (14.5) | 0 | 806 | 183.10 (552) | hip.L 0.68, hip.R 0.69 | 377 (180) | 0.0 |
| m-muscular | overhead | default | 35.39 (40, 27.5, trunk~trunk) | 52 (30.0) | 0 | 170 | 13.63 (26) | shoulder.L 0.68, shoulder.R 0.68 | 120 (178) | 0.0 |
| m-muscular | squat | default | 74.38 (1065, 27.2, trunk~trunk) | 697 (30.0) | 0 | 1097 | 235.58 (593) | hip.L 0.50, hip.R 0.51 | 469 (180) | 0.0 |
| m-heavy | seated | default | 38.29 (870, 17.8, trunk~trunk) | 1017 (16.3) | 0 | 1250 | 215.91 (691) | hip.L 0.75, hip.R 0.75 | 356 (178) | 0.0 |
| m-heavy | overhead | default | 48.57 (48, 26.6, head~trunk) | 92 (29.0) | 0 | 252 | 10.37 (20) | shoulder.L 0.71, shoulder.R 0.71 | 112 (175) | 0.0 |
| m-heavy | squat | default | 73.75 (1186, 28.2, trunk~trunk) | 736 (29.9) | 0 | 1831 | 285.35 (648) | hip.L 0.59, hip.R 0.60 | 392 (180) | 0.0 |
| f-elder | seated | default | 24.59 (506, 24.5, trunk~trunk) | 108 (22.9) | 0.01 (1) | 496 | 113.26 (476) | - | 156 (180) | 0.0 |
| f-elder | overhead | default | 32.83 (52, 27.9, head~trunk) | 70 (26.7) | 0 | 228 | 8.61 (30) | shoulder.L 0.52, shoulder.R 0.52 | 144 (172) | 0.0 |
| f-elder | squat | default | 25.79 (638, 27.2, trunk~trunk) | 732 (29.9) | 0.01 (1) | 1021 | 196.51 (736) | hip.L 0.73, hip.R 0.74 | 201 (179) | 0.0 |
| child | seated | none | 3.82 (20, 21.3, shin.R~shin.R) | 170 (21.8) | 0 | 146 | 51.82 (249) | - | 44 (128) | 0.0 |
| child | overhead | none | 14.83 (56, 26.1, head~trunk) | 106 (20.8) | 0 | 274 | 11.13 (82) | shoulder.L 0.49, shoulder.R 0.49 | 122 (179) | 0.0 |
| child | squat | none | 13.77 (65, 26.0, trunk~trunk) | 804 (29.7) | 0 | 332 | 67.78 (331) | hip.L 0.69, hip.R 0.69 | 114 (162) | 0.0 |
| f-slim | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-heavy | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-muscular | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| m-heavy | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| f-elder | rest | default | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
| child | rest | none | 0 | 0 | 0 | 0 | 0 | - | 0 | 0.0 |
