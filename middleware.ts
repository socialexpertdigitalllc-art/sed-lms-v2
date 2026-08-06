import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything static is excluded here so it never reaches the auth gate.
    // The previous pattern only skipped images, so fonts, scripts, stylesheets,
    // source maps, the service worker and the manifest each ran a full session
    // check — multiplying one page view into many auth calls for files that
    // carry nothing user-specific. Page and API routes still match; RSC
    // prefetches deliberately still match, since they return real page content.
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|mjs|map|woff|woff2|ttf|otf|eot|txt|xml|mp4|webm)$).*)",
  ],
};
