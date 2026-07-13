/**
 * Order dashboard cards by a user-defined key order.
 * Items whose key appears in `order` come first, in that order; items with
 * unknown/new keys are appended afterwards in their original (default) order.
 * Order keys that match no item are ignored.
 */
export function applyOrder<T extends { key: string }>(items: T[], order: string[]): T[] {
  if (order.length === 0) return items;
  const pos = new Map(order.map((k, i) => [k, i]));
  const ordered = items
    .filter((it) => pos.has(it.key))
    .sort((a, b) => pos.get(a.key)! - pos.get(b.key)!);
  const rest = items.filter((it) => !pos.has(it.key));
  return [...ordered, ...rest];
}
