// @vitest-environment node
import { createHmac, randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionCard } from "@/lib/assistant/actions/card";
import type { StoredAction } from "@/lib/assistant/actions/types";
import type { TurnInput } from "@/lib/assistant/engine";

/**
 * SED AI on the phone: linking with one-time codes, the webhooks' platform
 * checks, reading what people send (YES / NO / YES 2 / confirmation words /
 * link codes), turning answers and proposals into chat text, and what a
 * linked chat's message leads to — all with a fake database, fake platform
 * APIs and the assistant itself stubbed out.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  admin: null as unknown,
  after: [] as (() => unknown)[],
  perms: new Set<string>(),
  actAsError: null as string | null,
  actedAs: [] as string[],
  conversations: new Map<string, Record<string, unknown>>(),
  convSeq: 0,
  latestTurn: null as string | null,
  user: null as { id: string } | null,
  guard: null as unknown,
  forcedCodes: [] as number[],
}));

vi.mock("node:crypto", async (orig) => {
  const real = await orig<typeof import("node:crypto")>();
  return { ...real, randomInt: (min: number, max: number) => (h.forcedCodes.length ? h.forcedCodes.shift()! : real.randomInt(min, max)) };
});
vi.mock("next/server", async (orig) => {
  const real = await orig<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => void h.after.push(fn) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rls: true, auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock("@/lib/settings/appSettings", () => ({ getAppSettings: async () => ({ work_timezone: "Asia/Karachi" }) }));
vi.mock("@/lib/auth/actAs", () => {
  class ActAsError extends Error {}
  return {
    ActAsError,
    actAs: async (userId: string, fn: () => Promise<unknown>) => {
      if (h.actAsError) throw new ActAsError(h.actAsError);
      h.actedAs.push(userId);
      return fn();
    },
  };
});
vi.mock("@/lib/assistant/engine", () => ({ runTurn: vi.fn() }));
vi.mock("@/lib/assistant/actions/run", () => {
  class ActionFailure extends Error {
    status: number;
    constructor(message: string, status = 422) {
      super(message);
      this.status = status;
    }
  }
  return {
    ActionFailure,
    confirmAction: vi.fn(),
    cancelAction: vi.fn(),
    requestApproval: vi.fn(),
    failureMessage: () => "The change failed on the server. Nothing was changed — try again, or do it in the app.",
  };
});
vi.mock("@/lib/assistant/actions/people", () => ({
  permissionsOf: vi.fn(async () => new Set(h.perms)),
  isAdminMember: vi.fn(async () => false),
  bell: vi.fn(async () => {}),
}));
vi.mock("@/lib/assistant/store", () => ({
  createConversation: vi.fn(async (_admin: unknown, userId: string, title: string) => {
    const at = "2026-10-14T08:00:00.000Z";
    const c = { id: `conv-${++h.convSeq}`, title, pinned: false, last_provider: null, last_model: null, created_at: at, updated_at: at, last_message_at: at };
    h.conversations.set(c.id, { ...c, user_id: userId });
    return c;
  }),
  getConversation: vi.fn(async (_admin: unknown, userId: string, id: string) => {
    const c = h.conversations.get(id);
    return c && c.user_id === userId ? c : null;
  }),
  latestQuestion: vi.fn(async () => (h.latestTurn ? { turnId: h.latestTurn, content: "the question" } : null)),
}));
vi.mock("@/lib/assistant/http", async (orig) => ({
  ...(await orig<typeof import("@/lib/assistant/http")>()),
  assistantGuard: async () => h.guard,
}));

import { runTurn } from "@/lib/assistant/engine";
import { cancelAction, confirmAction, requestApproval } from "@/lib/assistant/actions/run";
import { bell } from "@/lib/assistant/actions/people";
import { resetRuns, startRun } from "@/lib/assistant/runs";
import { toCard } from "@/lib/assistant/actions/store";
import { missingEnv, publicOrigin } from "@/lib/assistant/channels/config";
import { decide, listingFor, stillOpenLine } from "@/lib/assistant/channels/decide";
import { absoluteUrl, answerToChat, cardToText, outcomeText, splitMessage } from "@/lib/assistant/channels/format";
import { handleInbound, handleInboundAll, MESSAGES } from "@/lib/assistant/channels/handle";
import { consumeLinkCode, createLinkCode, linkInstructions, resetChannelBrakes } from "@/lib/assistant/channels/links";
import { matchesPhrase, parseCommand, parseTelegramUpdate, parseWhatsAppPayload } from "@/lib/assistant/channels/parse";
import { sendText } from "@/lib/assistant/channels/send";
import { safeEqual, verifyTelegramSecret, verifyWhatsAppSignature, whatsAppChallenge } from "@/lib/assistant/channels/verify";
import type { InboundMessage } from "@/lib/assistant/channels/types";
import { GET as channelsGET, POST as channelsPOST } from "@/app/api/assistant/channels/route";
import { DELETE as channelDELETE } from "@/app/api/assistant/channels/[id]/route";
import { POST as telegramPOST } from "@/app/api/assistant/channels/telegram/route";
import { GET as whatsappGET, POST as whatsappPOST } from "@/app/api/assistant/channels/whatsapp/route";

/* -------------------------------------------------------------- fakes */

