import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead } from "@/lib/leads/types";
import { getUserDirectory, type DirectoryUser } from "@/lib/users/directory";
import { getTeamAgentIds } from "@/lib/teams/closers";
import type { FollowUpRow } from "../analytics";
import type { Period } from "../dates";
import { ToolError } from "./types";

/**
 * Per-message data loading for the tools.
 *
 * One question often takes several tool calls over the same rows ("summary,
 * then by agent, then by month"), so each dataset is loaded at most once per
 * user message and shared. Everything user-visible loads through the user's
 * own client — see the scoping rule in ./types.ts.
 */

const PAGE = 1000;
/** 100k rows. A ceiling, not an expectation: it bounds a runaway, it does not
 *  shape a normal answer. */
const MAX_PAGES = 100;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Every row of a query, page by page. PostgREST caps a single response
 * (1,000 rows by default on Supabase), so a plain select silently returns the
 * first thousand — and a total computed over them is simply wrong, with
 * nothing to say so. The caller's query must be stably ordered.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw new ToolError(`The database refused the read: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** `.in()` with a long id list overflows the URL; split it. */
export async function fetchByIds<T>(
  ids: string[],
  page: (chunk: string[]) => PromiseLike<PageResult<T>>,
  chunkSize = 150,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const { data, error } = await page(ids.slice(i, i + chunkSize));
    if (error) throw new ToolError(`The database refused the read: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}

export class TurnData {
  private leadsP?: Promise<Lead[]>;
  private directoryP?: Promise<Map<string, DirectoryUser>>;
  private teamP?: Promise<string[]>;
  private readonly followUpsP = new Map<string, Promise<FollowUpRow[]>>();

  constructor(private readonly src: { db: SupabaseClient; admin: SupabaseClient; userId: string }) {}

  /** Every non-deleted lead this user can see. RLS applies the visibility rule
   *  (view-all, own, or a closer's team) AND the per-status category gates. */
  leads(): Promise<Lead[]> {
    this.leadsP ??= fetchAll<Lead>((from, to) =>
      this.src.db
        .from("leads")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    );
    return this.leadsP;
  }

  /** Follow-up calls logged in the period (all time for null), on leads this
   *  user can see — the follow-up policy is "the lead is visible to you". */
  followUps(period: Period | null): Promise<FollowUpRow[]> {
    const key = period ? `${period.fromMs}-${period.toExMs}` : "all";
    let p = this.followUpsP.get(key);
    if (!p) {
      p = fetchAll<FollowUpRow>((from, to) => {
        let q = this.src.db.from("lead_follow_ups").select("lead_id, user_id, fu_status, created_at");
        if (period) q = q.gte("created_at", new Date(period.fromMs).toISOString()).lt("created_at", new Date(period.toExMs).toISOString());
        return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
      });
      this.followUpsP.set(key, p);
    }
    return p;
  }

  /** Every follow-up ever logged on these leads (visible ones only). */
  followUpsForLeads(leadIds: string[]): Promise<FollowUpRow[]> {
    return fetchByIds<FollowUpRow>(leadIds, (chunk) =>
      this.src.db.from("lead_follow_ups").select("lead_id, user_id, fu_status, created_at").in("lead_id", chunk),
    );
  }

  /** The company roster: id → display name. Names only — see lib/users/directory. */
  directory(): Promise<Map<string, DirectoryUser>> {
    this.directoryP ??= getUserDirectory().then((users) => new Map(users.map((u) => [u.id, u])));
    return this.directoryP;
  }

  /** A resolver from user id to a display name, for labelling rows. */
  async names(): Promise<(id: string | null) => string> {
    const dir = await this.directory();
    return (id) => (id ? dir.get(id)?.display_name?.trim() || "Unknown user" : "Unassigned");
  }

  /** Sales agents reporting to this user (empty unless they are a closer). */
  teamAgentIds(): Promise<string[]> {
    this.teamP ??= getTeamAgentIds(this.src.admin, this.src.userId).catch(() => []);
    return this.teamP;
  }
}
