import { getBranding } from "@/lib/settings/appSettings";
import { LoginForm } from "./LoginForm";

// Branding is admin-editable at any time (company name / logo); without this,
// getBranding() (no cookies()/headers() touch) lets Next statically prerender
// this page at build time, freezing the brand shown here until the next deploy.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const branding = await getBranding();
  return <LoginForm branding={branding} />;
}