/** Just enough PostgREST for the channel code — with the tables' unique keys. */
function fakeAdmin(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const unique: Record<string, string[]> = { assistant_link_codes: ["code"], assistant_channel_links: ["channel", "external_id"] };
  function from(table: string) {
    const rows = () => (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let conflict: string[] = [];
    let returning = false;
    let single: "one" | "maybe" | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    const q = {
      select: () => ((returning = op !== "select"), q),
      insert: (r: Row | Row[]) => ((op = "insert"), (payload = Array.isArray(r) ? r : [r]), q),
      upsert: (r: Row | Row[], o?: { onConflict?: string }) => (
        (op = "upsert"), (payload = Array.isArray(r) ? r : [r]), (conflict = (o?.onConflict ?? "").split(",").map((s) => s.trim())), q
      ),
      update: (p: Row) => ((op = "update"), (patch = p), q),
      delete: () => ((op = "delete"), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
      lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), q),
      order: (c: string, o?: { ascending?: boolean }) => ((order = { col: c, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((limit = n), q),
      maybeSingle: () => ((single = "maybe"), q),
      single: () => ((single = "one"), q),
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    const matched = () => rows().filter((r) => filters.every((f) => f(r)));
    function shape(list: Row[]) {
      let out = [...list];
      if (order) {
        const { col, asc } = order;
        out.sort((a, b) => (asc ? 1 : -1) * String(a[col]).localeCompare(String(b[col])));
      }
      if (limit !== null) out = out.slice(0, limit);
      out = out.map((r) => ({ ...r }));
      if (single) return out.length > 1 || (single === "one" && !out.length) ? { data: null, error: { message: "not exactly one row" } } : { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }
    function run(): { data: unknown; error: unknown } {
      if (op === "select") return shape(matched());
      if (op === "insert" || op === "upsert") {
        const written: Row[] = [];
        for (const r of payload) {
          const keys = op === "upsert" ? conflict : (unique[table] ?? []);
          const twin = keys.length ? rows().find((x) => keys.every((k) => x[k] === r[k])) : undefined;
          if (twin && op === "insert") return { data: null, error: { code: "23505", message: "duplicate key value" } };
          if (twin) {
            Object.assign(twin, r);
            written.push(twin);
          } else {
            const row = { id: randomUUID(), created_at: new Date().toISOString(), ...r };
            rows().push(row);
            written.push(row);
          }
        }
        return returning || single ? shape(written) : { data: null, error: null };
      }
      const list = matched();
      if (op === "update") for (const r of list) Object.assign(r, patch);
      else tables[table] = rows().filter((r) => !list.includes(r));
      return returning || single ? shape(list) : { data: null, error: null };
    }
    return q;
  }
  return { client: { from } as unknown as SupabaseClient, tables };
}

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const LINK = "33333333-3333-4333-8333-333333333333";
const CONV = "44444444-4444-4444-8444-444444444444";
const TURN = "55555555-5555-4555-8555-555555555555";
const OLD_TURN = "66666666-6666-4666-8666-666666666666";
const ORIGIN = "https://app.test";
const NOW = new Date("2026-10-14T10:00:00.000Z");
const iso = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

function action(p: Partial<StoredAction> & { id: string }): StoredAction {
  return {
    user_id: USER,
    conversation_id: CONV,
    turn_id: TURN,
    tool_call_id: null,
    plan_id: null,
    plan_index: null,
    plan_title: null,
    action_key: "lead.create",
    title: "Create lead — Jumbo's Pizza",
    risk: "standard",
    input: {},
    card: { fields: [{ name: "business_name", label: "Business name", value: "Jumbo's Pizza" }], confirmLabel: "Create lead" },
    before_state: null,
    confirm_phrase: null,
    status: "proposed",
    result: null,
    error: null,
    source: "telegram",
    approver_id: null,
    approval_note: null,
    decided_at: null,
    reported_at: null,
    undo_until: null,
    created_at: iso(-5),
    updated_at: iso(-5),
    executed_at: null,
    expires_at: iso(24 * 60),
    ...p,
  };
}

function card(p: Partial<ActionCard> = {}): ActionCard {
  return {
    id: "a1",
    key: "lead.create",
    title: "Create lead — Jumbo's Pizza",
    group: "Leads",
    risk: "standard",
    status: "proposed",
    confirmLabel: "Create lead",
    fields: [
      { name: "business_name", label: "Business name", value: "Jumbo's Pizza" },
      { name: "phone", label: "Phone", value: "0300 1234567" },
      { name: "notes", label: "Notes", value: "" },
    ],
    createdAt: iso(-5),
    ...p,
  };
}

const ENV_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_BOT_USERNAME",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_DISPLAY_NUMBER",
  "APP_PUBLIC_URL",
  "WGE_SELF_ORIGIN",
] as const;
const savedEnv: Record<string, string | undefined> = {};

function configureAll() {
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: "123456:TEST-TOKEN-never-logged",
    TELEGRAM_WEBHOOK_SECRET: "tg-secret_value-1",
    TELEGRAM_BOT_USERNAME: "@SedAiBot",
    WHATSAPP_TOKEN: "EAAG-wa-token-never-logged",
    WHATSAPP_PHONE_NUMBER_ID: "109876543210",
    WHATSAPP_VERIFY_TOKEN: "verify-me",
    WHATSAPP_APP_SECRET: "wa-app-secret",
    WHATSAPP_DISPLAY_NUMBER: "+92 300 1234567",
    APP_PUBLIC_URL: "https://app.test/",
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Proposals expire against the real clock: pin it to the fixtures' "now".
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  h.after = [];
  h.perms = new Set(["assistant.use", "assistant.act"]);
  h.actAsError = null;
  h.actedAs = [];
  h.conversations = new Map();
  h.convSeq = 0;
  h.latestTurn = null;
  h.user = null;
  h.guard = null;
  h.forcedCodes = [];
  resetRuns();
  resetChannelBrakes();
  vi.mocked(runTurn).mockReset();
  vi.mocked(confirmAction).mockReset();
  vi.mocked(cancelAction).mockReset();
  vi.mocked(requestApproval).mockReset();
  vi.mocked(bell).mockClear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------ link codes */

describe("link codes", () => {
  it("creates a six-digit code for ten minutes, replacing the person's earlier one for that channel", async () => {
    const db = fakeAdmin({
      assistant_link_codes: [
        { code: "111111", user_id: USER, channel: "telegram", expires_at: iso(5) },
        { code: "222222", user_id: USER, channel: "whatsapp", expires_at: iso(5) },
        { code: "333333", user_id: OTHER, channel: "telegram", expires_at: iso(5) },
        { code: "444444", user_id: OTHER, channel: "whatsapp", expires_at: iso(-1) },
      ],
    });
    const out = await createLinkCode(db.client, USER, "telegram", NOW);
    expect(out.code).toMatch(/^\d{6}$/);
    expect(out.expiresAt).toBe(iso(10));
    const codes = db.tables.assistant_link_codes.map((r) => r.code).sort();
    // The earlier Telegram code is gone, the WhatsApp one and other people's stay, the expired one is swept.
    expect(codes).toEqual([out.code, "222222", "333333"].sort());
    expect(db.tables.assistant_link_codes.find((r) => r.code === out.code)).toMatchObject({ user_id: USER, channel: "telegram" });
  });

  it("draws again when the code is already taken", async () => {
    const db = fakeAdmin({ assistant_link_codes: [{ code: "000042", user_id: OTHER, channel: "telegram", expires_at: iso(5) }] });
    h.forcedCodes = [42, 42, 777];
    const out = await createLinkCode(db.client, USER, "telegram", NOW);
    expect(out.code).toBe("000777");
    expect(db.tables.assistant_link_codes).toHaveLength(2);
  });

  it("uses a code once, only before it expires and only on its own channel", async () => {
    const db = fakeAdmin({
      assistant_link_codes: [
        { code: "123456", user_id: USER, channel: "telegram", expires_at: iso(3) },
        { code: "654321", user_id: USER, channel: "telegram", expires_at: iso(-1) },
      ],
    });
    expect(await consumeLinkCode(db.client, "123456", "whatsapp", NOW)).toBeNull();
    expect(await consumeLinkCode(db.client, "654321", "telegram", NOW)).toBeNull();
    expect(await consumeLinkCode(db.client, "12345", "telegram", NOW)).toBeNull();
    expect(await consumeLinkCode(db.client, "123456", "telegram", NOW)).toEqual({ userId: USER });
    expect(await consumeLinkCode(db.client, "123456", "telegram", NOW)).toBeNull();
  });

  it("says exactly what to send, and where", () => {
    configureAll();
    expect(linkInstructions("telegram", "123456")).toEqual({
      command: "link 123456",
      to: "@SedAiBot",
      instructions: "Send  link 123456  to @SedAiBot",
      url: "https://t.me/SedAiBot?start=123456",
    });
    expect(linkInstructions("whatsapp", "123456")).toEqual({
      command: "link 123456",
      to: "+92 300 1234567",
      instructions: "Send  link 123456  to +92 300 1234567",
      url: "https://wa.me/923001234567?text=link%20123456",
    });
  });

  it("knows which settings a channel is missing, and the public address", () => {
    expect(missingEnv("telegram", { TELEGRAM_BOT_TOKEN: "x", TELEGRAM_BOT_USERNAME: " " })).toEqual(["TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BOT_USERNAME"]);
    expect(publicOrigin({ APP_PUBLIC_URL: "https://lms.example.com/", WGE_SELF_ORIGIN: "http://localhost:3000" })).toBe("https://lms.example.com");
    expect(publicOrigin({ WGE_SELF_ORIGIN: "http://10.0.0.5:3000" })).toBe("http://10.0.0.5:3000");
  });
});

/* -------------------------------------------------------- verification */

describe("webhook verification", () => {
  it("compares secrets in constant time, any length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("accepts Telegram's secret header only when it matches", () => {
    expect(verifyTelegramSecret("s3cret", "s3cret")).toBe(true);
    expect(verifyTelegramSecret("s3cre", "s3cret")).toBe(false);
    expect(verifyTelegramSecret(null, "s3cret")).toBe(false);
    expect(verifyTelegramSecret("", "")).toBe(false);
    expect(verifyTelegramSecret("anything", undefined)).toBe(false);
  });

  it("checks Meta's body signature", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const sig = `sha256=${createHmac("sha256", "wa-app-secret").update(body).digest("hex")}`;
    expect(verifyWhatsAppSignature(body, sig, "wa-app-secret")).toBe(true);
    expect(verifyWhatsAppSignature(Buffer.from(body), sig.toUpperCase().replace("SHA256=", "sha256="), "wa-app-secret")).toBe(true);
    expect(verifyWhatsAppSignature(`${body} `, sig, "wa-app-secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, sig, "another-secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, sig.replace("sha256=", ""), "wa-app-secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, null, "wa-app-secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, sig, "")).toBe(false);
  });

  it("echoes Meta's challenge only for the right verify token", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(whatsAppChallenge(q("hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=4242"), "verify-me")).toBe("4242");
    expect(whatsAppChallenge(q("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4242"), "verify-me")).toBeNull();
    expect(whatsAppChallenge(q("hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=4242"), "verify-me")).toBeNull();
    expect(whatsAppChallenge(q("hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=4242"), "")).toBeNull();
  });
});

/* --------------------------------------------------------------- parsing */

describe("reading what people send", () => {
  it.each([
    ["yes", { kind: "confirm", n: null }],
    ["YES!", { kind: "confirm", n: null }],
    ["Ok", { kind: "confirm", n: null }],
    ["okay.", { kind: "confirm", n: null }],
    ["haan", { kind: "confirm", n: null }],
    ["confirm", { kind: "confirm", n: null }],
    ["yes 2", { kind: "confirm", n: 2 }],
    ["Yes #3", { kind: "confirm", n: 3 }],
    ["yes, 2", { kind: "confirm", n: 2 }],
    ["no", { kind: "cancel", n: null }],
    ["Cancel 2", { kind: "cancel", n: 2 }],
    ["NO 1.", { kind: "cancel", n: 1 }],
    ["link 123456", { kind: "link", code: "123456" }],
    ["Link: 123 456", { kind: "link", code: "123456" }],
    ["/start 123456", { kind: "link", code: "123456" }],
    ["/link@SedAiBot 123456", { kind: "link", code: "123456" }],
    ["link 12345", { kind: "link", code: "12345" }],
    ["/start", { kind: "start" }],
    ["123456", { kind: "code", code: "123456" }],
    ["123-456", { kind: "code", code: "123456" }],
    ["yes please", { kind: "message" }],
    ["ok thanks", { kind: "message" }],
    ["no idea, what's my pipeline?", { kind: "message" }],
    ["link 5 leads to Sam", { kind: "message" }],
    ["   ", { kind: "message" }],
  ])("%j → %j", (text, expected) => {
    expect(parseCommand(text)).toEqual(expected);
  });

  it("recognises a critical change's words, forgiving quotes and a full stop", () => {
    expect(matchesPhrase("jumbo's pizza", "Jumbo's Pizza")).toBe(true);
    expect(matchesPhrase(' "Jumbo\'s Pizza" ', "Jumbo's Pizza")).toBe(true);
    expect(matchesPhrase("“Jumbo's Pizza”.", "Jumbo's Pizza")).toBe(true);
    expect(matchesPhrase("Jumbo", "Jumbo's Pizza")).toBe(false);
    expect(matchesPhrase("yes", null)).toBe(false);
  });

  it("reads Telegram updates from private chats only", () => {
    const update = (message: Record<string, unknown>) => ({ update_id: 901, message: { message_id: 7, ...message } });
    expect(parseTelegramUpdate(update({ chat: { id: 5551234, type: "private" }, from: { id: 5551234, username: "sam_k", first_name: "Sam" }, text: "hi" }))).toEqual({
      channel: "telegram",
      externalId: "5551234",
      messageId: "901",
      text: "hi",
      label: "@sam_k",
    });
    expect(parseTelegramUpdate(update({ chat: { id: 1, type: "private" }, from: { first_name: "Sam", last_name: "K" }, text: "hi" }))?.label).toBe("Sam K");
    expect(parseTelegramUpdate(update({ chat: { id: 1, type: "private" }, from: { first_name: "Sam" }, photo: [{}] }))?.text).toBeNull();
    expect(parseTelegramUpdate(update({ chat: { id: -100, type: "group" }, from: { first_name: "Sam" }, text: "yes" }))).toBeNull();
    expect(parseTelegramUpdate(update({ chat: { id: 1, type: "private" }, from: { is_bot: true }, text: "yes" }))).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1, edited_message: { chat: { id: 1, type: "private" }, text: "yes" } })).toBeNull();
    expect(parseTelegramUpdate("nonsense")).toBeNull();
  });

  it("reads WhatsApp messages and skips receipts, reactions and other numbers", () => {
    const payload = (value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value }] }] });
    const meta = { phone_number_id: "109876543210" };
    expect(parseWhatsAppPayload(payload({ metadata: meta, messages: [{ id: "wamid.1", from: "923001234567", type: "text", text: { body: "yes 2" } }] }), "109876543210")).toEqual([
      { channel: "whatsapp", externalId: "923001234567", messageId: "wamid.1", text: "yes 2", label: "+923001234567" },
    ]);
    expect(parseWhatsAppPayload(payload({ metadata: meta, messages: [{ id: "wamid.2", from: "923001234567", type: "image", image: {} }] }))[0].text).toBeNull();
    expect(parseWhatsAppPayload(payload({ metadata: meta, messages: [{ id: "wamid.3", from: "923001234567", type: "reaction", reaction: {} }] }))).toEqual([]);
    expect(parseWhatsAppPayload(payload({ metadata: meta, statuses: [{ id: "wamid.1", status: "read" }] }))).toEqual([]);
    expect(parseWhatsAppPayload(payload({ metadata: { phone_number_id: "999" }, messages: [{ id: "wamid.4", from: "1", type: "text", text: { body: "x" } }] }), "109876543210")).toEqual([]);
    expect(parseWhatsAppPayload({ object: "page", entry: [] })).toEqual([]);
  });
});

