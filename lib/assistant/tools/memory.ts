import { MEMORY_KINDS } from "../types";
import { addMemory, deleteMemory, listMemories, memoryHandle, MemoryError } from "../store";
import { ToolError, type AssistantTool } from "./types";

/**
 * The assistant's long-term memory of ONE user. Memories are listed in every
 * conversation's system prompt under short handles (m3f9a2c1); these tools
 * add and remove them. The user sees and edits the same list in the Memory
 * panel, so nothing here is hidden from them.
 */

export const saveMemoryTool: AssistantTool = {
  name: "save_memory",
  label: "Saving to memory",
  description:
    "Remember something durable about THIS user for future conversations: a goal or target, a preference about how they want answers, a fact about how they work, or a strategy decision they made. One short fact per call, written in the third person (\"Wants weekly summaries every Monday\"). Do NOT save dashboard numbers (they change — look them up instead), secrets, or anything about other people's private matters.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "The fact, one sentence, under 500 characters." },
      kind: { type: "string", enum: [...MEMORY_KINDS], description: "What sort of memory this is." },
    },
    required: ["content"],
  },
  available: () => true,
  async run(args, ctx) {
    try {
      const { memory, duplicate } = await addMemory(ctx.admin, ctx.userId, {
        content: args.content,
        kind: args.kind,
        source: "assistant",
        conversationId: ctx.conversationId,
      });
      if (!duplicate) ctx.emit?.({ type: "memory", action: "saved", memory });
      return {
        data: { saved: !duplicate, already_known: duplicate, handle: memoryHandle(memory.id), content: memory.content },
        summary: duplicate ? "Already remembered" : `Remembered: ${memory.content}`,
      };
    } catch (e) {
      if (e instanceof MemoryError) throw new ToolError(e.message);
      throw e;
    }
  },
};

export const forgetMemoryTool: AssistantTool = {
  name: "forget_memory",
  label: "Updating memory",
  description:
    "Forget one of this user's memories — when they ask you to, or when it is clearly outdated or wrong (then save the corrected fact with save_memory). Pass the memory's handle exactly as listed in your instructions (e.g. m3f9a2c1).",
  parameters: {
    type: "object",
    properties: { handle: { type: "string", description: "The memory's handle, e.g. m3f9a2c1." } },
    required: ["handle"],
  },
  available: () => true,
  async run(args, ctx) {
    const handle = typeof args.handle === "string" ? args.handle.trim().toLowerCase() : "";
    if (!handle) throw new ToolError("Pass the memory's handle.");
    const memories = await listMemories(ctx.admin, ctx.userId);
    const match = memories.find((m) => memoryHandle(m.id) === handle || m.id === handle);
    if (!match) throw new ToolError(`No memory has the handle "${handle}".`);
    const removed = await deleteMemory(ctx.admin, ctx.userId, match.id);
    if (removed) ctx.emit?.({ type: "memory", action: "forgotten", memory: removed });
    return { data: { forgotten: true, content: match.content }, summary: `Forgot: ${match.content}` };
  },
};
