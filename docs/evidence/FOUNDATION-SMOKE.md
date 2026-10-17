# Foundation smoke: REST acceptance and POSED regression budget

This recorded snapshot contains **REST FAIL: 0/6** and **POSED FAIL: 16/18**.
These are recorded measurements, not a current runtime or visual acceptance
claim. The two clean posed rows are f-slim/overhead/default and
m-muscular/overhead/default. The failing posed keys appear in the table below
before the clean rows.

REST is the only approved hard-gated pose family, explicitly listed in
`src/foundation/smokeReport.ts`. The smoke test also enforces the existing numeric
regression budget on every row. A passing budget does not establish posed
acceptance; runtime output names the POSED FAIL count and every failing key.

`node scripts/foundation-smoke.ts` measures into a new temporary directory by
default. `--output-dir <new-directory>` keeps a candidate at a chosen location.
Neither route overwrites this document or `foundation-smoke.json`. Penetration
samples every welded vertex; tone changes no position, so each row holds for
tones 1, 3 and 6.

Baseline updates require actual maintainer review of the measured candidate,
its diff, geometry changes and relevant visual evidence. After that review,
`--update-reviewed-baseline --review-reference <review-url>` explicitly records
the candidate. The reference is claimed review provenance; the script cannot
verify approval. Regeneration never promotes a pose family. Promotion requires
a separate reviewed source policy change, zero invariant failures for that
family and current visual acceptance evidence.

| body | pose | anatomy | penetrating cm² (vertices, deepest mm, parts) | contacts (deepest mm) | lumen self-contact cm² (vertices) | inverted | squashed cm² (triangles) | joint volume out of band | folds (sharpest °) | seam gap (mm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f-slim | seated | default | 5.38 (430, 20.2, trunk~trunk) | 1 (8.7) | 0 | 159 | 79.31 (701) | - | 111 (179) | 0.0 |
| f-slim | squat | default | 13.37 (228, 23.5, trunk~trunk) | 4 (5.7) | 0 | 115 | 305.20 (1398) | hip.L 0.77, knee.L 0.51, hip.R 0.76, knee.R 0.52 | 182 (180) | 0.0 |
| f-heavy | seated | default | 4.22 (87, 18.3, trunk~trunk) | 59 (10.8) | 0 | 150 | 165.14 (502) | - | 80 (169) | 0.0 |
| f-heavy | overhead | default | 0 | 0 | 0 | 0 | 14.27 (30) | - | 4 (73) | 0.0 |
| f-heavy | squat | default | 6.76 (139, 24.7, trunk~trunk) | 42 (7.0) | 0 | 113 | 354.56 (1008) | knee.L 0.50, knee.R 0.52 | 170 (179) | 0.0 |
| m-muscular | seated | default | 36.53 (859, 14.8, trunk~trunk) | 480 (9.9) | 0 | 357 | 186.56 (613) | - | 333 (179) | 0.0 |
| m-muscular | squat | default | 45.48 (811, 17.8, trunk~trunk) | 31 (9.2) | 0 | 434 | 360.96 (933) | hip.L 0.70, knee.L 0.55, hip.R 0.70, knee.R 0.55 | 389 (179) | 0.0 |
| m-heavy | seated | default | 20.89 (343, 18.1, trunk~trunk) | 862 (13.1) | 0 | 210 | 214.89 (732) | - | 349 (172) | 0.0 |
| m-heavy | overhead | default | 0 | 0 | 0 | 0 | 10.83 (18) | - | 0 | 0.0 |
| m-heavy | squat | default | 28.94 (524, 23.1, trunk~trunk) | 28 (8.1) | 0 | 353 | 511.27 (1139) | hip.L 0.77, knee.L 0.52, hip.R 0.77, knee.R 0.52 | 377 (180) | 0.0 |
| f-elder | seated | default | 4.02 (181, 22.4, trunk~trunk) | 80 (16.6) | 0 | 183 | 126.16 (573) | - | 90 (179) | 0.0 |
| f-elder | overhead | default | 0 | 12 (14.9) | 0 | 16 | 10.18 (30) | - | 8 (91) | 0.0 |
| f-elder | squat | default | 4.58 (158, 22.7, trunk~trunk) | 20 (4.4) | 0.01 (1) | 150 | 300.22 (1109) | hip.L 0.80, knee.L 0.56, hip.R 0.79, knee.R 0.56 | 176 (179) | 0.0 |
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
