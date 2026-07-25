import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { PERMISSIONS } from "@/lib/permissions/constants";

/**
 * THE BUG THIS EXISTS FOR. `studio.manage` was added to the PERMISSIONS array
 * in lib/permissions/constants.ts and nowhere else, on the assumption that the
 * constant was the catalogue. It isn't: the admin Permissions page and the
 * department grant UI both read the `public.permissions` TABLE, so the new key
 * was invisible in the admin UI and could not be granted — the feature shipped
 * ungrantable and the operator hit a dead end looking for it.
 *
 * The code constant and the DB table are two catalogues that must agree. This
 * test enforces the half that is checkable offline: every key the code declares
 * must be seeded by some migration. It cannot verify a specific database (that
 * needs credentials), but it does catch the mistake at its source — adding a key
 * to the constant without an accompanying `insert into public.permissions`.
 */

const SUPABASE_DIR = path.resolve(__dirname, "../supabase");
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, "migrations");

/**
 * Every permission key seeded into public.permissions by SQL in the repo.
 * Two sources, both legitimate: the original baseline lives in supabase/seed.sql,
 * and every feature added since seeds its own keys in its migration.
 */
function seededKeys(): Set<string> {
  const keys = new Set<string>();
  const files = [
    path.join(SUPABASE_DIR, "seed.sql"),
    ...readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).map((f) => path.join(MIGRATIONS_DIR, f)),
  ];
  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    // Only look inside `insert into public.permissions (...) values ...` blocks,
    // up to the statement's terminating semicolon, so unrelated inserts (grants
    // into department_permissions, notification rules, ...) can't be mistaken
    // for catalogue rows.
    for (const block of sql.matchAll(/insert\s+into\s+(?:public\.)?permissions\b[\s\S]*?;/gi)) {
      // first single-quoted string of each tuple is the key
      for (const tuple of block[0].matchAll(/\(\s*'([a-z0-9_.]+)'/gi)) keys.add(tuple[1]);
    }
  }
  return keys;
}

describe("permission catalogue is seeded", () => {
  const seeded = seededKeys();

  it("finds the historical seeds (sanity: the parser actually works)", () => {
    // representative keys from different migrations; if these go missing the
    // parser has broken, not the invariant
    expect(seeded.has("templates.manage")).toBe(true);
    expect(seeded.has("leads.cat_view.ready")).toBe(true);
    expect(seeded.size).toBeGreaterThan(30);
  });

  it("every key in the code catalogue is seeded by SQL in the repo", () => {
    const declared = PERMISSIONS.map((p) => p.key);
    const missing = declared.filter((k) => !seeded.has(k));
    expect(
      missing,
      `These permission keys exist in lib/permissions/constants.ts but nothing in supabase/ inserts them into ` +
        `public.permissions, so they will not appear in the admin Permissions UI and cannot be granted. Add an ` +
        `\`insert into public.permissions ... on conflict (key) do nothing;\` migration for: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("studio.manage specifically is both declared and seeded", () => {
    expect(PERMISSIONS.some((p) => p.key === "studio.manage")).toBe(true);
    expect(seeded.has("studio.manage")).toBe(true);
  });
});
