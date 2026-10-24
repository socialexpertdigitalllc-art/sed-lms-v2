/**
 * The user-movement tracker (page views, clicks, tab focus → `user_activity`,
 * shown on Admin → Logs → User Activity) is PAUSED.
 *
 * Paused 2026-10-23 at the operator's request while the LMS is being brought
 * back to speed: every open tab was posting a batch of events every 30 s and
 * each batch was a committed insert (170k rows / 44 MB so far). Flip this to
 * `false` and deploy to resume; nothing else needs to change.
 *
 * While paused the browser sends ONLY a one-per-minute heartbeat (and only
 * while the tab is visible), so `user_sessions.last_seen_at` stays honest:
 * the idle-timeout sweep, the sign-in analytics and SED AI's "who is online"
 * all read it. The heartbeat writes nothing to `user_activity`.
 */
export const ACTIVITY_LOG_PAUSED = true;

/** Heartbeat cadence while paused — the server throttles to once a minute anyway. */
export const ACTIVITY_HEARTBEAT_MS = 60_000;
