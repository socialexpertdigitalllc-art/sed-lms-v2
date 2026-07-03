import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountForm } from "@/components/account/AccountForm";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, username, display_name, full_name")
    .eq("id", user.id)
    .single();

  return (
    <div>
      <h1 className="text-xl font-semibold text-text mb-1">My account</h1>
      <p className="text-sm text-text-muted mb-5">Manage your profile and password.</p>
      <AccountForm
        email={profile?.email ?? user.email ?? ""}
        username={profile?.username ?? ""}
        displayName={profile?.display_name ?? ""}
        fullName={profile?.full_name ?? ""}
      />
    </div>
  );
}
