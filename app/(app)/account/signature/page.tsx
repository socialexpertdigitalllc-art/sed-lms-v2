import { redirect } from "next/navigation";
import { BackLink } from "@/components/common/BackLink";
import { PageHeader } from "@/components/common/Panel";
import { btnSecondary } from "@/components/common/buttons";
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
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader
        title="Signature"
        description="Your signature block for outgoing contracts."
        action={<BackLink href="/account" label="Account" className={btnSecondary} />}
      />
      <SignatureCard initialTypedName={data?.typed_name ?? ""} hasImage={!!data?.signature_image_path} />
    </div>
  );
}
