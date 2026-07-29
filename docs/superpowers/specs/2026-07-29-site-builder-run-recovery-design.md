# Site Builder run recovery — design

**Date:** 2026-07-29
**Status:** approved for planning
**Scope:** subsystem **B** of a four-part effort. A follows (shipped); C and D follow this.

## Problem

A Site Builder run that fails is a dead end. Three separate paths lead there and
none of them has a way out.

1. **`/generate` accepts only `queued`.** A run whose status is `failed` can
   never be re-run. There is no retry action anywhere in the UI.
2. **The per-page Regenerate button is disabled on exactly the runs that need
   it.** `BuilderRun.tsx` gates it on `status === "review" || "approved"`, so on
   a failed run the operator sees the page, sees its error, sees the button, and
   clicking does nothing.
3. **A run stuck in `generating`** — server restart mid-run, or a generation
   that outlived its window — is reclaimable only after 60 minutes of silence,
   with nothing on screen to say so.

Subsystem A removed the worst case: a thrown provider failure no longer discards
the pages that succeeded. What remains is that a run reaches `failed` when every
page failed, or when something outside `runSite` threw (the lead was deleted, the
template failed to load, the zip upload failed) — and in that second case the
`pages` column may hold real, finished work that is now unreachable.

## What this builds

Retry re-enters the **same** run rather than cloning it. The operator keeps one
URL and one history, and the runs list will not show that an earlier attempt
failed — an accepted trade, chosen because not re-paying for pages that already
succeeded matters more than the audit trail.

### 1. `runSite` gains `resume`

```ts
/** Pages carried over from a previous attempt. Any entry already "ok" is kept
 *  verbatim and never regenerated; everything else is (re)generated. */
resume?: Record<string, PageState>;
```

The page plan is always recomputed fresh from the lead, never read back from the
stored map. If `specify_pages` changed between attempts, the retry builds the
CURRENT set: still-requested pages that already succeeded are carried over, pages
no longer requested are dropped, newly requested ones are generated. Reading the
plan out of the stored map instead would quietly pin a run to a stale
specification.

If the shared components file already succeeded, its rewritten source is reused
as prompt context and not re-called.

A page whose stored state is `generating` — the shape a killed run leaves behind
— is not `ok`, so it regenerates. That falls out of the rule rather than needing
its own case.

### 2. Retry is `POST /generate`, not a new endpoint

`/generate` already claims by CAS, runs the paced generation, and persists
per-page progress. Widening it is the whole feature:

- accepted statuses become `queued`, `failed`, or a stale `generating`;
- `resume: run.pages` is passed on every call.

`review`, `approved` and `deployed` are still refused — those have a packaged
zip, and the right tool there is per-page regeneration.

This also fixes a bug nobody reported: today a stale `generating` run that gets
reclaimed regenerates *everything*, discarding partial progress already persisted
to the row.

### 3. Regeneration works on a failed run

The regenerate route accepts `failed` alongside `review` and `approved`. On
success, if at least one non-component page is now `ok`, the run is promoted to
`review`.

Without the promotion the operator could fix a page and still not be able to
approve the run, which is the same dead end in a new place.

### 4. `/recover` for a stuck run

A new `POST /runs/[id]/recover`: CAS `generating` → `failed`, with an error
naming what happened, after which the normal retry applies.

Deliberately separate from retry. Force-releasing a claim is a different decision
from re-running, and it carries a risk retry does not — see below.

### 5. Superseding a live generation (what makes `/recover` safe)

Force-releasing a claim on a run that is *actually still working* would let a
second `runSite` start alongside the first: two writers racing on the same
`pages` column, and double the AI spend. The same hazard already exists today in
the 60-minute stale reclaim; it is simply rarer.

A run gains a `generation_id uuid` column (migration `0063`, nullable, additive).
It is set to a fresh value on every successful claim. Both the progress writes
and the terminal write add `.eq("generation_id", <the id this attempt claimed>)`,
so a superseded generation's writes match zero rows and are silently discarded
rather than clobbering its replacement.

This is the same optimistic-concurrency discipline `lib/site-studio/run/engine.ts`
already applies to its own step writes, and the reason is identical: a write from
an attempt that has been replaced must abandon its result, not overwrite a state
somebody else deliberately set.

### 6. UI

- A failed run's panel gains **Retry failed pages**, which POSTs `/generate`.
- The per-page Regenerate gate widens to include `failed`.
- A run in `generating` whose row has been silent for **5 minutes** gains
  **Stop and recover**.

Five minutes is deliberately far below the ~21 minutes a paced run can
legitimately stay silent, so the button will sometimes be offered on a run that
is in fact healthy. That is the right trade only because of §5: superseding
makes acting on it safe rather than merely unlikely to hurt. The button says so —
it warns that the run may still be working and that recovering will abandon
whatever the current attempt has not yet persisted.

The existing auto-kick (the run screen fires `/generate` once per mount when it
sees a `queued` run) is left alone; retry fires the request explicitly rather
than relying on a re-render, because that ref is already latched by then.

## Error handling

Retrying a run whose lead was deleted fails exactly as it did before, with the
same message. No special-casing: the failure is real and the operator needs to
see it rather than have it swallowed by a retry that silently does nothing.

`/recover` on a run that is not `generating` is refused with the current status,
matching how `/approve` and `/generate` already answer a wrong-state request.

## Testing

- `resume` keeps `ok` pages, regenerates everything else, and never re-calls the
  AI for a carried-over page (assert call counts, not just outcomes).
- A `specify_pages` that changed between attempts: still-requested successes are
  carried, dropped pages disappear, new pages generate.
- A carried-over components file is reused as context without a second call.
- `/generate` accepts `queued`, `failed`, stale `generating`; refuses `review`,
  `approved`, `deployed`.
- `/recover` refuses a non-`generating` run.
- Regenerating a page on a `failed` run promotes it to `review` — and does NOT
  promote when the only success is the components file.
- A superseded generation's progress write and terminal write both land on zero
  rows and leave the replacement's state intact.

## Out of scope

- **Live AI output streaming** — the operator's next request, and its own
  subsystem. It touches the shared provider seam that every AI feature calls,
  plus a new transport and the UI, so it does not belong in a recovery plan.
- **C** — a durable multi-lead generation queue.
- **D** — dynamic model discovery and the static-to-dynamic audit.
- Automatic retry on failure. Retry stays operator-initiated here; deciding when
  a machine should retry a whole run belongs with the queue in C.
