"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Rocket, Database } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { Field, inputCls } from "@/components/forms/Field";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import type { WebsiteStats } from "@/lib/website-cms/types";
import { usePublishToast, type SaveOutcome } from "./shared";

function randomKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function SettingsPanel({
  initial,
  canManage,
}: {
  initial: { stats: WebsiteStats; revalidate_url: string; revalidate_secret: string; api_key: string };
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const publishToast = usePublishToast();
  const [stats, setStats] = useState<WebsiteStats>(initial.stats);
  const [revalidateUrl, setRevalidateUrl] = useState(initial.revalidate_url);
  const [revalidateSecret, setRevalidateSecret] = useState(initial.revalidate_secret);
  const [apiKey, setApiKey] = useState(initial.api_key);
  const [busy, setBusy] = useState<"save" | "publish" | "seed" | null>(null);

  async function save() {
    setBusy("save");
    const res = await fetch("/api/website/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stats,
        revalidate_url: revalidateUrl,
        revalidate_secret: revalidateSecret,
        api_key: apiKey,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    const outcome: SaveOutcome = res.ok
      ? { ok: true, publish: json.publish ?? null }
      : { ok: false, error: json.error ?? "Save failed." };
    publishToast(outcome, "Settings saved");
    if (outcome.ok) router.refresh();
  }

  async function publishAll() {
    setBusy("publish");
    const res = await fetch("/api/website/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      toast({ kind: "success", title: "Published", body: "The live site is re-rendering all content now." });
    } else {
      toast({ kind: "error", title: "Publish failed", body: json.error });
    }
  }

  async function seed() {
    setBusy("seed");
    const res = await fetch("/api/website/seed", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      const seeded = (json.seeded ?? []).join(", ") || "nothing (all tables already have rows)";
      toast({ kind: "success", title: "Seed finished", body: `Imported: ${seeded}` });
      router.refresh();
    } else {
      toast({ kind: "error", title: "Seed failed", body: json.error });
    }
  }

  const statField = (key: keyof WebsiteStats, label: string) => (
    <Field label={label}>
      <input
        className={inputCls}
        type="number"
        min={0}
        value={stats[key]}
        disabled={!canManage}
        onChange={(e) => setStats((s) => ({ ...s, [key]: Number(e.target.value) }))}
      />
    </Field>
  );

  return (
    <div className="space-y-5">
      <Panel
        title="Live stats"
        description="The counters on the website's home, about, portfolio and contact pages."
      >
        <div className="grid gap-4 sm:grid-cols-4">
          {statField("sitesLaunched", "Websites launched")}
          {statField("activeClients", "Active clients")}
          {statField("statesServed", "States served")}
          {statField("yearsActive", "Years active")}
        </div>
      </Panel>

      <Panel
        title="Publish hook"
        description="After every save the dashboard pings the website so pages re-render within seconds. The secret must match REVALIDATE_SECRET in the website's environment."
      >
        <div className="space-y-4">
          <Field label="Revalidate URL">
            <input
              className={inputCls}
              value={revalidateUrl}
              disabled={!canManage}
              onChange={(e) => setRevalidateUrl(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Revalidate secret" hint="Set the same value as REVALIDATE_SECRET on the website host">
              <div className="flex gap-2">
                <input
                  className={`${inputCls} font-mono`}
                  value={revalidateSecret}
                  disabled={!canManage}
                  onChange={(e) => setRevalidateSecret(e.target.value)}
                />
                {canManage && (
                  <button
                    type="button"
                    className={btnSecondary}
                    title="Generate a new secret"
                    onClick={() => setRevalidateSecret(randomKey())}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                )}
              </div>
            </Field>
            <Field label="Public API key" hint="The website sends this as x-sed-key; set it as DASHBOARD_API_KEY there. Empty = open reads.">
              <div className="flex gap-2">
                <input
                  className={`${inputCls} font-mono`}
                  value={apiKey}
                  disabled={!canManage}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                {canManage && (
                  <button
                    type="button"
                    className={btnSecondary}
                    title="Generate a new key"
                    onClick={() => setApiKey(randomKey())}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                )}
              </div>
            </Field>
          </div>
          {canManage && (
            <div className="flex justify-end">
              <button type="button" className={btnPrimary} disabled={busy === "save"} onClick={save}>
                {busy === "save" ? "Saving…" : "Save settings"}
              </button>
            </div>
          )}
        </div>
      </Panel>

      {canManage && (
        <Panel
          title="Actions"
          description="Publish re-renders every page of the live site from current CMS data. Seed imports the website's baked-in content into empty tables (safe to rerun)."
        >
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={busy === "publish"} onClick={publishAll}>
              <Rocket className="h-4 w-4" /> {busy === "publish" ? "Publishing…" : "Publish everything"}
            </button>
            <button type="button" className={btnSecondary} disabled={busy === "seed"} onClick={seed}>
              <Database className="h-4 w-4" /> {busy === "seed" ? "Seeding…" : "Seed from website snapshot"}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
