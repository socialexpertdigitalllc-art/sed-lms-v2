// POST /api/domains/sync — "Sync now": the same as /api/domains/import (kept
// for the pages already open on the old name).
export { POST } from "../import/route";

export const runtime = "nodejs";
export const maxDuration = 120;
