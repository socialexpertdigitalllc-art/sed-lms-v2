import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { TOOLS, isToolId } from "@/lib/ai-tools/config";
import { getWgeConfig } from "@/lib/ai-tools/wge";
import { generateSchema } from "@/lib/ai-tools/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!isToolId(tool)) {
    return NextResponse.json({ error: "Unknown tool" }, { status: 404 });
  }
  const cfg = TOOLS[tool];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has(cfg.perm)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const wge = await getWgeConfig();

  const apiKey = process.env[cfg.envKey];
  if (!apiKey) {
    return NextResponse.json(
      { error: `${cfg.label} is not configured (missing ${cfg.envKey}).` },
      { status: 500 }
    );
  }

  const parsed = generateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { prompt, model, temperature } = parsed.data;
  const maxTokens = Math.min(parsed.data.maxTokens, cfg.maxOutputTokens);

  let upstream: Response;
  try {
    upstream = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        messages: [
          { role: "system", content: wge.system_prompt },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach ${cfg.label}: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    let msg = `HTTP ${upstream.status}`;
    try {
      const j = await upstream.json();
      msg = j?.error?.message || j?.message || msg;
    } catch {
      /* ignore */
    }
    return NextResponse.json({ error: msg }, { status: upstream.status || 502 });
  }

  // Re-emit only the assistant text deltas as a plain UTF-8 stream so the
  // client can append directly without parsing SSE.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const data = t.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const j = JSON.parse(data);
              const delta = j?.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              /* incomplete chunk; ignore */
            }
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
