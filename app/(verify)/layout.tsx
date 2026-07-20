import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Chrome-free shell for the installable verifier.
 *
 * Deliberately NOT the dashboard layout: no sidebar, no top bar, no providers
 * the mini-app doesn't need. An installed 400×600 window should look like a
 * purpose-built tool, not the app squeezed small. Auth still applies.
 */
export const metadata: Metadata = {
  title: "SED Email Verifier",
  description: "Check whether an email address will actually deliver.",
  applicationName: "SED Email Verifier",
  appleWebApp: { capable: true, title: "Verify", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0d9488",
  width: "device-width",
  initialScale: 1,
};

export default async function VerifyLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <div className="min-h-dvh bg-bg text-text">{children}</div>;
}
