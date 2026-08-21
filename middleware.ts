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
    // `_next/image` is deliberately NOT excluded. Once images.remotePatterns
    // allowlists public upload hosts (i.ibb.co, images.pexels.com ...), an
    // unauthenticated optimizer endpoint is a free image-transcoding proxy:
    // anyone could point it at arbitrary files on those hosts and spend our
    // sharp CPU and disk cache -- on a box that already hit a disk-IO budget.
    // The gate is a LOCAL JWT verification (no DB round-trip, see
    // lib/supabase/middleware.ts), and every consumer of the optimizer is an
    // authenticated in-app surface (SmartImage is imported only there), so
    // this costs one signature check per thumbnail and closes the abuse path.
    "/((?!_next/static|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|mjs|map|woff|woff2|ttf|otf|eot|txt|xml|mp4|webm)$).*)",
  ],
};
