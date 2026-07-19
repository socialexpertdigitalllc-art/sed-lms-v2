export type MailAddress = { name?: string | null; address?: string | null };

/** "Name <email>" | "email" | "" */
export function formatAddress(a: MailAddress | undefined | null): string {
  if (!a || !a.address) return "";
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

export function formatAddressList(list: MailAddress[] | undefined | null): string {
  if (!list || list.length === 0) return "";
  return list.map(formatAddress).filter(Boolean).join(", ");
}

/** Collapse whitespace, trim, truncate with an ellipsis (default 140 chars). */
export function makePreview(text: string | undefined | null, max = 140): string {
  if (!text) return "";
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

type BodyNode = { disposition?: string | null; type?: string | null; childNodes?: BodyNode[] | null };

/** True if any part of the bodystructure is an attachment. */
export function hasAttachments(node: BodyNode | undefined | null): boolean {
  if (!node) return false;
  if (node.disposition && node.disposition.toLowerCase() === "attachment") return true;
  if (node.childNodes) return node.childNodes.some((c) => hasAttachments(c));
  return false;
}

/** Canonicalize a client-supplied folder to the small allowlist we support. */
export function normalizeFolder(folder: string | undefined | null): "INBOX" | "Sent" {
  if (folder && folder.trim().toLowerCase() === "sent") return "Sent";
  return "INBOX";
}
