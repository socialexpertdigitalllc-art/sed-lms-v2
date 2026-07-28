import { createAdminClient } from "@/lib/supabase/admin";

/** Capture state and candidate photos for a lead. SERVER ONLY (service role). */

export type CaptureStatus = "pending" | "ready" | "none_found" | "failed";
/** `uploading` is a CLAIM state — see `claimCandidate` below. */
export type CandidateStatus = "pending" | "uploading" | "uploaded" | "failed" | "skipped";

export type Candidate = {
  id: string;
  photoKey: string;
  thumbUrl: string;
  sourceUrl: string;
  status: CandidateStatus;
  hostedUrl: string | null;
  error: string | null;
};

export type CaptureState = {
  status: CaptureStatus;
  /** The profile link this capture was for; null on rows written before it was tracked. */
  profileLink: string | null;
  foundCount: number;
  error: string | null;
  requestedAt: string;
  completedAt: string | null;
} | null;

export type HarvestedPhoto = { key: string; thumbUrl: string; sourceUrl: string };

export async function getCapture(leadId: string): Promise<{ capture: CaptureState; candidates: Candidate[] }> {
  const admin = createAdminClient();

  const { data: cap, error: capError } = await admin
    .from("lead_photo_captures")
    .select("status, profile_link, found_count, error, requested_at, completed_at")
    .eq("lead_id", leadId)
    .maybeSingle();
  // A discarded error here is indistinguishable from "no capture yet" — which
  // is exactly what an unapplied migration looks like. Throw so the route can
  // tell the two apart.
  if (capError) throw new Error(capError.message);

  const { data: rows, error: rowsError } = await admin
    .from("lead_photo_candidates")
    .select("id, photo_key, thumb_url, source_url, status, hosted_url, error")
    .eq("lead_id", leadId)
    .order("created_at");
  if (rowsError) throw new Error(rowsError.message);

  return {
    capture: cap
      ? {
          status: cap.status as CaptureStatus,
          profileLink: (cap.profile_link as string | null) ?? null,
          foundCount: cap.found_count as number,
          error: (cap.error as string | null) ?? null,
          requestedAt: cap.requested_at as string,
          completedAt: (cap.completed_at as string | null) ?? null,
        }
      : null,
    candidates: (rows ?? []).map((r) => ({
      id: r.id as string,
      photoKey: r.photo_key as string,
      thumbUrl: r.thumb_url as string,
      sourceUrl: r.source_url as string,
      status: r.status as CandidateStatus,
      hostedUrl: (r.hosted_url as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    })),
  };
}

/** Mark a capture as started. Called when the page dispatches to the extension. */
export async function startCapture(leadId: string, userId: string, profileLink: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("lead_photo_captures").upsert(
    {
      lead_id: leadId,
      status: "pending",
      profile_link: profileLink,
      error: null,
      requested_by: userId,
      requested_at: new Date().toISOString(),
      completed_at: null,
    },
    { onConflict: "lead_id" }
  );
  if (error) throw new Error(error.message);
}

/**
 * Record what the extension harvested. Idempotent per (lead_id, photo_key), so
 * a re-capture keeps an already-uploaded photo's hosted URL rather than
 * resetting it and paying for the upload twice.
 */
export async function saveHarvest(
  leadId: string,
  photos: HarvestedPhoto[],
  meta: { extensionVersion: string | null; profileLink: string }
): Promise<{ status: CaptureStatus; found: number }> {
  const admin = createAdminClient();
  const status: CaptureStatus = photos.length > 0 ? "ready" : "none_found";

  if (photos.length > 0) {
    const { error } = await admin.from("lead_photo_candidates").upsert(
      photos.map((p) => ({
        lead_id: leadId,
        photo_key: p.key,
        thumb_url: p.thumbUrl,
        source_url: p.sourceUrl,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "lead_id,photo_key", ignoreDuplicates: true }
    );
    if (error) throw new Error(error.message);
  }

  const { error: captureError } = await admin.from("lead_photo_captures").upsert(
    {
      lead_id: leadId,
      status,
      profile_link: meta.profileLink,
      found_count: photos.length,
      error: null,
      extension_version: meta.extensionVersion,
      completed_at: new Date().toISOString(),
    },
    { onConflict: "lead_id" }
  );
  if (captureError) throw new Error(captureError.message);

  return { status, found: photos.length };
}

export async function failCapture(leadId: string, message: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("lead_photo_captures").upsert(
    { lead_id: leadId, status: "failed", error: message.slice(0, 500), completed_at: new Date().toISOString() },
    { onConflict: "lead_id" }
  );
  if (error) throw new Error(error.message);
}

/**
 * Atomically claim a candidate for upload. Returns false when someone else got
 * there first.
 *
 * WHY THIS EXISTS. Two operators can have the same lead open. Without a claim,
 * both upload requests read the same candidate as `pending`, both push it
 * through the host chain, and both spend quota on hosts we deliberately model
 * as scarce — then the second write silently overwrites the first. The
 * conditional update is the whole guard: exactly one caller can move a row out
 * of `pending`.
 */
export async function claimCandidate(candidateId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_photo_candidates")
    .update({ status: "uploading", updated_at: new Date().toISOString() })
    .eq("id", candidateId)
    .eq("status", "pending")
    .select("id");
  // A genuine error (bad connection, missing table, etc.) is NOT the same
  // thing as losing the claim race — that must throw, not silently read as
  // "someone else got there first".
  if (error) throw new Error(error.message);
  // No error, but zero rows matched: the conditional `where status = pending`
  // simply matched nothing (already claimed, already uploaded, or gone).
  // That is a normal, expected outcome — return false, don't throw.
  return (data?.length ?? 0) === 1;
}

/** Hand a claim back when the upload failed before it started. */
export async function releaseCandidate(candidateId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("lead_photo_candidates")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("id", candidateId)
    .eq("status", "uploading");
  if (error) throw new Error(error.message);
}

export async function markCandidateUploaded(
  candidateId: string,
  hostedUrl: string,
  provider: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("lead_photo_candidates")
    .update({ status: "uploaded", hosted_url: hostedUrl, host_provider: provider, error: null, updated_at: new Date().toISOString() })
    .eq("id", candidateId);
  if (error) throw new Error(error.message);
}

export async function markCandidateFailed(candidateId: string, message: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("lead_photo_candidates")
    .update({ status: "failed", error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("id", candidateId);
  if (error) throw new Error(error.message);
}
