import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getTeamAgentIds } from "@/lib/teams/closers";
import { getConversation, listConversations, listMemories, listMessages } from "@/lib/assistant/store";
import { describeScope } from "@/lib/assistant/prompt";
import { suggestionsFor } from "@/lib/assistant/suggestions";
import { isMissingTableError, MIGRATION_MESSAGE, UUID_RE } from "@/lib/assistant/http";
import { toClientConversation, toUiMessage, type ClientConversation, type UiMessage } from "@/lib/assistant/view";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/assistant/name";
import { isRunning } from "@/lib/assistant/runs";
import type { AssistantMemory } from "@/lib/assistant/types";
import { AssistantApp } from "@/components/assistant/AssistantApp";

export const metadata = { title: DEFAULT_ASSISTANT_NAME };

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-lg border border-border bg-surface p-8 text-center">
      <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent-ink">
        <Sparkles className="h-5 w-5" aria-hidden />
      </div>
      <h1 className="font-display text-lg font-semibold text-text">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{body}</p>
    </div>
  );
}

/**
 * The full Assistant page, opened from the header. The user's name for their
 * assistant, and the first-open naming step, come from AssistantProvider in
 * the app layout.
 */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("assistant.use")) {
    return (
      <Notice
        title={DEFAULT_ASSISTANT_NAME}
        body="Your account does not have access to the SED Assistant. Ask an admin to grant the “Use SED Assistant” permission."
      />
    );
  }

  const { c } = await searchParams;
  const admin = createAdminClient();

  let conversations: ClientConversation[] = [];
  let memories: AssistantMemory[] = [];
  let messages: UiMessage[] = [];
  let activeId: string | null = null;
  try {
    const [list, mem] = await Promise.all([listConversations(admin, user.id), listMemories(admin, user.id)]);
    conversations = list.map(toClientConversation);
    memories = mem;
    if (c && UUID_RE.test(c) && (await getConversation(admin, user.id, c))) {
      activeId = c;
      messages = (await listMessages(admin, user.id, c)).map(toUiMessage);
    }
  } catch (e) {
    if (isMissingTableError(e)) return <Notice title={`${DEFAULT_ASSISTANT_NAME} — almost ready`} body={MIGRATION_MESSAGE} />;
    throw e;
  }

  const teamIds = await getTeamAgentIds(admin, user.id).catch(() => [] as string[]);

  return (
    <AssistantApp
      scope={describeScope({ perms, teamSize: teamIds.length })}
      suggestions={suggestionsFor(perms)}
      initialConversations={conversations}
      initialMemories={memories}
      initialConversationId={activeId}
      initialMessages={messages}
      initialRunning={activeId ? isRunning(activeId) : false}
    />
  );
}
