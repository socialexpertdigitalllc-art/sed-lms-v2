import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter, JetBrains_Mono, Bricolage_Grotesque } from "next/font/google";
import { getAppSettings, getBranding } from "@/lib/settings/appSettings";
import { THEME_COOKIE, isThemeChoice, themeAttr } from "@/lib/theme";
import Script from "next/script";
import { applyServerTimezone, companyTimeScript } from "@/lib/time/companyTime";
import { companyTimezone } from "@/lib/analytics/dateScope";
import { ServerClockSync } from "@/components/time/ServerClockSync";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { companyName } = await getBranding();
  return {
    title: companyName,
    description: "Social Expert Digital — Lead Management System",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The theme is stamped on the SERVER from the cookie, so the first painted
  // frame is already in the right theme — no inline script, no flash, and it
  // works on every page including /login and the marketing site. An absent
  // cookie means "system", which leaves the attribute off entirely and lets
  // the stylesheet's prefers-color-scheme branch decide (see lib/theme.ts).
  const cookieTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = themeAttr(isThemeChoice(cookieTheme) ? cookieTheme : "system");
  // The company timezone (Settings; Pacific time): every page and this server
  // process run on it (lib/time/companyTime.ts). Cached 60s; a typo falls back.
  const timeZone = companyTimezone(await getAppSettings().then((s) => s.work_timezone).catch(() => null));
  applyServerTimezone(timeZone);

  return (
    <html
      lang="en"
      data-theme={theme ?? undefined}
      className={`${inter.variable} ${jetbrainsMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="min-h-full" suppressHydrationWarning>
        {/* The whole LMS runs on the company timezone and the server's clock,
            whatever the device says (lib/time/companyTime.ts). Runs before any
            app code; stamped with the server's time on every page load. */}
        <Script id="company-time" strategy="beforeInteractive">
          {/* eslint-disable-next-line react-hooks/purity -- a server component rendered per request (cookies above): the page MUST carry the server's time now */}
          {companyTimeScript(Date.now(), timeZone)}
        </Script>
        <ServerClockSync />
        {children}
      </body>
    </html>
  );
}
