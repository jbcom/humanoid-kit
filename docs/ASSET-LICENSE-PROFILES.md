# Asset-licence build profiles

The MIT licence for humanoid-kit code does not change with an asset profile.
The profile selects which asset data a pack build includes.

## Profiles

`commercial` is the default. It includes CC0 asset data and an explicitly
recorded asset only when its selected licence has verified commercial-use and
redistribution permission, and its source, author, required attribution text,
modifications, and share-alike obligation are complete. This includes a
verified CC-BY 3.0 or CC-BY 4.0 selection; the selected grant, rather than a
licence-name allow-list, is what controls inclusion. The packer generates an
attribution file for every included attribution-licensed asset.

`cc0-only` includes CC0 asset data only. It omits attribution-licensed features
and writes explicit unavailable-feature metadata containing the feature id,
actual licence, source and reason. It never replaces an omitted feature with a
generated approximation or an unrelated asset.

An asset is refused when the selected licence has not been verified to permit
both commercial use and the intended redistribution, or when its required
provenance/attribution metadata is incomplete. Commercial use by itself is not
treated as redistribution permission.

## Packer contract

Each packer accepts the shared option:

```text
--asset-license-profile cc0-only|commercial
```

It calls `parseAssetLicenceProfile` before reading pack-specific arguments and
uses `selectAssetForProfile` for every candidate whose data may ship. A packer
owns its manifest schema and therefore records both selected assets and its
unavailable features there. It writes the stable output of
`renderAssetAttribution` into the pack data directory and lists the file in its
tarball check.

The profile is evaluated from each asset's actual licence and provenance record.
It is not inferred from the package's own licence, a feature name, or the
presence of an adult pack. Adult policy remains a separate runtime gate.

## Current profile boundary

The shared helper is `scripts/lib/assetLicenceProfile.ts`. Its records are
deliberately renderer-neutral and do not create public runtime exports. Packer
hooks, generated data, and feature-specific acceptance tests remain with the
pack that owns the asset.

`scripts/pack-hair.ts` consumes the option for its MakeHuman Community facial
attachments. Its default commercial output includes the verified bodyparts06
records and writes `packs/hair/data/ASSET-ATTRIBUTION.md`; its `cc0-only`
output retains the bodyparts05 set and records each bodyparts06 feature as
unavailable. The grinsegold bodyparts06 MHCLO and OBJ headers, and the
culturalibre moustache OBJ header, say `AGPL3` while the official archive record
says `CC-BY`; the generated attribution and provenance record each conflict and
preserve the source-header share-alike notice. The
generated `ASSET-SOURCES.md` pins the original Bodyparts06 archive and describes
the source paths and transformations needed to reproduce the derived files.
