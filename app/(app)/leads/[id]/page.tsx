import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { isAdminMember } from "@/lib/permissions/isAdminMember";
import { allowedTicketScope, ticketInScope } from "@/lib/tickets/scope";
import { LeadDetail } from "@/components/leads/LeadDetail";
import type { Lead } from "@/lib/leads/types";
import type { LeadFollowUp } from "@/lib/leads/followups";
import type { Ticket, TicketItem } from "@/lib/tickets/types";
import { getAppSettings } from "@/lib/settings/appSettings";
import { notFound } from "next/navigation";
import { getActiveUsers } from "@/lib/users/directory";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: leadRaw } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!leadRaw) notFound();
  const lead = leadRaw as Lead;

  const agents = await getActiveUsers();

  const { data: followUpsRaw } = await supabase
    .from("lead_follow_ups")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  // Tags applied to this lead + the catalog. Both RLS-scoped on the user client
  // (leads.tags.view/manage) — they return [] for users without a tag perm.
  const { data: leadTagRows } = await supabase
    .from("lead_tag_links")
    .select("tag_id")
    .eq("lead_id", id);
  const leadTagIds = (leadTagRows ?? []).map((r) => r.tag_id as string);
  const { data: allTags } = await supabase
    .from("lead_tags")
    .select("id, name, color, owner_id")
    .order("name");

  const admin = createAdminClient();
  const settings = await getAppSettings();

  // Fetch this lead's tickets + their items via the admin client (mirrors
  // GET /api/leads/[id]/tickets) so the detail-page card is never RLS-scoped.
  const { data: ticketsRaw } = await admin
    .from("lead_tickets")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });
  const ticketRows = (ticketsRaw ?? []) as Ticket[];
  const ticketIds = ticketRows.map((t) => t.id);
  const itemsByTicket = new Map<string, TicketItem[]>();
  if (ticketIds.length) {
    const { data: items } = await admin
      .from("ticket_items")
      .select("*")
      .in("ticket_id", ticketIds)
      .order("sort");
    for (const item of (items ?? []) as TicketItem[]) {
      const list = itemsByTicket.get(item.ticket_id) ?? [];
      list.push(item);
      itemsByTicket.set(item.ticket_id, list);
    }
  }
  const tickets: Ticket[] = ticketRows.map((t) => ({ ...t, items: itemsByTicket.get(t.id) ?? [] }));

  // Resolve logger + closer names via the admin client so display_name is not RLS-nulled
  // for actors other than the viewer (covers no-longer-active profiles too).
  const userIds = Array.from(
    new Set([...(followUpsRaw ?? []).map((r) => r.user_id), lead.closed_by].filter(Boolean))
  ) as string[];
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
  }
  const followUps: LeadFollowUp[] = (followUpsRaw ?? []).map((r) => ({
    ...r,
    logger_name: r.user_id ? names.get(r.user_id) ?? null : null,
  }));
  const closedByName = lead.closed_by ? names.get(lead.closed_by) ?? null : null;

  // Current user + permissions for the "Closed by" edit allowance.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const perms = user ? await getUserPermissions(user.id) : new Set<string>();
  const canManageTags = perms.has("leads.tags.manage");
  const canViewTags = canManageTags || perms.has("leads.tags.view");

  // Ticket user-scoping for the Tickets card: without `tickets.view_all`,
  // only tickets the user created or tickets on leads assigned to them.
  let visibleTickets: Ticket[] = [];
  if (user) {
    const ticketScope = await allowedTicketScope(admin, user.id, perms);
    visibleTickets = tickets.filter((t) => ticketInScope(t, user.id, ticketScope));
  }

  // Closing-department members for the "Closed by" picker (two FKs to profiles → pin the FK).
  // Admin client: department_members RLS is "self or admin" — a user client would
  // return an empty list for regular users.
  const { data: closingDept } = await admin
    .from("departments")
    .select("id")
    .eq("slug", "closing")
    .single();
  let closingUsers: { id: string; display_name: string }[] = [];
  if (closingDept) {
    const { data: members } = await admin
      .from("department_members")
      .select("user_id, profiles!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", closingDept.id);
    closingUsers = (members ?? [])
      .map((m: any) => ({ id: m.profiles?.id, display_name: m.profiles?.display_name }))
      .filter((u: any) => u.id);
  }

  // A Sales-department member may edit Closed-by even without leads.edit.
  let isSalesMember = false;
  if (user) {
    const { data: salesDept } = await supabase
      .from("departments")
      .select("id")
      .eq("slug", "sales")
      .single();
    if (salesDept) {
      const { data: membership } = await admin
        .from("department_members")
        .select("user_id")
        .eq("department_id", salesDept.id)
        .eq("user_id", user.id)
        .maybeSingle();
      isSalesMember = !!membership;
    }
  }
  const canEditClosedBy = perms.has("leads.edit") || isSalesMember;
  // Agent / Closed by / Rating are administrative fields — only Admin-department
  // members may edit them (same definition the PATCH route enforces).
  const isAdmin = user ? await isAdminMember(admin, user.id) : false;

  const canSendContracts = perms.has("contracts.send");
  const canViewContracts = canSendContracts || perms.has("contracts.view");

  const { data: contractsRaw } = await admin
    .from("contracts")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });
  const leadContracts = (contractsRaw ?? []) as import("@/lib/contracts/types").ContractRow[];
  const hasContractSent = leadContracts.some((c) => c.status === "sent");

  const { data: verifiedMailboxes } = await admin
    .from("company_mailboxes")
    .select("id, email_address, display_name")
    .eq("status", "verified")
    .order("email_address");

  // Form Relay: this lead's endpoints + last 10 submissions (admin client;
  // the lead itself was already RLS-visible to this user).
  const canManageForms = perms.has("forms.manage");
  const canViewForms = canManageForms || perms.has("forms.view");
  let formEndpoints: FormEndpointRow[] = [];
  let formSubmissions: FormSubmissionRow[] = [];
  if (canViewForms) {
    const [{ data: eps }, { data: subs }] = await Promise.all([
      admin.from("form_endpoints").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
      admin.from("form_submissions").select("*").eq("lead_id", id).eq("is_spam", false).order("created_at", { ascending: false }).limit(10),
    ]);
    formEndpoints = (eps ?? []) as FormEndpointRow[];
    formSubmissions = (subs ?? []) as FormSubmissionRow[];
  }

  return (
    <LeadDetail
      lead={lead}
      agents={agents ?? []}
      followUps={followUps}
      closedByName={closedByName}
      closingUsers={closingUsers}
      canEditClosedBy={canEditClosedBy}
      isAdmin={isAdmin}
      tickets={visibleTickets}
      sla={settings.ticket_sla}
      allTags={allTags ?? []}
      leadTagIds={leadTagIds}
      canViewTags={canViewTags}
      canManageTags={canManageTags}
      currentUserId={user?.id ?? ""}
      canViewContracts={canViewContracts}
      canSendContracts={canSendContracts}
      contracts={leadContracts}
      hasContractSent={hasContractSent}
      verifiedMailboxes={verifiedMailboxes ?? []}
      canViewForms={canViewForms}
      canManageForms={canManageForms}
      formEndpoints={formEndpoints}
      formSubmissions={formSubmissions}
    />
  );
}