/* ------------------------------------------------------------ formatting */

describe("answers as chat text", () => {
  it("turns app links into full links, charts into a pointer, and drops the Markdown", () => {
    const md = [
      "## Your pipeline",
      "You have **3 leads** ready. Open [Jumbo's Pizza](/leads/abc) or see the [docs](https://example.com/docs).",
      "",
      "```chart",
      '{"type":"bar","data":[{"label":"Aug","value":12}]}',
      "```",
      "",
      "- *Sam*: 2",
      "  - follow-up `today`",
      "1. first",
      "2. second",
      "",
      "| Agent | Closed | Dropped |",
      "| --- | --- | --- |",
      "| Sam | 12 | 4 |",
      "",
      "Mail [sam@x.com](mailto:sam@x.com).",
    ].join("\n");
    expect(answerToChat(md, ORIGIN)).toBe(
      [
        "Your pipeline",
        "You have 3 leads ready. Open Jumbo's Pizza: https://app.test/leads/abc or see the docs: https://example.com/docs.",
        "(chart in the app)",
        "- Sam: 2\n   - follow-up today",
        "1. first\n2. second",
        "- Sam — Closed: 12, Dropped: 4",
        "Mail sam@x.com.",
      ].join("\n\n"),
    );
  });

  it("keeps absolute links as they are", () => {
    expect(absoluteUrl("/leads/1", "https://app.test/")).toBe("https://app.test/leads/1");
    expect(absoluteUrl("https://x.com/a", ORIGIN)).toBe("https://x.com/a");
    expect(absoluteUrl("//evil.com/a", ORIGIN)).toBe("//evil.com/a");
  });

  it("splits long replies between paragraphs, losing nothing", () => {
    expect(splitMessage("short")).toEqual(["short"]);
    const para = "word ".repeat(300).trim();
    const text = [para, para, para, para].join("\n\n");
    const parts = splitMessage(text, 4000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4000);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
    const solid = "x".repeat(9000);
    expect(splitMessage(solid).map((p) => p.length)).toEqual([4000, 4000, 1000]);
  });
});

