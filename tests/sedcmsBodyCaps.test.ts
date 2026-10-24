// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { withEnv } from "./helpers/fakeSiteHosts";
import { SEDCMS_DEFAULTS, SEDCMS_UNIQUE, TEST_SECRET, leadPath, linkRow, routeCtx, signedRequest } from "./helpers/sedcmsRoutes";
import { MAX_REQUEST_BYTES, SMALL_REQUEST_BYTES, TICKET_REQUEST_BYTES } from "@/lib/sedcms/http";

/**
 * How much a request with made-up but well-formed signature headers can make
 * the LMS read (the security review's M1, its probe-precheck-body inverted).
 * The HMAC covers the body, so a body is read before its signature can be
 * checked; each route reads only its own cap: 64 KiB for summary, live-files
 * and checksums, 160 KiB for tickets, 30 MiB for apply alone.
 */

const state = vi.hoisted(() => ({ db: null as MemoryDb | null, fromCalls: 0 }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      state.fromCalls++;
      return state.db!.client.from(t);
    },
  }),
}));
vi.mock("@/lib/tickets/notify", () => ({ notifyTicket: async () => {} }));

import { POST as summaryPOST } from "@/app/api/internal/sedcms/leads/[id]/summary/route";
import { POST as liveFilesPOST } from "@/app/api/internal/sedcms/leads/[id]/live-files/route";
import { POST as checksumsPOST } from "@/app/api/internal/sedcms/leads/[id]/checksums/route";
import { POST as applyPOST } from "@/app/api/internal/sedcms/leads/[id]/apply/route";
import { POST as ticketsPOST } from "@/app/api/internal/sedcms/leads/[id]/tickets/route";

const LEAD = "11111111-1111-4111-8111-111111111111";
const KiB = 1024;
const MiB = 1024 * KiB;
const CHUNK = 16 * KiB;

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function streamOf(total: number, counter: { pulled: number }): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(CHUNK).fill(0x20);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(chunk.length, total - sent);
      c.enqueue(chunk.slice(0, n));
      sent += n;
      counter.pulled += n;
    },
  });
}

/** A request any caller can make: fresh timestamp, a signature of the right shape, and a body. */
function forged(endpoint: string, total: number, counter: { pulled: number }, extra: Record<string, string> = {}): Request {
  return new Request(`https://lms.sedsolutions.online${leadPath(LEAD, endpoint)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sedcms-timestamp": String(Math.floor(Date.now() / 1000)), "x-sedcms-signature": "0".repeat(64), ...extra },
    body: streamOf(total, counter),
    duplex: "half",
  } as RequestInit);
}

let restore: () => void;
beforeEach(() => {
  restore = withEnv({ SEDCMS_LMS_SECRET: TEST_SECRET, DA_DOMAIN: "dmviral.com" });
  state.db = memorySupabase(
    {
      leads: [{ id: LEAD, business_name: "Acme", business_email: null, status: "Closed", website_link: "https://acme.dmviral.com", deleted_at: null }],
      sedcms_links: [linkRow(LEAD, "acme.dmviral.com")],
      lead_tickets: [],
      ticket_items: [],
      activity_log: [],
    },
    SEDCMS_DEFAULTS,
    SEDCMS_UNIQUE,
  );
  state.fromCalls = 0;
});
afterEach(() => restore());

describe("a forged request reads at most its route's cap (probe-precheck-body, inverted)", () => {
  const small: [string, Handler, number][] = [
    ["summary", summaryPOST, SMALL_REQUEST_BYTES],
    ["live-files", liveFilesPOST, SMALL_REQUEST_BYTES],
    ["checksums", checksumsPOST, SMALL_REQUEST_BYTES],
    ["tickets", ticketsPOST, TICKET_REQUEST_BYTES],
  ];

  it("the caps", () => {
    expect(SMALL_REQUEST_BYTES).toBe(64 * KiB);
    expect(TICKET_REQUEST_BYTES).toBe(160 * KiB);
    expect(MAX_REQUEST_BYTES).toBe(30 * MiB);
  });

  it.each(small)("%s: 30 MiB sent, its cap read, then a 413; nothing else touched", async (endpoint, handler, cap) => {
    const counter = { pulled: 0 };
    const res = await handler(forged(endpoint, 30 * MiB, counter), routeCtx(LEAD));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ code: "TOO_LARGE", message: `The request body is over ${cap / KiB} KiB.` });
    expect(counter.pulled).toBeLessThanOrEqual(cap + 2 * CHUNK); // the cap, and the stream's read-ahead
    expect(state.fromCalls).toBe(0);
  });

  it.each(small)("%s: a declared Content-Length over the cap is refused before a byte is read", async (endpoint, handler, cap) => {
    const counter = { pulled: 0 };
    const res = await handler(forged(endpoint, 30 * MiB, counter, { "content-length": String(cap + 1) }), routeCtx(LEAD));
    expect(res.status).toBe(413);
    expect(counter.pulled).toBeLessThanOrEqual(2 * CHUNK); // nothing but what the stream queued on its own
  });

  it.each(small)("%s: a forged body under the cap is read, then a 401 BAD_SIGNATURE", async (endpoint, handler) => {
    const counter = { pulled: 0 };
    const res = await handler(forged(endpoint, 8 * KiB, counter), routeCtx(LEAD));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("BAD_SIGNATURE");
    expect(state.fromCalls).toBe(0);
  });

  it("apply alone takes up to 30 MiB (its real bodies are that big), and refuses past it", async () => {
    const under = { pulled: 0 };
    const a = await applyPOST(forged("apply", 2 * MiB, under), routeCtx(LEAD));
    expect(a.status).toBe(401);
    expect(under.pulled).toBe(2 * MiB);
    const over = { pulled: 0 };
    const b = await applyPOST(forged("apply", 31 * MiB, over), routeCtx(LEAD));
    expect(b.status).toBe(413);
    expect(over.pulled).toBeLessThanOrEqual(30 * MiB + 2 * CHUNK);
    expect(state.fromCalls).toBe(0);
  });

  it("the largest real ticket fits: 10 items of 2000 characters, every one escaped in the JSON", async () => {
    const control = String.fromCharCode(1); // JSON.stringify writes it as six bytes
    const body = {
      requestId: "5f0c2d1e-3b4a-4c5d-8e6f-7a8b9c0d1e2f",
      title: control.repeat(200),
      items: Array.from({ length: 10 }, () => control.repeat(2000)),
      requestedBy: { name: control.repeat(200), email: `${control.repeat(250)}@x.y` },
      pageUrl: control.repeat(2048),
    };
    const req = signedRequest(leadPath(LEAD, "tickets"), body);
    const size = (await req.clone().arrayBuffer()).byteLength;
    expect(size).toBeGreaterThan(130 * KiB);
    expect(size).toBeLessThan(TICKET_REQUEST_BYTES);
    expect((await ticketsPOST(req, routeCtx(LEAD))).status).toBe(201);
  });
});
