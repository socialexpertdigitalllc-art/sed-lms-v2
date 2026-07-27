import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { assignmentError, getProvider, getTask } from "@/lib/ai-tools/providers/registry";
import { clearAiTaskAssignment, saveAiProvider, saveAiTaskAssignment } from "@/lib/ai-tools/providers/config";
import { listAiRoutingSettings } from "@/lib/ai-tools/providers/adminView";
import { clearTaskModelCache } from "@/lib/ai-tools/providers/run";

export const runtime = "nodejs";

/**
 * AI provider credentials and per-task model routing.
 *
 * NOTHING in this file may return a credential — not the plaintext, not the
 * ciphertext. The client gets the registry descriptor (which fields to render,
 * which models a task may use), `configured`, a masked hint, and enabled state.
 */

async function guard(): Promise<{ userId: string } | { error: 401 | 403 }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  return NextResponse.json(await listAiRoutingSettings());
}

const providerSchema = z.object({
  kind: z.literal("provider"),
  provider_key: z.string().trim().min(1).max(64),
  enabled: z.boolean().optional(),
  /** Omit to keep what is stored; null clears it. */
  credentials: z.record(z.string(), z.string().max(500)).nullish(),
});

const assignmentSchema = z.object({
  kind: z.literal("assignment"),
  task_key: z.string().trim().min(1).max(64),
  /** null on both = reset this task to its registry default. */
  provider_key: z.string().trim().min(1).max(64).nullable(),
  model: z.string().trim().min(1).max(128).nullable(),
  /**
   * Output-token budget for this task. Omit or null = the model's
   * vendor-recommended default. NOT range-checked here on purpose: the
   * allowed range is per-model, so `saveAiTaskAssignment` clamps it against
   * the model actually being assigned rather than this schema guessing.
   */
  max_output_tokens: z.number().int().positive().nullish(),
});

const putSchema = z.discriminatedUnion("kind", [providerSchema, assignmentSchema]);

export async function PUT(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  if (parsed.data.kind === "provider") {
    const descriptor = getProvider(parsed.data.provider_key);
    if (!descriptor) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

    // Only fields the descriptor declares may be stored — no smuggling extras in.
    let credentials: Record<string, string> | null | undefined;
    if (parsed.data.credentials === null) credentials = null;
    else if (parsed.data.credentials !== undefined) {
      credentials = {};
      for (const field of descriptor.credentialFields) {
        const v = parsed.data.credentials[field.key];
        if (typeof v === "string" && v.trim()) credentials[field.key] = v.trim();
      }
    }

    try {
      const provider = await saveAiProvider(parsed.data.provider_key, {
        enabled: parsed.data.enabled,
        credentials,
        updatedBy: auth.userId,
      });
      clearTaskModelCache();
      return NextResponse.json({ provider });
    } catch {
      // Deliberately opaque — an upstream error could echo the payload.
      return NextResponse.json({ error: "Could not save provider settings" }, { status: 500 });
    }
  }

  const task = getTask(parsed.data.task_key);
  if (!task) return NextResponse.json({ error: "Unknown task" }, { status: 404 });
  if (!task.routable) {
    return NextResponse.json(
      { error: `${task.label} picks its model per generation, so it cannot be assigned here.` },
      { status: 422 },
    );
  }

  try {
    if (parsed.data.provider_key === null || parsed.data.model === null) {
      await clearAiTaskAssignment(parsed.data.task_key);
      clearTaskModelCache();
      return NextResponse.json({ assignment: null });
    }

    // THE capability gate. The UI never offers an impossible pairing, but a
    // hand-rolled request must be refused with the reason — a text-only model
    // on the image task would answer about photos it never saw.
    const reason = assignmentError(parsed.data.task_key, parsed.data.provider_key, parsed.data.model);
    if (reason) return NextResponse.json({ error: reason }, { status: 422 });

    const assignment = await saveAiTaskAssignment(
      parsed.data.task_key,
      parsed.data.provider_key,
      parsed.data.model,
      auth.userId,
      parsed.data.max_output_tokens ?? null,
    );
    clearTaskModelCache();
    return NextResponse.json({ assignment });
  } catch {
    return NextResponse.json({ error: "Could not save the task assignment" }, { status: 500 });
  }
}