describe("proposals as chat text", () => {
  it("shows every value, before → after, warnings, and how to answer", () => {
    const text = cardToText(
      card({
        changes: [{ label: "Status", from: "Ready", to: "Closed" }],
        warnings: ["A lead with this phone already exists (Jumbo Pizza Co)."],
        link: { href: "/leads/abc", label: "Open lead" },
      }),
      { origin: ORIGIN },
    );
    expect(text).toBe(
      [
        "Create lead — Jumbo's Pizza",
        "Business name: Jumbo's Pizza",
        "Phone: 0300 1234567",
        "Status: Ready → Closed",
        "Warning: A lead with this phone already exists (Jumbo Pizza Co).",
        "Open lead: https://app.test/leads/abc",
        "Reply YES to confirm or NO to cancel.",
      ].join("\n"),
    );
  });

  it("numbers several, asks for the words on a critical one, and offers approval", () => {
    expect(cardToText(card(), { origin: ORIGIN, n: 2 })).toMatch(/^2\) Create lead — Jumbo's Pizza\n[\s\S]*\nReply YES 2 to confirm or NO 2 to cancel\.$/);
    const critical = cardToText(card({ risk: "critical", confirmPhrase: "Jumbo's Pizza", title: "Archive Jumbo's Pizza" }), { origin: ORIGIN });
    expect(critical).toContain("(High impact)");
    expect(critical.endsWith(`Type "Jumbo's Pizza" to confirm, or NO to cancel.`)).toBe(true);
    const sensitive = cardToText(card({ risk: "sensitive" }), { origin: ORIGIN });
    expect(sensitive).toContain("(Check before confirming)");
    const approval = cardToText(card({ approval: { reason: "You don't have “Delete Lead”." } }), { origin: ORIGIN, n: 1 });
    expect(approval).toContain("You can't do this yourself: You don't have “Delete Lead”.");
    expect(approval.endsWith("Reply YES 1 to send it to an admin for approval, or NO 1 to cancel.")).toBe(true);
  });

  it("lists bulk records (ticked ones, capped) and plan steps", () => {
    const items = Array.from({ length: 18 }, (_, i) => ({ id: `l${i}`, label: `Lead ${i}`, detail: "Ready", selected: i !== 0 }));
    const text = cardToText(card({ title: "Reassign 17 leads to Sara", fields: [], items, plan: { id: "p", index: 2, total: 3, title: "Handover" } }), { origin: ORIGIN });
    expect(text.split("\n")[0]).toBe("Step 2 of 3: Reassign 17 leads to Sara");
    expect(text).toContain("Records (17):\n- Lead 1 — Ready");
    expect(text).not.toContain("Lead 0 ");
    expect(text).toContain("…and 2 more (all listed in the app)");
  });

  it("reports the outcome with a full link", () => {
    const done = card({ status: "done", result: { message: "Created the lead Jumbo's Pizza.", link: { href: "/leads/abc", label: "Open lead" } }, undoUntil: iso(10) });
    expect(outcomeText(done, ORIGIN, NOW.getTime())).toBe(
      "Done: Created the lead Jumbo's Pizza.\nOpen lead: https://app.test/leads/abc\nYou can undo it in SED AI for the next 10 min.",
    );
    expect(outcomeText(card({ status: "failed", error: "Phone is required." }), ORIGIN)).toBe("That didn't work: Phone is required.");
    expect(outcomeText(card({ status: "awaiting_approval" }), ORIGIN)).toMatch(/^Sent to an admin for approval: Create lead/);
    expect(outcomeText(card({ status: "cancelled" }), ORIGIN)).toBe("Cancelled: Create lead — Jumbo's Pizza. Nothing was changed.");
  });
});

