/**
 * Rune page validation against /lol-perks/v1/styles, so the phone gets a clear message instead of
 * the client silently saving a broken page.
 *
 * A page has 9 perks: [keystone, primary row 1, row 2, row 3, secondary A, secondary B, shard 1-3].
 * UNVERIFIED: the styles payload shape below is based on the LCU's documented format; it hasn't been
 * recorded yet. If it doesn't look like that, validation falls back to the basic checks only.
 */
import type { RunePageInput } from '@league-remote/protocol';

export interface PerkStyle {
  id: number;
  name?: string;
  allowedSubStyles?: number[];
  slots?: { type?: string; perks?: number[] }[];
}

/** Returns an error message, or null if the page is valid. */
export function validateRunePage(page: RunePageInput, styles: PerkStyle[] | null): string | null {
  if (page.primaryStyleId === page.subStyleId) return 'Primary and secondary paths must be different';
  // The 6 runes must all differ (the 3 shards at the end may repeat).
  if (new Set(page.selectedPerkIds.slice(0, 6)).size !== 6) return 'A rune can only be used once';

  const primary = styles?.find((s) => s.id === page.primaryStyleId);
  const secondary = styles?.find((s) => s.id === page.subStyleId);
  if (!styles || !primary?.slots?.length || !secondary?.slots?.length) {
    // Couldn't load or understand the styles: basic checks only.
    return styles && (!primary || !secondary) ? 'Unknown rune path' : null;
  }
  if (primary.allowedSubStyles && !primary.allowedSubStyles.includes(secondary.id)) {
    return `${secondary.name ?? 'That path'} can't be the secondary path for ${primary.name ?? 'this path'}`;
  }

  const runeSlots = (style: PerkStyle) => style.slots!.filter((s) => s.type !== 'kStatMod');
  const shardSlots = primary.slots.filter((s) => s.type === 'kStatMod');
  const ids = page.selectedPerkIds;
  const inSlot = (slot: { perks?: number[] } | undefined, id: number) => !!slot?.perks?.includes(id);

  // Keystone + 3 rows from the primary path, in order.
  const primaryRows = runeSlots(primary);
  for (let i = 0; i < 4; i++) {
    if (!inSlot(primaryRows[i], ids[i]!)) {
      return i === 0 ? 'The first rune must be a keystone of your primary path' : `Rune ${i + 1} doesn't fit row ${i} of your primary path`;
    }
  }

  // 2 runes from different non-keystone rows of the secondary path.
  const secondaryRows = runeSlots(secondary).slice(1);
  const rowOf = (id: number) => secondaryRows.findIndex((slot) => inSlot(slot, id));
  const a = rowOf(ids[4]!);
  const b = rowOf(ids[5]!);
  if (a < 0 || b < 0) return 'Secondary runes must come from your secondary path (not its keystones)';
  if (a === b) return 'Secondary runes must be from two different rows';

  // 3 stat shards, one per shard row.
  if (shardSlots.length >= 3) {
    for (let i = 0; i < 3; i++) if (!inSlot(shardSlots[i], ids[6 + i]!)) return `Stat shard ${i + 1} isn't valid for that row`;
  }
  return null;
}
