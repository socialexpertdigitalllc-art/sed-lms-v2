import { redirect } from "next/navigation";
import { requireWebsite } from "@/lib/website-cms/guard";
import { TestimonialsPanel } from "@/components/website-cms/TestimonialsPanel";
import type { WebsiteTestimonialRow } from "@/lib/website-cms/types";

export default async function WebsiteTestimonialsPage() {
  const auth = await requireWebsite("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const { data } = await auth.admin
    .from("website_testimonials")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return <TestimonialsPanel rows={(data ?? []) as WebsiteTestimonialRow[]} canManage={auth.canManage} />;
}