/* ---------------------------------------------------------------- decide */

describe("which proposal a YES / NO is about", () => {
  const t = NOW.getTime();
  const confirm = (n: number | null = null) => ({ kind: "confirm" as const, n });
  const cancel = (n: number | null = null) => ({ kind: "cancel" as const, n });

  it("confirms the one open proposal of the latest question", () => {
    const a = action({ id: "a1" });
    expect(decide("yes", confirm(), [a], TURN, t)).toEqual({ kind: "confirm", action: a, n: null });
    expect(decide("no", cancel(), [a], TURN, t)).toEqual({ kind: "cancel", action: a, n: null });
    expect(decide("yes 1", confirm(1), [a], TURN, t)).toEqual({ kind: "confirm", action: a, n: null });
  });

  it("leaves YES to the assistant when the latest question proposed nothing (or everything is decided)", () => {
    const older = action({ id: "a1", turn_id: OLD_TURN });
    expect(decide("yes", confirm(), [older], TURN, t)).toEqual({ kind: "none" });
    expect(decide("yes", confirm(), [action({ id: "a2", status: "done" })], TURN, t)).toEqual({ kind: "none" });
    expect(decide("what's up", { kind: "message" }, [action({ id: "a3" })], TURN, t)).toEqual({ kind: "none" });
  });

  it("numbers several by order, asks which, and explains closed or missing numbers", () => {
    const a1 = action({ id: "a1", created_at: iso(-3), status: "done" });
    const a2 = action({ id: "a2", created_at: iso(-2), title: "Open a ticket" });
    const a3 = action({ id: "a3", created_at: iso(-1), title: "Remind me Friday" });
    const all = [a3, a1, a2];
    expect(listingFor(all, TURN).map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(decide("yes 2", confirm(2), all, TURN, t)).toEqual({ kind: "confirm", action: a2, n: 2 });
    expect(decide("no 3", cancel(3), all, TURN, t)).toEqual({ kind: "cancel", action: a3, n: 3 });
    expect(decide("yes", confirm(), all, TURN, t)).toEqual({ kind: "explain", text: "Which one? Reply YES 2 or YES 3." });
    expect(decide("yes 1", confirm(1), all, TURN, t)).toEqual({ kind: "explain", text: "#1 (Create lead — Jumbo's Pizza) is already done." });
    expect(decide("yes 7", confirm(7), all, TURN, t)).toEqual({ kind: "explain", text: "There is no #7. Reply YES 2 or YES 3." });
    expect(stillOpenLine(all, TURN, "a2", t)).toBe("Still waiting: 3) Remind me Friday. Reply YES 3 to confirm.");
  });

  it("never numbers a proposal the assistant replaced", () => {
    const replaced = action({ id: "a1", created_at: iso(-3), status: "cancelled", error: "Replaced by a corrected proposal." });
    const fixed = action({ id: "a2", created_at: iso(-2) });
    expect(listingFor([replaced, fixed], TURN).map((a) => a.id)).toEqual(["a2"]);
    expect(decide("yes", confirm(), [replaced, fixed], TURN, t)).toEqual({ kind: "confirm", action: fixed, n: null });
  });

  it("wants a critical change's words — which work wherever it is listed", () => {
    const crit = action({ id: "c1", risk: "critical", confirm_phrase: "Jumbo's Pizza", title: "Archive Jumbo's Pizza", turn_id: OLD_TURN });
    expect(decide("yes", confirm(), [crit], OLD_TURN, t)).toEqual({
      kind: "explain",
      text: `Archive Jumbo's Pizza is a high-impact change. To confirm it, type "Jumbo's Pizza" — or reply NO to cancel.`,
    });
    expect(decide('"jumbo\'s pizza"', parseCommand('"jumbo\'s pizza"'), [crit], TURN, t)).toEqual({ kind: "confirm", action: crit, n: null, phrase: "Jumbo's Pizza" });
    // Sent to an approver instead, a bare YES is enough.
    const needsApproval = action({ id: "c2", risk: "critical", confirm_phrase: "X", card: { approval: { reason: "Needs an admin." } } });
    expect(decide("yes", confirm(), [needsApproval], TURN, t)).toEqual({ kind: "confirm", action: needsApproval, n: null });
  });

  it("treats an expired proposal as closed", () => {
    const stale = action({ id: "a1", expires_at: iso(-1) });
    expect(decide("yes", confirm(), [stale], TURN, t)).toEqual({ kind: "none" });
    expect(decide("yes 1", confirm(1), [stale], TURN, t)).toEqual({ kind: "explain", text: "Create lead — Jumbo's Pizza has expired. Ask again for a fresh one." });
  });
});

/* ------------------------------------------------------------- sending */

describe("sending replies", () => {
  it("posts plain text to Telegram, split above 4000 characters", async () => {
    configureAll();
    await sendText("telegram", "5551234", `${"a".repeat(3990)}\n\n${"b".repeat(100)}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123456:TEST-TOKEN-never-logged/sendMessage");
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: "5551234", text: "a".repeat(3990), disable_web_page_preview: true });
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)).text).toBe("b".repeat(100));
  });

  it("posts a text message to WhatsApp with the bearer token", async () => {
    configureAll();
    await sendText("whatsapp", "923001234567", "Done: it worked.");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/109876543210/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer EAAG-wa-token-never-logged");
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "923001234567",
      type: "text",
      text: { preview_url: false, body: "Done: it worked." },
    });
  });

  it("fails with the platform's words, never the token", async () => {
    configureAll();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 }));
    const err = await sendText("telegram", "1", "hi").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("telegram send failed (HTTP 400): Bad Request: chat not found");
    expect((err as Error).message).not.toContain("TEST-TOKEN");
  });
});

/* ------------------------------------------------------ inbound messages */

const LINK_ROW = { id: LINK, user_id: USER, channel: "telegram", external_id: "5551234", label: "@sam_k", conversation_id: CONV, active: true, created_at: iso(-600), last_seen_at: null };
const PROFILE = { id: USER, display_name: "Sam", email: "sam@example.com", ui_preferences: { assistantName: "Nova" }, is_active: true };

function setup(seed: Record<string, Row[]> = {}) {
  const db = fakeAdmin({ profiles: [PROFILE], assistant_channel_links: [LINK_ROW], ...seed });
  h.conversations.set(CONV, { id: CONV, title: "Telegram", pinned: false, user_id: USER, created_at: iso(-600), updated_at: iso(-600), last_message_at: iso(-600) });
  const sent: string[] = [];
  const presence = vi.fn(async () => {});
  const deps = {
    admin: db.client,
    send: async (_c: string, _to: string, text: string) => void sent.push(text),
    presence,
    origin: ORIGIN,
    now: () => NOW,
  };
  let seq = 0;
  const msg = (text: string | null, externalId = "5551234"): InboundMessage => ({ channel: "telegram", externalId, messageId: `m${++seq}-${randomUUID()}`, text, label: "@sam_k" });
  return { db, sent, presence, deps, msg };
}

describe("a message from a phone", () => {
  it("gets only the not-linked line from an unlinked chat", async () => {
    const { db, sent, deps, msg } = setup({ assistant_channel_links: [] });
    await handleInbound(msg("what are my leads?"), deps);
    await handleInbound(msg(null), deps);
    expect(sent).toEqual([MESSAGES.notLinked, MESSAGES.notLinked]);
    expect(runTurn).not.toHaveBeenCalled();
    expect(db.tables.assistant_channel_links).toEqual([]);
  });

  it("links a chat with a valid code and starts its phone conversation", async () => {
    const { db, sent, deps, msg } = setup({
      assistant_channel_links: [],
      assistant_link_codes: [{ code: "123456", user_id: USER, channel: "telegram", expires_at: iso(5) }],
    });
    await handleInbound(msg("link 123456", "999"), deps);
    expect(sent).toEqual(["Linked to Sam's SED AI. Ask me anything, or tell me what to do."]);
    expect(db.tables.assistant_link_codes).toEqual([]);
    expect(db.tables.assistant_channel_links).toHaveLength(1);
    expect(db.tables.assistant_channel_links[0]).toMatchObject({ user_id: USER, channel: "telegram", external_id: "999", label: "@sam_k", active: true, conversation_id: "conv-1" });
    expect(h.conversations.get("conv-1")).toMatchObject({ title: "Telegram", user_id: USER });
    expect(bell).toHaveBeenCalledWith(db.client, USER, expect.objectContaining({ title: "Telegram linked to your SED AI" }));
  });

  it("refuses wrong codes, and stops listening after too many", async () => {
    const { sent, deps, msg } = setup({ assistant_channel_links: [] });
    for (let i = 0; i < 6; i++) await handleInbound(msg(`/start 00000${i}`, "777"), deps);
    expect(sent.slice(0, 5)).toEqual(Array(5).fill(MESSAGES.badCode));
    expect(sent[5]).toBe(MESSAGES.tooManyCodes);
  });

  it("answers a linked chat's message as that person, in act mode, with the proposal as text", async () => {
    const { db, sent, presence, deps, msg } = setup();
    vi.mocked(runTurn).mockImplementation(async (input: TurnInput) => {
      input.emit({ type: "start", conversation: input.conversation, userMessageId: TURN });
      input.emit({ type: "text", delta: "Half an answ" });
      input.emit({ type: "reset" });
      input.emit({ type: "text", delta: "I prepared it — see [the lead](/leads/abc)." });
      // What prepare_action stores and shows while the answer is worked out.
      const proposed = action({ id: "a1", card: { fields: [{ name: "business_name", label: "Business name", value: "Jumbo's Pizza" }] } });
      db.tables.assistant_actions = [proposed as unknown as Row];
      input.emit({ type: "action", card: toCard(proposed) });
      input.emit({ type: "done", messageId: "m1", stopped: false });
    });
    await handleInbound(msg("create a lead for Jumbo's Pizza"), deps);

    expect(h.actedAs).toEqual([USER]);
    const input = vi.mocked(runTurn).mock.calls[0][0];
    expect(input).toMatchObject({ userId: USER, displayName: "Sam", assistantName: "Nova", text: "create a lead for Jumbo's Pizza", mode: "act", source: "telegram" });
    expect(input.conversation.id).toBe(CONV);
    expect(input.db).toEqual(expect.objectContaining({ rls: true }));
    expect(sent).toEqual([
      "I prepared it — see the lead: https://app.test/leads/abc.\n\nCreate lead — Jumbo's Pizza\nBusiness name: Jumbo's Pizza\nReply YES to confirm or NO to cancel.",
    ]);
    expect(db.tables.assistant_channel_links[0].last_seen_at).toBe(NOW.toISOString());
    expect(presence).toHaveBeenCalledWith(expect.anything(), "typing");
  });

  it("asks in ask mode for someone without action mode — where YES is just a word", async () => {
    h.perms = new Set(["assistant.use"]);
    const { sent, deps, msg } = setup({ assistant_actions: [action({ id: "a1" }) as unknown as Row] });
    h.latestTurn = TURN;
    vi.mocked(runTurn).mockImplementation(async (input: TurnInput) => {
      input.emit({ type: "start", conversation: input.conversation, userMessageId: "t2" });
      input.emit({ type: "text", delta: "Yes to what?" });
      input.emit({ type: "done", messageId: "m", stopped: false });
    });
    await handleInbound(msg("yes"), deps);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(vi.mocked(runTurn).mock.calls[0][0]).toMatchObject({ mode: "ask", text: "yes" });
    expect(sent).toEqual(["Yes to what?"]);
  });

  it("confirms the open proposal on YES, as the person, and reports the outcome", async () => {
    const row = action({ id: "a1" });
    const { sent, deps, msg } = setup({ assistant_actions: [row as unknown as Row] });
    h.latestTurn = TURN;
    vi.mocked(confirmAction).mockResolvedValue({
      ...toCard(row, NOW.getTime()),
      status: "done",
      result: { message: "Created the lead Jumbo's Pizza.", link: { href: "/leads/abc", label: "Open lead" } },
    });
    await handleInbound(msg("Yes!"), deps);
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", origin: ORIGIN, phrase: undefined, ctx: expect.objectContaining({ userId: USER, displayName: "Sam" }) }));
    expect(h.actedAs).toEqual([USER]);
    expect(runTurn).not.toHaveBeenCalled();
    expect(sent).toEqual(["Done: Created the lead Jumbo's Pizza.\nOpen lead: https://app.test/leads/abc"]);
  });

  it("sends it to the admins when the person cannot do it themselves", async () => {
    const row = action({ id: "a1", card: { approval: { reason: "You don't have “Delete Lead”." } } });
    const { sent, deps, msg } = setup({ assistant_actions: [row as unknown as Row] });
    h.latestTurn = TURN;
    vi.mocked(requestApproval).mockResolvedValue({ ...toCard(row, NOW.getTime()), status: "awaiting_approval" });
    await handleInbound(msg("ok"), deps);
    expect(requestApproval).toHaveBeenCalledWith("a1", expect.objectContaining({ userId: USER }), null);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(sent[0]).toMatch(/^Sent to an admin for approval: Create lead — Jumbo's Pizza\./);
  });

  it("cancels on NO, and explains a bare YES on a high-impact change without running anything", async () => {
    const plain = action({ id: "a1", created_at: iso(-3) });
    const crit = action({ id: "a2", created_at: iso(-2), risk: "critical", confirm_phrase: "Jumbo's Pizza", title: "Archive Jumbo's Pizza" });
    const { db, sent, deps, msg } = setup({ assistant_actions: [plain as unknown as Row, crit as unknown as Row] });
    h.latestTurn = TURN;
    vi.mocked(cancelAction).mockImplementation(async (id) => {
      const stored = db.tables.assistant_actions.find((r) => r.id === id)!;
      stored.status = "cancelled";
      return { ...toCard(stored as unknown as StoredAction, NOW.getTime()), status: "cancelled" };
    });
    await handleInbound(msg("no 1"), deps);
    expect(cancelAction).toHaveBeenCalledWith("a1", expect.objectContaining({ userId: USER }));
    expect(sent[0]).toBe("Cancelled: Create lead — Jumbo's Pizza. Nothing was changed.\n\nStill waiting: 2) Archive Jumbo's Pizza. Reply YES 2 to confirm.");

    h.actedAs = [];
    await handleInbound(msg("yes 2"), deps);
    expect(sent[1]).toBe(`#2 (Archive Jumbo's Pizza) is a high-impact change. To confirm it, type "Jumbo's Pizza" — or reply NO 2 to cancel.`);
    expect(h.actedAs).toEqual([]);

    vi.mocked(confirmAction).mockResolvedValue({ ...toCard(crit, NOW.getTime()), status: "done", result: { message: "Archived Jumbo's Pizza." } });
    await handleInbound(msg("jumbo's pizza"), deps);
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ id: "a2", phrase: "Jumbo's Pizza" }));
    expect(sent[2]).toBe("Done: Archived Jumbo's Pizza.");
  });

  it("says when the person's account cannot use SED AI", async () => {
    h.perms = new Set();
    const { sent, deps, msg } = setup();
    await handleInbound(msg("hello"), deps);
    expect(sent).toEqual([MESSAGES.noAccess]);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("unlinks the chat of a deactivated account", async () => {
    h.actAsError = "That account is deactivated.";
    const { db, sent, deps, msg } = setup();
    await handleInbound(msg("hello"), deps);
    expect(sent).toEqual([MESSAGES.deactivated]);
    expect(db.tables.assistant_channel_links[0].active).toBe(false);
  });

  it("keeps the link when signing in only failed for now", async () => {
    h.actAsError = "Could not sign in for that account.";
    const { db, sent, deps, msg } = setup();
    await handleInbound(msg("hello"), deps);
    expect(sent).toEqual([MESSAGES.signInFailed]);
    expect(db.tables.assistant_channel_links[0].active).toBe(true);
  });

  it("is still busy with the last message", async () => {
    const { sent, deps, msg } = setup();
    startRun(USER, CONV);
    await handleInbound(msg("and another thing"), deps);
    expect(sent).toEqual([MESSAGES.busy]);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("handles a batch in order per chat: the link first, then the question", async () => {
    const { db, sent, deps } = setup({
      assistant_channel_links: [],
      assistant_link_codes: [{ code: "246810", user_id: USER, channel: "whatsapp", expires_at: iso(5) }],
    });
    vi.mocked(runTurn).mockImplementation(async (input: TurnInput) => {
      input.emit({ type: "start", conversation: input.conversation, userMessageId: "t9" });
      input.emit({ type: "text", delta: "You have **3** leads." });
      input.emit({ type: "done", messageId: "m", stopped: false });
    });
    const wa = (id: string, text: string): InboundMessage => ({ channel: "whatsapp", externalId: "923001234567", messageId: id, text, label: "+923001234567" });
    await handleInboundAll([wa("wamid.a", "link 246810"), wa("wamid.b", "how many leads do I have?")], deps);
    expect(sent).toEqual(["Linked to Sam's SED AI. Ask me anything, or tell me what to do.", "You have 3 leads."]);
    expect(db.tables.assistant_channel_links[0]).toMatchObject({ channel: "whatsapp", external_id: "923001234567", label: "+923001234567" });
    expect(vi.mocked(runTurn).mock.calls[0][0]).toMatchObject({ source: "whatsapp", text: "how many leads do I have?" });
  });

  it("answers a re-delivered message once", async () => {
    const { sent, deps } = setup({ assistant_channel_links: [] });
    const m: InboundMessage = { channel: "telegram", externalId: "1", messageId: "dup-1", text: "hi", label: null };
    await handleInbound(m, deps);
    await handleInbound(m, deps);
    expect(sent).toHaveLength(1);
  });
});

/* ------------------------------------------------------------ the routes */

describe("webhooks", () => {
  const tgRequest = (body: unknown, secret?: string) =>
    new Request("http://test.local/api/assistant/channels/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {}) },
      body: JSON.stringify(body),
    });
  const tgUpdate = { update_id: 77, message: { message_id: 1, chat: { id: 4242, type: "private" }, from: { id: 4242, username: "x" }, text: "hello" } };

  it("Telegram: 503 unconfigured, 401 without the secret, 200 and the work after the response", async () => {
    expect((await telegramPOST(tgRequest(tgUpdate, "tg-secret_value-1"))).status).toBe(503);
    configureAll();
    expect((await telegramPOST(tgRequest(tgUpdate))).status).toBe(401);
    expect((await telegramPOST(tgRequest(tgUpdate, "wrong"))).status).toBe(401);
    expect(h.after).toHaveLength(0);

    h.admin = fakeAdmin().client;
    const res = await telegramPOST(tgRequest(tgUpdate, "tg-secret_value-1"));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.after).toHaveLength(1);
    await h.after[0]();
    // An unlinked chat: the not-linked line goes back through the Bot API.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/sendMessage$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: "4242", text: MESSAGES.notLinked });
  });

  it("WhatsApp: verifies the callback, and only signed deliveries are handled", async () => {
    configureAll();
    const verify = await whatsappGET(new Request("http://test.local/api/assistant/channels/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444"));
    expect(verify.status).toBe(200);
    expect(await verify.text()).toBe("1158201444");
    expect((await whatsappGET(new Request("http://test.local/x?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1"))).status).toBe(403);

    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "109876543210" }, messages: [{ id: "wamid.9", from: "923001234567", type: "text", text: { body: "hi" } }] } }] }],
    });
    const post = (sig: string) => new Request("http://test.local/api/assistant/channels/whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": sig }, body });
    expect((await whatsappPOST(post("sha256=" + "0".repeat(64)))).status).toBe(401);
    expect(h.after).toHaveLength(0);
    const ok = await whatsappPOST(post(`sha256=${createHmac("sha256", "wa-app-secret").update(body).digest("hex")}`));
    expect(ok.status).toBe(200);
    expect(h.after).toHaveLength(1);
  });
});

