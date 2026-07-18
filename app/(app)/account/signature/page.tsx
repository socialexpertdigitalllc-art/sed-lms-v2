import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignatureCard } from "@/components/account/SignatureCard";

export default async function SignaturePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data } = await admin.from("user_signatures").select("typed_name, signature_image_path").eq("user_id", user.id).maybeSingle();

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Signature</h1>
        <p className="text-sm text-text-muted mt-0.5">Your signature block for outgoing contracts.</p>
      </div>
      <SignatureCard initialTypedName={data?.typed_name ?? ""} hasImage={!!data?.signature_image_path} />
    </div>
  );
}
