/**
 * Packs the MakeHuman system hair and profile-selected community facial hair
 * into `packs/hair`.
 *
 *   node scripts/pack-hair.ts [--asset-license-profile cc0-only|commercial] <system-assets-dir> <community-archives-dir>
 *
 * The first argument is the extracted "MakeHuman system assets" pack
 * (makehuman_system_assets_cc0.zip); the second holds the community archives
 * (`<id>/<id>_cc0.zip`), here `bodyparts05` and `bodyparts06` for facial hair. The hair binds to, and is baked against,
 * the body pack committed in `packs/body/data`, so a changed body pack needs
 * this rerun (`pack-makehuman.ts` runs it last). See `scripts/lib/packHair.ts`.
 */
import path from "node:path";
import { parseAssetLicenceProfile } from "./lib/assetLicenceProfile.ts";
import { packHair } from "./lib/packHair.ts";

const { profile, args } = parseAssetLicenceProfile(process.argv.slice(2));
const [arg, community] = args;
if (!arg || !community || args.length !== 2)
  throw new Error(
    "usage: node scripts/pack-hair.ts [--asset-license-profile cc0-only|commercial] <system-assets-dir> <community-archives-dir>",
  );

await packHair({
  systemDir: path.resolve(arg),
  communityDir: path.resolve(community),
  bodyDir: path.resolve(import.meta.dirname, "../packs/body/data"),
  outDir: path.resolve(import.meta.dirname, "../packs/hair/data"),
  assetLicenceProfile: profile,
});
