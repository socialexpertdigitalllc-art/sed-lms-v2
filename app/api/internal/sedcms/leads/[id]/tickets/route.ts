import { createAdminClient } from "@/lib/supabase/admin";
import { TICKET_REQUEST_BYTES, readSignedJson, sedcmsError, sedcmsJson } from "@/lib/sedcms/http";
import { loadLead } from "@/lib/sedcms/lead";
import { requireLink } from "@/lib/sedcms/links";
import { ChangeRequestBody, createChangeTicket } from "@/lib/sedcms/tickets";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/internal/sedcms/leads/{id}/tickets
 *   { requestId, title, items: string[] (1–10), requestedBy: { name, email }, pageUrl? }
 * A client's "Request a change" from SED CMS becomes a Changes ticket on the
 * lead, with the usual "ticket opened" notification. Signed by the CMS; no
 * session. 201 { ticketId } — the same ticketId again for a repeated
 * requestId. The lead's status is not checked (lib/sedcms/tickets.ts), but
 * SED CMS must be turned on for it (404 NO_LEAD; its host is not checked: a
 * ticket asks the staff, it changes no file).
 */
export async function POST(req: Request, ctx: Ctx) {
  const signed = await readSignedJson(req, ChangeRequestBody, TICKET_REQUEST_BYTES);
  if (!signed.ok) return signed.response;
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const found = await loadLead(admin, id);
  if (!found.ok) return found.response;
  const linked = await requireLink(admin, found.lead);
  if (!linked.ok) return linked.response;

  const result = await createChangeTicket(admin, found.lead, signed.body);
  if (!result.ok) return sedcmsError(result.status, result.code, result.message);
  return sedcmsJson(201, { ticketId: result.ticketId });
}