describe("linking from the app", () => {
  it("creates a code with instructions — or says which settings are missing", async () => {
    h.guard = { ok: true, caller: { user: { id: USER }, perms: new Set(["assistant.use"]), supabase: {}, displayName: "Sam", assistantName: "Nova" } };
    const db = fakeAdmin();
    h.admin = db.client;
    const ask = (channel: string) => channelsPOST(new Request("http://test.local/api/assistant/channels", { method: "POST", body: JSON.stringify({ channel }) }));

    const missing = await ask("telegram");
    expect(missing.status).toBe(503);
    expect(((await missing.json()) as { error: string }).error).toContain("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME");
    expect((await ask("sms")).status).toBe(422);

    configureAll();
    const res = await ask("telegram");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; instructions: string; url: string };
    expect(body.instructions).toBe(`Send  link ${body.code}  to @SedAiBot`);
    expect(body.url).toBe(`https://t.me/SedAiBot?start=${body.code}`);
    expect(db.tables.assistant_link_codes).toEqual([expect.objectContaining({ code: body.code, user_id: USER, channel: "telegram" })]);
  });

  it("lists the caller's own phones, and unlinks only those", async () => {
    configureAll();
    h.user = { id: USER };
    const db = fakeAdmin({
      assistant_channel_links: [LINK_ROW, { ...LINK_ROW, id: "77777777-7777-4777-8777-777777777777", user_id: OTHER, external_id: "1" }],
    });
    h.admin = db.client;
    const list = (await (await channelsGET()).json()) as { links: { id: string }[]; configured: Record<string, boolean> };
    expect(list.links.map((l) => l.id)).toEqual([LINK]);
    expect(list.configured).toEqual({ telegram: true, whatsapp: true });

    const del = (id: string) => channelDELETE(new Request(`http://test.local/api/assistant/channels/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
    expect((await del("77777777-7777-4777-8777-777777777777")).status).toBe(404);
    expect((await del(LINK)).status).toBe(200);
    expect(db.tables.assistant_channel_links.map((l) => l.user_id)).toEqual([OTHER]);
    // The chat is told, after the response.
    await h.after[0]();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({ chat_id: "5551234", text: "This chat is no longer linked to SED AI." });
  });
});
