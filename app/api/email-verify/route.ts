import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyEmail } from "@/lib/email-verify";

export const runtime = "nodejs";

/**
 * POST { email: string, remote?: boolean }
 *
 * Local checks (syntax, typo, lists, DNS) always run and are free. A paid
 * provider is only consulted when `remote` is true — and even then only on a
 * cache miss, so a given address is billed at most once.
 *
 * Auth-gated: any signed-in user. Nothing here ever logs a credential.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { email?: unknown; remote?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (email.length > 320) return NextResponse.json({ error: "email is too long" }, { status: 400 });

  const remote = body.remote === true;

  try {
    const result = await verifyEmail({ email, remote, userId: user.id });
    return NextResponse.json(result);
  } catch {
    // Deliberately opaque: an upstream error message could echo a request URL.
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
