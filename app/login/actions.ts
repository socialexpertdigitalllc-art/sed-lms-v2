"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export type LoginState = { error: string } | null;

export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!identifier || !password) {
    return { error: "Enter your email or username and password" };
  }

  // Accept an email OR a username. Usernames are resolved to the email server-side.
  let email = identifier;
  if (!identifier.includes("@")) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("email")
      .eq("username", identifier.toLowerCase())
      .maybeSingle();
    if (!data?.email) return { error: "Invalid username or password" };
    email = data.email;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Invalid email/username or password" };

  try {
    const h = await headers();
    const ip =
      (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
    const ua = h.get("user-agent") ?? null;
    const uid = data?.user?.id;
    if (uid) {
      await createAdminClient().from("user_sessions").insert({ user_id: uid, ip, user_agent: ua });
    }
  } catch {
    // best-effort; never block login
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const admin = createAdminClient();
      const { data: open } = await admin
        .from("user_sessions")
        .select("id")
        .eq("user_id", user.id)
        .is("signed_out_at", null)
        .order("signed_in_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (open) {
        await admin
          .from("user_sessions")
          .update({ signed_out_at: new Date().toISOString(), end_reason: "logout" })
          .eq("id", open.id);
      }
    }
  } catch {
    // best-effort
  }

  await supabase.auth.signOut();
  redirect("/login");
}
