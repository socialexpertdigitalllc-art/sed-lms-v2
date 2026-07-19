import { ImapFlow, type ListResponse } from "imapflow";
import { Readable } from "stream";
import { buildImapConfig } from "@/lib/mail/config";
import type { ResolvedMailbox } from "@/lib/mail/types";
import { formatAddressList, makePreview, hasAttachments, normalizeFolder } from "@/lib/mail/message";

export interface MailListItem {
  uid: number;
  from: string;
  subject: string;
  date: string;
  seen: boolean;
  preview: string;
  hasAttachments: boolean;
}
export interface MailListResult {
  total: number;
  messages: MailListItem[];
}
export interface MailAttachment {
  filename: string;
  size: number;
  partId: string;
}
export interface MailFull {
  from: string;
  to: string;
  subject: string;
  date: string;
  html: string | null;
  text: string | null;
  attachments: MailAttachment[];
}

type BodyStruct = {
  part?: string;
  type?: string;
  disposition?: string | null;
  parameters?: Record<string, string>;
  dispositionParameters?: Record<string, string>;
  size?: number;
  childNodes?: BodyStruct[];
};

function newClient(m: ResolvedMailbox): ImapFlow {
  return new ImapFlow({ ...buildImapConfig(m), logger: false });
}

async function resolvePath(client: ImapFlow, folder: "INBOX" | "Sent"): Promise<string> {
  if (folder === "INBOX") return "INBOX";
  const list = (await client.list()) as ListResponse[];
  const sent =
    list.find((b) => b.specialUse === "\\Sent") ??
    list.find((b) => /(^|[./])sent($|[./])/i.test(b.path));
  return sent?.path ?? "INBOX.Sent";
}

function firstPart(node: BodyStruct | undefined, mime: string): string | undefined {
  if (!node) return undefined;
  const isAttach = (node.disposition ?? "").toLowerCase() === "attachment";
  if ((node.type ?? "").toLowerCase() === mime && !isAttach) return node.part ?? "1";
  for (const child of node.childNodes ?? []) {
    const found = firstPart(child, mime);
    if (found) return found;
  }
  return undefined;
}

function collectAttachments(node: BodyStruct | undefined): MailAttachment[] {
  const out: MailAttachment[] = [];
  const walk = (n: BodyStruct) => {
    const filename = n.dispositionParameters?.filename || n.parameters?.name;
    const isAttach = (n.disposition ?? "").toLowerCase() === "attachment" || !!filename;
    if (isAttach && n.part) {
      out.push({ filename: filename || `part-${n.part}`, size: n.size ?? 0, partId: n.part });
    }
    for (const c of n.childNodes ?? []) walk(c);
  };
  if (node) walk(node);
  return out;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Page a folder newest-first. page 1 = the newest `pageSize` messages. */
export async function listMessages(
  m: ResolvedMailbox,
  opts: { folder?: string; page?: number; pageSize?: number }
): Promise<MailListResult> {
  const folder = normalizeFolder(opts.folder);
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 25));
  const client = newClient(m);
  await client.connect();
  try {
    const path = await resolvePath(client, folder);
    const mailbox = await client.mailboxOpen(path, { readOnly: true });
    const total = mailbox.exists;
    if (total === 0) return { total: 0, messages: [] };
    const end = total - (page - 1) * pageSize;
    if (end < 1) return { total, messages: [] };
    const start = Math.max(1, end - pageSize + 1);

    const messages: MailListItem[] = [];
    for await (const msg of client.fetch(
      `${start}:${end}`,
      { uid: true, envelope: true, flags: true, bodyStructure: true, bodyParts: ["1"] }
    )) {
      const previewBuf = msg.bodyParts?.get("1");
      const preview = previewBuf ? makePreview(previewBuf.toString("utf8")) : "";
      messages.push({
        uid: msg.uid,
        from: formatAddressList(msg.envelope?.from),
        subject: msg.envelope?.subject || "(no subject)",
        date: (msg.envelope?.date ?? new Date()).toISOString(),
        seen: msg.flags?.has("\\Seen") ?? false,
        preview,
        hasAttachments: hasAttachments(msg.bodyStructure as unknown as BodyStruct),
      });
    }
    messages.reverse(); // newest first
    return { total, messages };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Full message by UID: html/text bodies + attachment metadata. */
export async function getMessage(m: ResolvedMailbox, folderInput: string, uid: number): Promise<MailFull | null> {
  const folder = normalizeFolder(folderInput);
  const client = newClient(m);
  await client.connect();
  try {
    const path = await resolvePath(client, folder);
    await client.mailboxOpen(path, { readOnly: true });
    const meta = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true });
    if (!meta) return null;
    const struct = meta.bodyStructure as unknown as BodyStruct;

    let html: string | null = null;
    let text: string | null = null;
    const htmlPart = firstPart(struct, "text/html");
    const textPart = firstPart(struct, "text/plain");
    if (htmlPart) {
      const dl = await client.download(String(uid), htmlPart, { uid: true });
      if (dl?.content) html = (await streamToBuffer(dl.content)).toString("utf8");
    }
    if (textPart) {
      const dl = await client.download(String(uid), textPart, { uid: true });
      if (dl?.content) text = (await streamToBuffer(dl.content)).toString("utf8");
    }

    return {
      from: formatAddressList(meta.envelope?.from),
      to: formatAddressList(meta.envelope?.to),
      subject: meta.envelope?.subject || "(no subject)",
      date: (meta.envelope?.date ?? new Date()).toISOString(),
      html,
      text,
      attachments: collectAttachments(struct),
    };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export async function markSeen(m: ResolvedMailbox, folderInput: string, uid: number): Promise<void> {
  const folder = normalizeFolder(folderInput);
  const client = newClient(m);
  await client.connect();
  try {
    const path = await resolvePath(client, folder);
    await client.mailboxOpen(path, { readOnly: false });
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Best-effort append of a raw RFC822 message to the Sent folder. */
export async function appendToSent(m: ResolvedMailbox, raw: Buffer): Promise<void> {
  const client = newClient(m);
  await client.connect();
  try {
    const path = await resolvePath(client, "Sent");
    await client.append(path, raw, ["\\Seen"]);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Download one attachment part for the download route. */
export async function getAttachment(
  m: ResolvedMailbox,
  folderInput: string,
  uid: number,
  partId: string
): Promise<{ content: Buffer; filename: string; contentType: string } | null> {
  const folder = normalizeFolder(folderInput);
  const client = newClient(m);
  await client.connect();
  try {
    const path = await resolvePath(client, folder);
    await client.mailboxOpen(path, { readOnly: true });
    const dl = await client.download(String(uid), partId, { uid: true });
    if (!dl?.content) return null;
    return {
      content: await streamToBuffer(dl.content),
      filename: dl.meta?.filename || `attachment-${partId}`,
      contentType: dl.meta?.contentType || "application/octet-stream",
    };
  } finally {
    await client.logout().catch(() => client.close());
  }
}
