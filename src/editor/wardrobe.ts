/**
 * The creator's wardrobe, as plain functions: what the clothing pack offers,
 * grouped for browsing, and the recipe change that wearing or taking off a
 * garment makes. A person wears one garment of each kind (one suit, one pair
 * of shoes, one hat) and layers kinds over one another (a jacket over a suit);
 * the recipe itself is not limited to that, only this editor.
 */
import type { ClothingManifest } from "../format/assetFormat.ts";
import { GARMENT_LAYERS } from "../model/outfit.ts";
import type { Recipe } from "../recipe/recipe.ts";

/** What a wardrobe lists of a garment, before its geometry has loaded. */
export interface WardrobeEntry {
  id: string;
  /** The asset's own name (a file name). */
  name: string;
  /** What to call it in a list: "Brown oxfords". */
  label: string;
  /** The category it stacks as (`GARMENT_LAYERS`). */
  kind: string;
  tags: string[];
}

export interface WardrobeGroup {
  kind: string;
  label: string;
  garments: WardrobeEntry[];
}

/** Headings for the categories; one not named here is listed under its own name. */
const LABELS: Record<string, string> = {
  underwear: "Underwear",
  socks: "Socks",
  clothes: "Outfits",
  sweater: "Sweaters",
  jacket: "Jackets",
  shoes: "Shoes",
  coat: "Coats",
  hat: "Hats",
  backpack: "Backpacks",
};

/** The garments a clothing pack's manifest lists; none without a clothing pack. */
export function wardrobeOf(manifest: ClothingManifest | null): WardrobeEntry[] {
  return (manifest?.garments.entries ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    label: g.label,
    kind: g.kind,
    tags: g.tags,
  }));
}

/** The wardrobe by category, in the order people dress: underwear first, backpacks last. */
export function wardrobeGroups(wardrobe: readonly WardrobeEntry[]): WardrobeGroup[] {
  const rank = (kind: string) =>
    (GARMENT_LAYERS as Readonly<Record<string, number>>)[kind] ?? Number.POSITIVE_INFINITY;
  const kinds = [...new Set(wardrobe.map((g) => g.kind))].sort((p, q) => rank(p) - rank(q));
  return kinds.map((kind) => ({
    kind,
    label: LABELS[kind] ?? kind,
    garments: wardrobe.filter((g) => g.kind === kind),
  }));
}

/** The garment ids a recipe wears. */
export const wornIn = (recipe: Recipe): readonly string[] => recipe.outfit ?? [];

/**
 * The recipe wearing `garment`, or without it when it is worn already. Any
 * other garment of its kind comes off, so choosing a second suit changes suit.
 * Nothing else about the recipe changes, and an empty outfit is left out
 * rather than saved as an empty list.
 */
export function wearGarment(
  recipe: Recipe,
  garment: WardrobeEntry,
  wardrobe: readonly WardrobeEntry[],
): Recipe {
  const { outfit: _outfit, ...rest } = recipe;
  const worn = wornIn(recipe);
  const sameKind = new Set(wardrobe.filter((g) => g.kind === garment.kind).map((g) => g.id));
  const kept = worn.filter((id) => !sameKind.has(id));
  const next = worn.includes(garment.id) ? kept : [...kept, garment.id];
  return next.length ? { ...rest, outfit: next } : rest;
}
