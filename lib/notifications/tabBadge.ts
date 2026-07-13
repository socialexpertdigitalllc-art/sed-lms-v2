/** Pure helpers for the browser-tab unread badge (title prefix). Canvas/favicon drawing lives in TabBadge.tsx. */

/** Strip a leading "(n) " unread-count prefix from a document title, if present. */
export function stripUnreadPrefix(title: string): string {
  return title.replace(/^\(\d+\) /, "");
}

/** Prefix the (stripped) base title with "(total) " when total > 0 — never stacks. */
export function withUnreadPrefix(baseTitle: string, total: number): string {
  const base = stripUnreadPrefix(baseTitle);
  return total > 0 ? `(${total}) ${base}` : base;
}
