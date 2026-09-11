"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Inbox as InboxIcon, Search } from "lucide-react";
import { Panel, EmptyPanel } from "@/components/common/Panel";
import { Select } from "@/components/common/Select";
import { btnSecondarySm } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { formatRelative } from "@/lib/leads/format";
import { previewLine } from "@/lib/forms/email";
import { DeliveryPill } from "@/components/form-relay/DeliveryPill";
import { SubmissionDrawer } from "@/components/form-relay/SubmissionDrawer";
import type { SubmissionListItem } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

type EndpointOption = { id: string; name: string };

export function SubmissionsInbox({ endpoints, canManage }: { endpoints: EndpointOption[]; canManage: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [rows, setRows] = useState<SubmissionListItem[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [endpoint, setEndpoint] = useState("");
  const [spam, setSpam] = useState("0");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(params.get("submission"));

  // No synchronous setLoading here: load() runs from an effect, and a sync
  // setState there cascades renders (react-hooks/set-state-in-effect).
  // `loading` starts true and event handlers set it before calling load.
  const load = useCallback(async (before?: string) => {
    const p = new URLSearchParams();
    if (endpoint) p.set("endpoint", endpoint);
    if (spam) p.set("spam", spam);
    if (status) p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    if (before) p.set("before", before);
    try {
      const res = await fetch(`/api/forms/submissions?${p}`);
      const body = res.ok ? await res.json() : { submissions: [], next_before: null };
      setRows((prev) => (before ? [...prev, ...body.submissions] : body.submissions));
      setNextBefore(body.next_before);
    } catch {
      /* offline etc. — keep whatever is shown; finally re-enables Load more */
    } finally {
      setLoading(false);
    }
  }, [endpoint, spam, status, q]);

  useEffect(() => {
    // IIFE so every setState happens in the async continuation, never in the
    // synchronous effect body (repo pattern — see hooks/useNavCounts.ts).
    void (async () => { await load(); })();
  }, [load]);

  // Live inbox: a submission landing while this tab is open appears without a
  // reload. postgres_changes on form_submissions (policy + publication:
  // migration 0076) is only a POKE — rows still come through the API above,
  // which enforces the caller's scope. The ref keeps the subscription stable
  // across filter changes instead of resubscribing per keystroke.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase.channel("rt-form-submissions");

    // RLS-gated postgres_changes require the realtime socket to carry the
    // user's JWT (see hooks/useRealtimeRefresh.ts).
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "form_submissions" }, () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => void loadRef.current(), 400);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, []);

  // The bell links to /forms?submission=<id>; that row may be outside the
  // current filters, so it is fetched on its own when not in the list.
  const open = rows.find((r) => r.id === openId) ?? null;
  useEffect(() => {
    if (!openId || open) return;
    void (async () => {
      const res = await fetch(`/api/forms/submissions?spam=&q=&status=`);
      if (!res.ok) return;
      const body = await res.json();
      const hit = (body.submissions as SubmissionListItem[]).find((r) => r.id === openId);
      if (hit) setRows((prev) => (prev.some((r) => r.id === hit.id) ? prev : [hit, ...prev]));
    })();
  }, [openId, open]);

  async function openRow(r: SubmissionListItem) {
    setOpenId(r.id);
    if (!r.read_at) {
      await fetch(`/api/forms/submissions/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: true }) });
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, read_at: new Date().toISOString() } : x)));
      router.refresh(); // nav badge
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className={cn(inputCls, "w-auto")}>
          <option value="">All endpoints</option>
          {endpoints.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Select value={spam} onChange={(e) => setSpam(e.target.value)} className={cn(inputCls, "w-auto")}>
          <option value="0">Not spam</option>
          <option value="1">Spam</option>
          <option value="">All</option>
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(inputCls, "w-auto")}>
          <option value="">Any delivery</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </Select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject or sender" className={cn(inputCls, "w-64 pl-8")} />
        </div>
      </div>

      <Panel flush>
        {rows.length === 0 && !loading ? (
          <EmptyPanel icon={InboxIcon} title="No submissions" hint="Submissions from your client sites will appear here." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Endpoint / lead</th>
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Delivery</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => openRow(r)} className={cn("cursor-pointer border-t border-border-subtle hover:bg-surface-2", !r.read_at && "font-semibold")}>
                  <td className="whitespace-nowrap px-4 py-2 text-text-muted">{formatRelative(r.created_at)}</td>
                  <td className="px-4 py-2"><div className="text-text">{r.endpoint_name ?? "—"}</div><div className="text-xs font-normal text-text-muted">{r.lead_name ?? ""}</div></td>
                  <td className="px-4 py-2"><div className="text-text">{r.submitter_name ?? "—"}</div><div className="text-xs font-normal text-text-muted">{r.submitter_email ?? ""}</div></td>
                  <td className="max-w-md px-4 py-2"><div className="truncate text-text">{r.subject || "(no subject)"}</div><div className="truncate text-xs font-normal text-text-muted">{previewLine(r.payload, 90)}</div></td>
                  <td className="px-4 py-2"><DeliveryPill status={r.delivery_status} spam={r.is_spam} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {nextBefore ? (
          <div className="border-t border-border p-3 text-center">
            <button type="button" className={btnSecondarySm} disabled={loading} onClick={() => { setLoading(true); void load(nextBefore); }}>Load more</button>
          </div>
        ) : null}
      </Panel>

      {open ? (
        <SubmissionDrawer
          submission={open}
          canManage={canManage}
          onClose={() => { setOpenId(null); if (params.get("submission")) router.replace("/forms"); }}
          onChanged={() => void load()}
        />
      ) : null}
    </>
  );
}
