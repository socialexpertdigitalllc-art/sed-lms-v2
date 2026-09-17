import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter, JetBrains_Mono, Bricolage_Grotesque } from "next/font/google";
import { getBranding } from "@/lib/settings/appSettings";
import { THEME_COOKIE, isThemeChoice, themeAttr } from "@/lib/theme";
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

  return (
    <html
      lang="en"
      data-theme={theme ?? undefined}
      className={`${inter.variable} ${jetbrainsMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="min-h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
