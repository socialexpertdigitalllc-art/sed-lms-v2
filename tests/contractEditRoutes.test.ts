// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { makeDoc, applyDocRequests } from "./helpers/fakeDocs";

/**
 * The contract routes that change a draft before it goes out: creating one
 * with a payment schedule or the agent's own PDF, editing its wording in the
 * Google Doc, replacing or refreshing its PDF — and sending it.
 */

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  perms: new Set<string>(["contracts.send"]),
  db: null as unknown as MemoryDb,
  files: new Map<string, Uint8Array>(),
  doc: { paras: [] as string[], revision: 1 },
  exports: 0,
  sent: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db.client }));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => state.perms }));
vi.mock("@/lib/settings/appSettings", () => ({
  getAppSettings: async () => ({ work_timezone: "Asia/Karachi", generated_contracts_folder_id: null }),
}));
vi.mock("@/lib/google/drive", () => ({
  copyDoc: async () => "doc-copy",
  docUrl: (id: string) => `https://docs.google.com/document/d/${id}/edit`,
  exportPdf: async () => {
    state.exports++;
    return new TextEncoder().encode(`%PDF-1.7 export ${state.exports}: ${state.doc.paras.join(" | ")}`);
  },
}));
vi.mock("@/lib/google/docs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/google/docs")>();
  return {
    ...real,
    replaceAllText: async (_id: string, reps: { token: string; value: string }[]) => {
      state.doc.paras = state.doc.paras
        .map((p) => reps.reduce((t, r) => t.split(r.token).join(r.value), p))
        .flatMap((p) => p.split("\n"));
      state.doc.revision++;
    },
    getDocument: async () => ({ revisionId: `rev${state.doc.revision}`, body: makeDoc(state.doc.paras) }),
    batchUpdateDoc: async (_id: string, requests: unknown[], required?: string | null) => {
      if (required && required !== `rev${state.doc.revision}`) throw new real.DocChangedError();
      state.doc.paras = applyDocRequests(state.doc.paras, requests).paras;
      state.doc.revision++;
    },
  };
});
vi.mock("@/lib/mail/mailbox", () => ({
  getMailboxById: async () => ({ address: "sales@sed.test", displayName: "SED" }),
}));
vi.mock("@/lib/mail/config", () => ({ buildSmtpConfig: () => ({ jsonTransport: true }) }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async (m: unknown) => void state.sent.push(m) }) },
}));
vi.mock("@/lib/notifications/notify", () => ({ notify: async () => {} }));

import { POST as create } from "@/app/api/contracts/route";
import { GET as getContent, PUT as putContent } from "@/app/api/contracts/[id]/content/route";
import { POST as refreshPdf } from "@/app/api/contracts/[id]/refresh-pdf/route";
import { GET as getPdf, POST as uploadPdf } from "@/app/api/contracts/[id]/pdf/route";
import { POST as send } from "@/app/api/contracts/[id]/send/route";
import { depositAndBalance } from "@/lib/contracts/payments";
import type { DocBlock } from "@/lib/contracts/docEdit";

const LEAD = "11111111-1111-4111-8111-111111111111";
const MAILBOX = "22222222-2222-4222-8222-222222222222";
const TEMPLATE = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_WITH_SLOT = "44444444-4444-4444-8444-444444444444";

const TEMPLATE_TEXT = ["WEBSITE AGREEMENT", "Fee: {{one_time_price}} (USD) / One Time", "Payments are non-refundable once work has commenced."];

const pdfBytes = (s = "client contract") => new TextEncoder().encode(`%PDF-1.4\n${s}`);

function storage() {
  return {
    from: () => ({
      upload: async (path: string, data: Uint8Array) => (state.files.set(path, new Uint8Array(data)), { data: { path }, error: null }),
      download: async (path: string) => {
        const f = state.files.get(path);
        return { data: f ? new Blob([f as BlobPart]) : null, error: f ? null : { message: "not found" } };
      },
      remove: async (paths: string[]) => (paths.forEach((p) => state.files.delete(p)), { data: null, error: null }),
    }),
  };
}

