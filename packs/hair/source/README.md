# Bodyparts06 source subset

This directory preserves the unmodified upstream source folders for the
Bodyparts06 attachments whose mesh or binding files state `AGPL3`:

- `culturalibre_dal_moustache/` (the official pack record and MHCLO say CC-BY;
  its OBJ header says AGPL3),
- `grinsegold_full_beard/`, and
- `grinsegold_moustache/` (their MHCLO and OBJ headers say AGPL3 while the
  official pack record says CC-BY).

They were copied byte-for-byte from
<https://files.makehumancommunity.org/asset_packs/bodyparts06/bodyparts06_cc-by.zip>,
SHA-256 `09ed71439c853eac01a92f6e4463f15d0701f08b7d9ff777771d10c3e590e770`.
The source headers name the original authors where supplied; generated pack
credit and the complete record/header conflict are in
`../data/ASSET-ATTRIBUTION.md` and `../data/PROVENANCE.md`.

`AGPL-3.0.txt` is the GNU Affero General Public License, version 3, named by
those source headers, copied from <https://www.gnu.org/licenses/agpl-3.0.txt>
(SHA-256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`).

The packer retains the source mesh topology and hm08 binding, emits a compressed
runtime binary, and converts the selected diffuse texture to a luminance-only
strand map. It does not modify the files in this directory.
