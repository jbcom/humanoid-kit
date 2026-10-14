# Facial-hair source recovery

This record preserves source facts discovered while completing issue #14. It is not
visual acceptance of a runtime style. Runtime acceptance is separately recorded by
the issue's rendered evidence.

## BTH Full Brown Beard

The MakeHuman Community catalogue's [BTH_Full_Brown_Beard record](http://www.makehumancommunity.org/node/3125)
identifies `jwoodwor`'s facial-hair asset as CC0 and hm08-compatible. The raw OBJ
retrieved from that record is ASCII source geometry: one connected component with
808 vertices, 808 quads, 936 UVs and 3,040 normals. Its SHA-256 is
`7f6858c683df2e3738e1b89dd9aa08b527b704b279b02de524d50aa9868386d0`.

The advertised MHCLO endpoint instead returned a 556,464-byte FBX 7.7 payload
(SHA-256 `6887221b4780b33bc18c0a236a39e0c3593397490d8a682b904db92e4c08e793`).
It has a single `BTH_Herty_Full_Beard` model with translation
`[0, 0, 511.48523835293673]` and scale `[10, 10, 10]`, but has neither a
Geometry object nor an MHCLO surface binding. Its material endpoint returned a
JPEG, and the OBJ's adjacent MTL endpoint was unavailable. Those endpoint types
are source-recovery defects; they do not invalidate the retained OBJ or its
catalogue licence claim.

The OBJ header says centimetres, although literal conversion would yield a
1.360259 m x 1.208919 m x 1.073470 m object. A 0.001 m-per-source-unit reading
yields 0.136026 m x 0.120892 m x 0.107347 m. The available payloads do not
select between those placements. Any later intake must preserve the 808-quad
mesh and establish a reproducible face/jaw binding from further source evidence;
it must not attach free-hanging vertices with a torso-nearest fallback.

## Hair Editor curves

The official [Hair Editor functional pack](https://static.makehumancommunity.org/assets/assetpacks/haireditor.html)
contains template-style `hair.blend` and `fur.blend` files by Tomáš Klecer. The
[asset-pack index](https://static.makehumancommunity.org/assets/assetpacks.html)
identifies functional packs as CC0. The raw archive
`https://files2.makehumancommunity.org/functional/haireditor.zip` was retrieved
without previews: 12,022,982 bytes, SHA-256
`39420056faba6aaa0726a5168c9c41f2d01e278a12e216c0385e8f13d4d98ab7`.

A source-only Blender 5.2.2 inspection (`--factory-startup --disable-autoexec`,
receipt `render-02bfeb75517e421da6229ef4fe7c2ec4`, exit 0) found two authored
facial curve objects in `hair/haireditor/hair.blend`:

| object | native source | span (m, X x Y x Z) | source attachment facts |
| --- | --- | --- | --- |
| `wild_beard` | 210 curves, 1,680 points, `wild_beard` material | 0.152222 x 0.110656 x 0.126567 | parent `Human`; `surface_uv_coordinate`; Surface Deform and named geometry-node modifiers; no custom properties, constraints or independent rig |
| `wild_moustache` | 37 curves, 296 points, `wild_moustache` material | 0.075107 x 0.022381 x 0.028278 | the same parent and source surface-UV pattern |

The current packer accepts source MHCLO/OBJ attachments, so it cannot consume the
curves unchanged. A later source-faithful conversion may retain their curve
points, radii, material and explicit face/jaw attachment semantics; it must not
replace them with a newly designed beard mesh. `wild_beard` is a useful
MakeHuman source but it is not the requested very-large/chest-length asset: its
0.126567 m native vertical span is shorter than the retained long-scruffy source
(about 0.147 m).

## Additional community archives checked

The public MakeHuman-2 community archive repositories separate assets by CC0,
CC-BY and AGPL. The relevant small release archives were inspected as raw file
lists, without image previews:

| repository archive | declared licence | result |
| --- | --- | --- |
| `crude_kit_CC0.zip` | CC0 | clothing, masks, gloves and props; no beard or moustache attachment |
| `bsom_astronaut_kit_agpl.zip` | AGPL | astronaut clothing and accessories; no facial-hair attachment |
| `Grins_Vader_pk_cc-by.zip` | CC-BY | costume meshes; no beard or moustache attachment |

The archive listings narrow this source family but do not establish global source
absence. The MakeHuman Community's current asset-pack index still identifies
Bodyparts 05 and 06 as its beard/moustache mesh packs; the separate broader
community and GitHub search remains documented on issue #14.

## GitHub code-index candidates

GitHub's `extension:mhclo` facial-hair results were also checked as source
payloads, rather than accepted from their path names. Two initially distinct
candidates are exact copies of assets the current hair pack already retains:

| indexed candidate | source facts | comparison |
| --- | --- | --- |
| `Ismail-Bzk/Synthetic_Face_Generator` `beard1` | `elvs_beard1_longscruffy3`; Elvaerwyn; CC-BY; hm08 binding | its MHCLO is SHA-256 `6b296383dd66db90618cf658339c966d15bf7e92d9a34b4a147e9297cf957a26` and its OBJ is SHA-256 `20c392b90017f9b9493126378645107317d47564947897d169e64c1de7f6ae89`, exactly matching the current `beard-long-scruffy` source |
| `isislab-unisa/3dify` `Full_beard` | `grinsegold`; AGPL3 source header; hm08 binding | its MHCLO is SHA-256 `a46d91b7c1762e2019cca9188ca2210cc859256e504d699631a663cfb191a8c4` and its OBJ is SHA-256 `dd7defd621f8ade07ae89159ee8c20696261786b8f308e1aad2cf69e78d83866`, exactly matching the current `beard-black-full` source |

The former evaluates through its retained MHCLO binding to a 0.147262 m vertical
span on the current body pack. This verifies that the GitHub copy is not the
missing chest-length source; it does not reject either source's permitted
licence profile.
