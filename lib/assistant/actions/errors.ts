import type { Problem } from "./types";

/**
 * A refusal or failure meant for the PERSON, in words they can act on ("This
 * has already been done.", "Only the lead's creator can undo creating it.").
 * Anything else that goes wrong is logged and shown as a generic failure, so
 * internals never reach a card. Its own module so action definitions can
 * throw it without importing the lifecycle (which imports them).
 */
export class ActionFailure extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly problems?: Problem[],
  ) {
    super(message);
  }
}
