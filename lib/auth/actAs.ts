import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { actingSession } from "@/lib/supabase/server";

/**
 * Do work AS a person, outside their browser — for SED AI messages that arrive
 * on Telegram or WhatsApp, where there is no cookie to sign in with.
 *
 * A short-lived session is minted for them with the service role (a one-time
 * sign-in token, redeemed on the spot — no email is sent), the work runs with
 * that session (see `actingSession`: every createClient() inside it is their
 * own RLS client, so the app's endpoints, permission checks and row-level
 * security apply exactly as when they use the app), and the session is
 * signed out again afterwards.
 *
 * A deactivated (banned) account cannot be signed in this way either: the
 * token redemption fails, and so does the work.
 *
 * SERVER ONLY. Callers must already have established that this person asked
 * for the work — e.g. a message from the phone they linked themselves.
 */

export class ActAsError extends Error {}

async function mintSession(userId: string): Promise<{ accessToken: string }> {
  const admin = createAdminClient();
  const { data: found, error: findError } = await admin.auth.admin.getUserById(userId);
  const email = found?.user?.email;
  if (findError || !email) throw new ActAsError("That account could not be found.");
  if (found.user.banned_until && Date.parse(found.user.banned_until) > Date.now()) {
    throw new ActAsError("That account is deactivated.");
  }
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new ActAsError("Could not sign in for that account.");

  const anon = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let { data, error } = await anon.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error || !data.session) ({ data, error } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash }));
  const session = data?.session;
  if (error || !session || session.user.id !== userId) throw new ActAsError("Could not sign in for that account.");
  return { accessToken: session.access_token };
}

/** Run `fn` signed in as `userId`. */
export async function actAs<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const { accessToken } = await mintSession(userId);
  try {
    return await actingSession.run({ accessToken, userId }, fn);
  } finally {
    // Only this session — the person stays signed in everywhere else.
    await createAdminClient().auth.admin.signOut(accessToken, "local").catch(() => {});
  }
}
