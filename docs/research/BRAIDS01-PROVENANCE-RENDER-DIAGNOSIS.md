# `braids01` provenance and render diagnosis

**Scope.** This is a read-only trace for the reported front capture of `scalp-braids01` on the balanced, adult female case. It identifies the artifact's source, packed representation, and renderer path. It does not claim a visual acceptance result and proposes no asset, shader, or lab change.

## Finding

`braids01` is not a degraded import of an external braid mesh or texture. It is an authored pack style: each braid is one generated, five-sided opaque tube whose apparent plait is drawn into a generated texture atlas. The renderer uses that packed tube and map without a style-specific substitute or tier. The thick root clumps and rope-like hanging silhouette therefore follow directly from the generated geometry; they are not evidence of a missing CC0 source asset, an omitted alpha map, or a texture-tier fallback.

## Evidence chain

| Layer | Exact artifact and evidence | What it establishes |
| --- | --- | --- |
| CC0 input | `packs/body/data/manifest.json` identifies the CC0 MakeHuman body input. `packs/hair/data/PROVENANCE.md` says authored styles bind only to that base mesh. | The base body used for attachment binding is CC0. |
| Style provenance | `packs/hair/data/PROVENANCE.md` marks `braids01` “authored by the packer”; it separately lists the imported MakeHuman `hair/braid01` files. These are different style IDs. | There is no external CC0 `braids01` source mesh or source texture to recover. |
| Generated geometry | `scripts/lib/hairCards/index.ts` maps `braids01` to `boxBraids`. `scripts/lib/hairCards/styles.ts` maps that to `ropeGrid(BOX_BRAIDS)`. `scripts/lib/hairCards/ropes.ts` makes each root into one tube with `addTube`; it does not generate three separately interlaced strands. | The silhouette is a tube silhouette. The plait is not structural geometry. |
| Generated texture | `scripts/lib/hairCards/atlas.ts` `braidAtlas(7)` draws V-shaped stitch bands into a vector/SVG raster. Packed `braids01.webp` is 512 × 1024 RGB with no alpha. SHA-256: `35de9774062d8fe7b48bb82a33eea917acc198307f16acf85fb61f1192509c65`. | The map supplies surface bands and fibres only; it cannot cut away or separate the tube silhouette. |
| Packed mesh | `packs/hair/data/manifest.json`: 13,425 vertices, 12,530 faces, `braids01.bin.gz`, SHA-256 `d76cdc6173951d87370a2863a24ece6e87039bac9113854c2e6e4be61524fd9c`, decompressed layout size 1,110,458 bytes. | The reviewed pack is a concrete authored mesh, not a run-time import. |
| Renderer | `src/react/Humanoid.tsx` `HairMesh` loads `topology.textureUrl`, sends pigment and `topology.strand` to generic `HairMaterial`, and sets multisampling. `src/render/hairMaterial.ts` is a generic card/hair material with alpha test and alpha-to-coverage. | No `braids01` branch or tier selection is present between packed asset and material. |

## Why the reported appearance follows from the authored design

`BOX_BRAIDS` is configured as 18 mm grid spacing, 7.2 mm nominal radius, 3.5 mm tip radius, five tube sides, 14 segments, 300 mm nominal length, 0.1 drift, 0.3 rise, and 0.3 stiffness.

Every `ropeGrid` style applies `collar: 0.7`. `ropeRadius` widens the first 30 mm of each rope by up to 1.7×. For `braids01`, that yields a nominal root radius of 12.24 mm (24.48 mm diameter) before it narrows. The grid's nominal 18 mm step is therefore smaller than the full widest root diameter. Surface curvature and projection affect the exact distances, so this is not a contact measurement, but it is enough to explain a crowded, bulbous root region rather than visually separated square partings.

The tube has five sides. Its only repeated braid signal is the opaque RGB atlas: four V-stitch columns across each tile with a 36-pixel pitch. The atlas does not contain alpha, and `addTube` creates full geometry around the circumference. Consequently:

- alpha testing and alpha-to-coverage have no silhouette to remove for this style;
- the generic hair shader can shade the tube and its map but cannot turn one tube into visibly crossing strands;
- a close frontal view can expose facets, broad root collars, and a regular curtain of thick ropes;
- the low drift and uniform generated fall preserve that regular hanging structure.

The pack enables `transparent: true` and `alphaToCoverage: true`, while `HairMaterial` uses alpha testing and multisampling for card cut-outs. With this opaque map and solid tube geometry, those flags are not a mechanism for softening the braid outline. This is an expected no-op for silhouette, not a proved material defect.

## Ruled out by this trace

- **Missing source asset:** ruled out. `braids01` has no imported source mesh/texture; the CC0 source is the attachment's bound base mesh.
- **Wrong asset or texture tier:** no tiered/KTX2 selection exists in this path; `HairMesh` consumes the packed WebP specified by the hair manifest.
- **Dropped source alpha:** not applicable. The generated packed WebP is RGB and intentionally has no alpha.
- **A style-specific renderer omission:** none was found. The generic renderer consumes the declared map, pigment, strand metrics, and multisample setting.

## Remaining uncertainty and next diagnostic, before any fix

This trace identifies a geometry-and-atlas fidelity limit. It does not establish which authored change would meet the visual target, nor does it demonstrate that a shader replacement or a new source asset is needed.

A subsequent change proposal should first capture, at the same camera and lighting:

1. an unlit geometry view to separate tube/root silhouette from material shading;
2. a material-only comparison of the present atlas against the same geometry;
3. a measured nearest-root-spacing and root-radius sample on the bound scalp; and
4. front, three-quarter, side, and movement captures after any candidate geometry change.

That evidence can distinguish a root-density/collar adjustment from a need for real multi-strand braid geometry. It should not be inferred from the present capture alone.