beforeEach(() => {
  state.user = { id: "u1" };
  state.perms = new Set(["contracts.send"]);
  state.files = new Map();
  state.doc = { paras: [...TEMPLATE_TEXT], revision: 1 };
  state.exports = 0;
  state.sent = [];
  state.db = memorySupabase({
    leads: [{ id: LEAD, deleted_at: null, business_name: "Acme Plumbing", business_email: "owner@acme.test", business_phone: null, price_quoted: 1200, yearly_price: 300, agent_id: null, closed_by: null }],
    profiles: [{ id: "u1", display_name: "Jordan" }],
    company_mailboxes: [{ id: MAILBOX, status: "verified" }],
    contract_templates: [
      { id: TEMPLATE, google_doc_id: "tpl-doc", placeholders: ["{{one_time_price}}"] },
      { id: TEMPLATE_WITH_SLOT, google_doc_id: "tpl-doc-2", placeholders: ["{{one_time_price}}", "{{payment_terms}}"] },
    ],
    contract_placeholders: [],
    contracts: [],
    activity_log: [],
  });
  (state.db.client as unknown as { storage: unknown }).storage = storage();
});

const json = (body: unknown, method = "POST") =>
  new Request("http://lms.test/api/contracts", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const base = { lead_id: LEAD, mailbox_id: MAILBOX, template_key: "standard", message_body: "Hi" };
const contract = () => state.db.tables.contracts[0] as Record<string, unknown>;

function multipart(data: unknown, file?: { bytes: Uint8Array; name: string }) {
  const form = new FormData();
  form.set("data", JSON.stringify(data));
  if (file) form.set("file", new File([file.bytes as BlobPart], file.name, { type: "application/pdf" }));
  return new Request("http://lms.test/api/contracts", { method: "POST", body: form });
}

async function draftFromTemplate(extra: Record<string, unknown> = {}) {
  const res = await create(json({ ...base, google_template_id: TEMPLATE, ...extra }));
  expect(res.status).toBe(201);
  return (await res.json()) as { contract: { id: string }; notice: string | null };
}

describe("POST /api/contracts — payment schedules", () => {
  it("stores the schedule and writes it into a template that has no slot for it, after the price line", async () => {
    const { contract: c, notice } = await draftFromTemplate({ payment_plan: depositAndBalance(1200, 600) });
    expect(contract().payment_plan).toEqual(depositAndBalance(1200, 600));
    expect(state.doc.paras).toEqual([
      "WEBSITE AGREEMENT",
      "Fee: $1,200.00 (USD) / One Time",
      expect.stringMatching(/^The one-time fee of \$1,200\.00 will be paid in two parts/),
      "1. $600.00 (Deposit) — due upon signing this agreement",
      "2. $600.00 (Balance) — due when work on the project begins",
      "Payments are non-refundable once work has commenced.",
    ]);
    expect(notice).toMatch(/added after the line with the price/);
    // The PDF was exported after the schedule went in.
    expect(new TextDecoder().decode(state.files.get(`${c.id}.pdf`))).toContain("$600.00 (Deposit)");
  });

  it("a template with {{payment_terms}} gets the terms right there, untouched otherwise", async () => {
    state.doc.paras = ["AGREEMENT", "Fee: {{one_time_price}}", "{{payment_terms}}", "End"];
    const res = await create(json({ ...base, google_template_id: TEMPLATE_WITH_SLOT, payment_plan: depositAndBalance(1200, 300) }));
    const { notice } = await res.json();
    expect(notice).toBeNull();
    expect(state.doc.paras.slice(2, 5)).toEqual([
      expect.stringMatching(/two parts/),
      "1. $300.00 (Deposit) — due upon signing this agreement",
      "2. $900.00 (Balance) — due when work on the project begins",
    ]);
    expect(state.doc.paras.at(-1)).toBe("End");
  });

  it("a schedule must add up to the (discounted) price; nothing is created otherwise", async () => {
    const res = await create(json({ ...base, google_template_id: TEMPLATE, one_time_price: 1000, payment_plan: depositAndBalance(1200, 600) }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("The payments add up to $1,200.00, but the one-time price is $1,000.00.");
    expect(state.db.tables.contracts).toHaveLength(0);
  });

  it("paid in full is stored as no schedule and leaves the template alone", async () => {
    await draftFromTemplate({ payment_plan: { payments: [{ amount: 1200, due: { kind: "signing" } }] } });
    expect(contract().payment_plan).toBeNull();
    expect(state.doc.paras).toEqual(["WEBSITE AGREEMENT", "Fee: $1,200.00 (USD) / One Time", TEMPLATE_TEXT[2]]);
  });
});

describe("POST /api/contracts — the agent's own PDF", () => {
  it("creates a draft holding the uploaded file, no template involved", async () => {
    const res = await create(multipart({ ...base, source: "upload" }, { bytes: pdfBytes(), name: "Acme – custom terms.pdf" }));
    expect(res.status).toBe(201);
    const { contract: c } = await res.json();
    expect(contract()).toMatchObject({ template_key: "upload", google_template_id: null, pdf_uploaded_name: "Acme – custom terms.pdf", payment_plan: null });
    expect(new TextDecoder().decode(state.files.get(`${c.id}.pdf`))).toBe("%PDF-1.4\nclient contract");
    expect(state.exports).toBe(0);
  });

  it("refuses a missing file or one that isn't a PDF", async () => {
    expect((await create(multipart({ ...base, source: "upload" }))).status).toBe(422);
    const res = await create(multipart({ ...base, source: "upload" }, { bytes: new TextEncoder().encode("PK\u0003\u0004 a zip"), name: "contract.pdf" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/isn't a PDF/);
    expect(state.db.tables.contracts).toHaveLength(0);
  });
});

describe("GET/PUT /api/contracts/[id]/content — edit the wording", () => {
  async function load(id: string) {
    const res = await getContent(new Request("http://lms.test"), ctx(id));
    expect(res.status).toBe(200);
    return (await res.json()) as { blocks: DocBlock[]; revisionId: string };
  }
  const put = (id: string, body: unknown) =>
    putContent(new Request("http://lms.test", { method: "PUT", body: JSON.stringify(body) }), ctx(id));

  it("writes edits into the doc, re-makes the PDF, and logs it", async () => {
    const { contract: c } = await draftFromTemplate();
    const { blocks, revisionId } = await load(c.id);
    const fee = blocks.find((b) => b.text.startsWith("Fee"))!;
    const res = await put(c.id, {
      revisionId,
      edits: [
        { op: "replace", key: fee.key, oldText: fee.text, text: "Fee: $1,200.00 (USD), paid in two parts" },
        { op: "insert_after", key: fee.key, paragraphs: ["Hosting is included for the first year."] },
      ],
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(state.doc.paras).toEqual([
      "WEBSITE AGREEMENT",
      "Fee: $1,200.00 (USD), paid in two parts",
      "Hosting is included for the first year.",
      TEMPLATE_TEXT[2],
    ]);
    expect(out.blocks.map((b: DocBlock) => b.text)).toEqual(state.doc.paras);
    expect(out.contract.edited_at).toBeTruthy();
    expect(out.contract.pdf_path).toMatch(new RegExp(`^${c.id}-v\\d+\\.pdf$`));
    expect(new TextDecoder().decode(state.files.get(out.contract.pdf_path))).toContain("Hosting is included");
    expect(state.db.tables.activity_log.map((a) => a.action)).toContain("contract.edited");

    // The preview serves the edited PDF, never from cache.
    const pdf = await getPdf(new Request("http://lms.test"), ctx(c.id));
    expect(pdf.headers.get("cache-control")).toBe("private, no-store");
    expect(await pdf.text()).toContain("Hosting is included");
  });

  it("refuses edits made against an older version of the doc", async () => {
    const { contract: c } = await draftFromTemplate();
    const { blocks, revisionId } = await load(c.id);
    state.doc.paras[2] = "Someone changed this in Google Docs.";
    state.doc.revision++;
    const res = await put(c.id, { revisionId, edits: [{ op: "remove", key: blocks[2].key, oldText: blocks[2].text }] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("doc_changed");
    expect(state.doc.paras[2]).toBe("Someone changed this in Google Docs.");
  });

  it("only drafts with a Google Doc, only for people who may send", async () => {
    const { contract: c } = await draftFromTemplate();
    state.perms = new Set(["contracts.view"]);
    expect((await getContent(new Request("http://lms.test"), ctx(c.id))).status).toBe(403);
    state.perms = new Set(["contracts.send"]);
    state.db.tables.contracts[0].status = "sent";
    expect((await getContent(new Request("http://lms.test"), ctx(c.id))).status).toBe(409);
    state.db.tables.contracts[0].status = "draft";
    state.db.tables.contracts[0].generated_doc_id = null;
    expect((await getContent(new Request("http://lms.test"), ctx(c.id))).status).toBe(409);
  });
});

describe("POST /api/contracts/[id]/pdf and /refresh-pdf — swap the PDF", () => {
  const upload = (id: string, bytes: Uint8Array, name = "mine.pdf") => {
    const form = new FormData();
    form.set("file", new File([bytes as BlobPart], name, { type: "application/pdf" }));
    return uploadPdf(new Request("http://lms.test", { method: "POST", body: form }), ctx(id));
  };

  it("replaces a generated PDF with the agent's file; Refresh PDF goes back to the doc", async () => {
    const { contract: c } = await draftFromTemplate();
    const first = await upload(c.id, pdfBytes("v1"), "Signed draft.pdf");
    expect(first.status).toBe(200);
    const v1 = (await first.json()).contract;
    expect(v1.pdf_uploaded_name).toBe("Signed draft.pdf");

    const second = (await (await upload(c.id, pdfBytes("v2"))).json()).contract;
    // The superseded upload is cleaned up; the original stays until send replaces it.
    expect(state.files.has(v1.pdf_path)).toBe(false);
    expect(new TextDecoder().decode(state.files.get(second.pdf_path))).toBe("%PDF-1.4\nv2");

    const refreshed = await refreshPdf(new Request("http://lms.test", { method: "POST" }), ctx(c.id));
    const back = (await refreshed.json()).contract;
    expect(back.pdf_uploaded_name).toBeNull();
    expect(new TextDecoder().decode(state.files.get(back.pdf_path))).toMatch(/^%PDF-1\.7 export/);
  });

  it("refuses files that aren't PDFs, and contracts already sent", async () => {
    const { contract: c } = await draftFromTemplate();
    expect((await upload(c.id, new TextEncoder().encode("hello"))).status).toBe(422);
    state.db.tables.contracts[0].status = "sent";
    expect((await upload(c.id, pdfBytes())).status).toBe(409);
  });
});

describe("POST /api/contracts/[id]/send", () => {
  it("emails exactly the PDF the draft holds — an uploaded one included", async () => {
    const res = await create(multipart({ ...base, source: "upload" }, { bytes: pdfBytes("custom"), name: "custom.pdf" }));
    const { contract: c } = await res.json();
    const sent = await send(new Request("http://lms.test", { method: "POST" }), ctx(c.id));
    expect(sent.status).toBe(200);
    const mail = state.sent[0] as { attachments: { content: Buffer }[] };
    expect(mail.attachments[0].content.toString()).toBe("%PDF-1.4\ncustom");
  });

  it("an upload draft without its file can't be sent", async () => {
    const res = await create(multipart({ ...base, source: "upload" }, { bytes: pdfBytes(), name: "x.pdf" }));
    const { contract: c } = await res.json();
    state.db.tables.contracts[0].pdf_path = null;
    const sent = await send(new Request("http://lms.test", { method: "POST" }), ctx(c.id));
    expect(sent.status).toBe(409);
    expect(state.sent).toHaveLength(0);
  });

  it("after an edit, the sent copy replaces the draft's versioned file", async () => {
    const { contract: c } = await draftFromTemplate();
    const form = new FormData();
    form.set("file", new File([pdfBytes("edited") as BlobPart], "e.pdf"));
    const draft = (await (await uploadPdf(new Request("http://lms.test", { method: "POST", body: form }), ctx(c.id))).json()).contract;
    await send(new Request("http://lms.test", { method: "POST" }), ctx(c.id));
    expect(contract()).toMatchObject({ status: "sent", pdf_path: `${c.id}.pdf` });
    expect(new TextDecoder().decode(state.files.get(`${c.id}.pdf`))).toBe("%PDF-1.4\nedited");
    expect(state.files.has(draft.pdf_path)).toBe(false);
  });
});
