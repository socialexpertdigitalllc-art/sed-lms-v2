import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { isAdminMember } from "@/lib/permissions/isAdminMember";
import { allowedTicketScope, ticketInScope } from "@/lib/tickets/scope";
import { LeadDetail } from "@/components/leads/LeadDetail";
import { LeadLiveRefresh } from "@/components/leads/LeadLiveRefresh";
import type { Lead } from "@/lib/leads/types";
import type { LeadFollowUp } from "@/lib/leads/followups";
import type { Ticket, TicketItem } from "@/lib/tickets/types";
import { getAppSettings } from "@/lib/settings/appSettings";
import { loadStatusHistory } from "@/lib/leads/statusHistoryLoad";
import { notFound } from "next/navigation";
import { getActiveUsers } from "@/lib/users/directory";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";
import { domainForLead, suggestQuery } from "@/lib/domains/service";
import { leadExactDomain, loadLeadDomainCheck } from "@/lib/domains/leadCheck";
import { registrarSandbox } from "@/lib/cloudflare/client";
import { receiptSenderAddress } from "@/lib/receipts/settings";
import { cmsOpenReady } from "@/lib/sedcms/cms";
import type { ReceiptRow } from "@/lib/receipts/types";

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ receipt?: string }>;
}) {
  const { id } = await params;
  const { receipt: receiptParam } = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();

  // Every read below runs in parallel. This page used to make ~27 database
  // round trips ONE AFTER ANOTHER, so opening a lead waited for all of them in
  // a row; now it is three short steps: the lead and the viewer, their
  // (cached) permissions, then everything else at once.
  const [{ data: leadRaw }, { data: { user } }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).is("deleted_at", null).single(),
    supabase.auth.getUser(),
  ]);
  if (!leadRaw) notFound();
  const lead = leadRaw as Lead;
  const perms = user ? await getUserPermissions(user.id) : new Set<string>();

  const canManageTags = perms.has("leads.tags.manage");
  const canViewTags = canManageTags || perms.has("leads.tags.view");
  const canSendContracts = perms.has("contracts.send");
  const canViewContracts = canSendContracts || perms.has("contracts.view");
  const canManageForms = perms.has("forms.manage");
  const canViewForms = canManageForms || perms.has("forms.view");
  const canPurchaseDomains = perms.has("domains.purchase");
  const canManageDomains = perms.has("domains.manage");
  const canSeeDomain = canPurchaseDomains || canManageDomains || perms.has("domains.view");
  const canSendReceipts = perms.has("receipts.send");

  // Follow-ups, with the logger and closer names resolved via the admin client
  // so display_name is not RLS-nulled for actors other than the viewer.
  const followUpsP = (async () => {
    const { data: followUpsRaw } = await supabase
      .from("lead_follow_ups")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false });
    const userIds = Array.from(
      new Set([...(followUpsRaw ?? []).map((r) => r.user_id), lead.closed_by].filter(Boolean)),
    ) as string[];
    const names = new Map<string, string | null>();
    if (userIds.length) {
      const { data: profiles } = await admin.from("profiles").select("id, display_name").in("id", userIds);
      for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
    }
    const followUps: LeadFollowUp[] = (followUpsRaw ?? []).map((r) => ({
      ...r,
      logger_name: r.user_id ? names.get(r.user_id) ?? null : null,
    }));
    return { followUps, closedByName: lead.closed_by ? names.get(lead.closed_by) ?? null : null };
  })();

  // This lead's tickets + their items via the admin client (mirrors
  // GET /api/leads/[id]/tickets), then the viewer's ticket scope: without
  // `tickets.view_all`, only tickets they created or on leads assigned to them.
  const ticketsP = (async () => {
    const [{ data: ticketsRaw }, ticketScope] = await Promise.all([
      admin.from("lead_tickets").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
      user ? allowedTicketScope(admin, user.id, perms) : Promise.resolve(null),
    ]);
    const ticketRows = (ticketsRaw ?? []) as Ticket[];
    const ticketIds = ticketRows.map((t) => t.id);
    const itemsByTicket = new Map<string, TicketItem[]>();
    if (ticketIds.length) {
      const { data: items } = await admin.from("ticket_items").select("*").in("ticket_id", ticketIds).order("sort");
      for (const item of (items ?? []) as TicketItem[]) {
        const list = itemsByTicket.get(item.ticket_id) ?? [];
        list.push(item);
        itemsByTicket.set(item.ticket_id, list);
      }
    }
    const tickets: Ticket[] = ticketRows.map((t) => ({ ...t, items: itemsByTicket.get(t.id) ?? [] }));
    return user && ticketScope ? tickets.filter((t) => ticketInScope(t, user.id, ticketScope)) : [];
  })();

  // Closing-department members for the "Closed by" picker (two FKs to profiles → pin the FK).
  // Admin client: department_members RLS is "self or admin" — a user client would
  // return an empty list for regular users.
  type MemberRow = { profiles: { id: string; display_name: string | null } | null };
  const closingUsersP = (async () => {
    const { data: closingDept } = await admin.from("departments").select("id").eq("slug", "closing").single();
    if (!closingDept) return [] as { id: string; display_name: string }[];
    const { data: members } = await admin
      .from("department_members")
      .select("user_id, profiles!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", closingDept.id);
    return ((members ?? []) as unknown as MemberRow[])
      .map((m) => ({ id: m.profiles?.id ?? "", display_name: m.profiles?.display_name ?? "" }))
      .filter((u) => u.id);
  })();

  // A Sales-department member may edit Closed-by even without leads.edit.
  const isSalesMemberP = (async () => {
    if (!user) return false;
    const { data: salesDept } = await supabase.from("departments").select("id").eq("slug", "sales").single();
    if (!salesDept) return false;
    const { data: membership } = await admin
      .from("department_members")
      .select("user_id")
      .eq("department_id", salesDept.id)
      .eq("user_id", user.id)
      .maybeSingle();
    return !!membership;
  })();

  const [
    agents,
    { followUps, closedByName },
    { data: leadTagRows },
    { data: allTags },
    settings,
    statusHistory,
    visibleTickets,
    closingUsers,
    isSalesMember,
    // Agent / Closed by / Rating are administrative fields — only Admin-department
    // members may edit them (same definition the PATCH route enforces).
    isAdmin,
    { data: contractsRaw },
    { data: verifiedMailboxes },
    forms,
    domainRow,
    exactCheck,
    receiptData,
    cmsReady,
  ] = await Promise.all([
    getActiveUsers(),
    followUpsP,
    // Tags applied to this lead + the catalog. Both RLS-scoped on the user client
    // (leads.tags.view/manage) — they return [] for users without a tag perm.
    supabase.from("lead_tag_links").select("tag_id").eq("lead_id", id),
    supabase.from("lead_tags").select("id, name, color, owner_id").order("name"),
    getAppSettings(),
    // The status ledger is service-role only; the lead itself was already
    // RLS-visible to this user above.
    loadStatusHistory(admin, lead),
    ticketsP,
    closingUsersP,
    isSalesMemberP,
    user ? isAdminMember(admin, user.id) : Promise.resolve(false),
    admin.from("contracts").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    admin.from("company_mailboxes").select("id, email_address, display_name").eq("status", "verified").order("email_address"),
    // Form Relay: this lead's endpoints + last 10 submissions (admin client;
    // the lead itself was already RLS-visible to this user).
    canViewForms
      ? Promise.all([
          admin.from("form_endpoints").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
          admin.from("form_submissions").select("*").eq("lead_id", id).eq("is_spam", false).order("created_at", { ascending: false }).limit(10),
        ])
      : Promise.resolve(null),
    // Client domain: buy / link one and watch it get connected (lib/domains).
    canSeeDomain ? domainForLead(admin, id) : Promise.resolve(null),
    canSeeDomain ? loadLeadDomainCheck(admin, id) : Promise.resolve(null),
    // Payment receipts. Before migration 0085 nobody holds receipts.send, and a
    // missing table just reads as "no receipts".
    canSendReceipts
      ? Promise.all([
          admin.from("lead_receipts").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
          receiptSenderAddress(),
        ])
      : Promise.resolve(null),
    // "Open in CMS" shows only once SED CMS is connected and set up (migration
    // 0096), asked only for someone who could see it.
    (perms.has("tickets.resolve") || perms.has("studio.manage")) && Boolean(lead.website_link)
      ? cmsOpenReady(admin)
      : Promise.resolve(false),
  ]);

  const leadTagIds = (leadTagRows ?? []).map((r) => r.tag_id as string);
  const canEditClosedBy = perms.has("leads.edit") || isSalesMember;
  const leadContracts = (contractsRaw ?? []) as import("@/lib/contracts/types").ContractRow[];
  const hasContractSent = leadContracts.some((c) => c.status === "sent");
  const formEndpoints = (forms?.[0].data ?? []) as FormEndpointRow[];
  const formSubmissions = (forms?.[1].data ?? []) as FormSubmissionRow[];
  const domainCard = canSeeDomain
    ? {
        row: domainRow,
        exactDomain: leadExactDomain(lead.business_name),
        exactCheck,
        canPurchase: canPurchaseDomains,
        canManage: canManageDomains,
        sandbox: registrarSandbox(),
        suggestedQuery: suggestQuery(lead.business_name ?? null, lead.website_link ?? null),
      }
    : null;
  const receipts = (receiptData?.[0].data ?? []) as ReceiptRow[];
  const receiptSender = receiptData ? receiptData[1] : null;

  return (
    <>
    {/* Someone else changes this lead → the page refreshes itself. */}
    <LeadLiveRefresh leadId={lead.id} updatedAt={lead.updated_at} tagIds={leadTagIds} ticketIds={visibleTickets.map((t) => t.id)} />
    <LeadDetail
      lead={lead}
      statusHistory={statusHistory}
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
      domainCard={domainCard}
      canSendReceipts={canSendReceipts}
      receipts={receipts}
      receiptSender={receiptSender}
      openReceiptOnLoad={receiptParam === "new"}
      cmsReady={cmsReady}
    />
    </>
  );
}
