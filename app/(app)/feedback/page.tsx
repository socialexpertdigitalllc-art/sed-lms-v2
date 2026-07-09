import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { FeedbackList } from "@/components/feedback/FeedbackList";
import type { Feedback } from "@/lib/feedback/types";

export default async function FeedbackPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("feedback.submit")) redirect("/dashboard");
  const canManage = perms.has("feedback.manage");

  const admin = createAdminClient();

  const { data: mineRaw } = await admin
    .from("feedback")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const mine = (mineRaw ?? []) as Feedback[];

  let all: Feedback[] = [];
  if (canManage) {
    const { data: allRaw } = await admin
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false });
    all = (allRaw ?? []) as Feedback[];

    // Submitter display names + short-lived signed screenshot URLs — resolved
    // via the admin client so they're never RLS-nulled/missing for a manager
    // viewing someone else's submission, and because the bucket is private.
    const userIds = Array.from(
      new Set(all.map((f) => f.user_id).filter((v): v is string => Boolean(v)))
    );
    const names = new Map<string, string | null>();
    if (userIds.length) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);
      for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
    }

    await Promise.all(
      all.map(async (f) => {
        f.user_name = (f.user_id ? names.get(f.user_id) : null) ?? undefined;
        if (f.screenshot_path) {
          const { data: signed } = await admin.storage
            .from("ticket-attachments")
            .createSignedUrl(f.screenshot_path, 3600);
          f.screenshot_url = signed?.signedUrl ?? undefined;
        }
      })
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Feedback</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Report a bug, request a feature, or share other feedback about the dashboard.
        </p>
      </div>

      <FeedbackForm />
      <FeedbackList title="Your submissions" items={mine} manage={false} />
      {canManage && <FeedbackList title="All feedback" items={all} manage />}
    </div>
  );
}
