"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Loader2, Repeat, Smartphone, Trash2, Users } from "lucide-react";
import { btnGhostSm, btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { JSON_HEADERS } from "./useAssistantChat";

/**
 * The person's automations: reminders SED AI will send, standing rules it runs
 * for them, holiday handovers it will return, and the phones they can talk
 * to it from. All created by asking in Act mode; managed here.
 */

interface Reminder {
  id: string;
  text: string;
  remind_at: string;
  status: "pending" | "sent" | "cancelled";
  lead_id: string | null;
  target_url: string | null;
}
interface Rule {
  id: string;
  name: string;
  what: string;
  when: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResult: { ok?: boolean; summary?: string; error?: string } | null;
}
interface Handoff {
  id: string;
  from: string;
  to: string;
  count: number;
  endsAt: string;
  status: string;
  returned: number;
  error: string | null;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-accent">{icon}</span>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
      </div>
      <p className="text-xs text-text-faint">{hint}</p>
      {children}
    </section>
  );
}

export function Automations({ phone }: { phone?: React.ReactNode }) {
  const { toast } = useToast();
  const [data, setData] = useState<{ reminders: Reminder[]; rules: Rule[]; handoffs: Handoff[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant/automations", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { reminders?: Reminder[]; rules?: Rule[]; handoffs?: Handoff[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData({ reminders: body.reminders ?? [], rules: body.rules ?? [], handoffs: body.handoffs ?? [] });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/assistant/automations", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { reminders?: Reminder[]; rules?: Rule[]; handoffs?: Handoff[]; error?: string };
        if (!alive) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setData({ reminders: body.reminders ?? [], rules: body.rules ?? [], handoffs: body.handoffs ?? [] });
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function change(kind: "reminder" | "rule" | "handoff", id: string, action: string) {
    setBusy(`${kind}:${id}:${action}`);
    try {
      const res = await fetch(`/api/assistant/automations/${kind}/${id}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.message) toast({ kind: "success", title: body.message });
      await load();
    } catch (e) {
      toast({ kind: "error", title: "That did not work", body: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="py-10 text-center text-sm text-text-faint">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-text-faint">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
      </p>
    );
  }
  const pending = data.reminders.filter((r) => r.status === "pending");
  const spin = (key: string) => (busy === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null);
  const row = "flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm";

  return (
    <div className="space-y-8">
      <Section icon={<BellRing className="h-4 w-4" aria-hidden />} title="Reminders" hint="Ask in Act mode: “remind me tomorrow at 10 to call Jumbo's”. They arrive in your bell.">
        {pending.length ? (
          <ul className="space-y-1.5">
            {pending.map((r) => (
              <li key={r.id} className={row}>
                <span className="min-w-0 flex-1">
                  <span className="text-text">{r.text}</span>
                  <span className="block text-xs text-text-faint">
                    {when(r.remind_at)}
                    {r.target_url ? (
                      <>
                        {" · "}
                        <Link href={r.target_url} className="hover:text-text hover:underline">
                          open
                        </Link>
                      </>
                    ) : null}
                  </span>
                </span>
                <button type="button" className={btnGhostSm} disabled={busy !== null} onClick={() => void change("reminder", r.id, "cancel")}>
                  {spin(`reminder:${r.id}:cancel`)} Cancel
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No reminders waiting.</p>
        )}
      </Section>

      <Section icon={<Repeat className="h-4 w-4" aria-hidden />} title="Standing rules" hint="Ask in Act mode: “every morning tell me my overdue follow-ups” or “after 3 no-pickups move the lead to Long Term”. They run as you.">
        {data.rules.length ? (
          <ul className="space-y-1.5">
            {data.rules.map((r) => (
              <li key={r.id} className={cn(row, !r.enabled && "opacity-70")}>
                <span className="min-w-0 flex-1">
                  <span className="text-text">{r.what}</span>
                  <span className="block text-xs text-text-faint">
                    {r.when}
                    {r.enabled ? ` · next ${when(r.nextRunAt)}` : " · off"}
                    {r.lastResult ? ` · last: ${r.lastResult.ok === false ? `failed — ${r.lastResult.error}` : (r.lastResult.summary ?? "ran")}` : ""}
                  </span>
                </span>
                <button type="button" className={btnSecondarySm} disabled={busy !== null} onClick={() => void change("rule", r.id, r.enabled ? "disable" : "enable")}>
                  {spin(`rule:${r.id}:${r.enabled ? "disable" : "enable"}`)} {r.enabled ? "Turn off" : "Turn on"}
                </button>
                <button type="button" className={btnGhostSm} disabled={busy !== null} onClick={() => void change("rule", r.id, "delete")} aria-label={`Delete ${r.name}`}>
                  {spin(`rule:${r.id}:delete`) ?? <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No standing rules.</p>
        )}
      </Section>

      <Section icon={<Users className="h-4 w-4" aria-hidden />} title="Handovers" hint="Ask in Act mode: “give my leads to Sara until Monday”. They come back by themselves on the day.">
        {data.handoffs.length ? (
          <ul className="space-y-1.5">
            {data.handoffs.map((h) => (
              <li key={h.id} className={row}>
                <span className="min-w-0 flex-1">
                  <span className="text-text">
                    {h.count} lead{h.count === 1 ? "" : "s"}: {h.from} → {h.to}
                  </span>
                  <span className="block text-xs text-text-faint">
                    {h.status === "active"
                      ? `back ${when(h.endsAt)}`
                      : h.status === "returned"
                        ? `returned (${h.returned})`
                        : h.status === "failed"
                          ? `could not return: ${h.error ?? "error"}`
                          : "auto-return stopped"}
                  </span>
                </span>
                {h.status === "active" ? (
                  <>
                    <button type="button" className={btnSecondarySm} disabled={busy !== null} onClick={() => void change("handoff", h.id, "return")}>
                      {spin(`handoff:${h.id}:return`)} Return now
                    </button>
                    <button type="button" className={btnGhostSm} disabled={busy !== null} onClick={() => void change("handoff", h.id, "cancel")}>
                      {spin(`handoff:${h.id}:cancel`)} Don&apos;t return
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No handovers.</p>
        )}
      </Section>

      {phone ? (
        <Section icon={<Smartphone className="h-4 w-4" aria-hidden />} title="Phone" hint="Talk to SED AI from Telegram or WhatsApp — ask, or tell it what to do and reply YES to confirm.">
          {phone}
        </Section>
      ) : null}
    </div>
  );
}
