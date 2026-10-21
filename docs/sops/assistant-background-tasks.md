# SED AI background tasks — runbook

Added 2026-10-21 (migration 0092). A job too big for one answer, such as
*categorise every lead in the pipeline*, now keeps going on its own. It runs
answer after answer, with nobody watching and the page closed, until it is
done.

## Why

Before this, a big job ended whenever an answer hit its limits: 60 rounds,
or 60 changes made on its own. It waited for someone to type "continue".
If nobody did, the job sat half-done and looked "dead". MiniMax also
categorised one lead at a time: it opened each lead, then sent ten-card plans
of single edits. That used up the 60-change limit after about 60 leads.

## For users

- **Starting one.** Ask for the big job in **Act** with an auto permission
  mode. Either SED AI starts a background task itself, or the task starts the
  moment an answer runs out of room. In *Ask before every change* mode it
  first asks once to switch modes, then starts.
- **The banner** above the message box says *Working in the background*, with
  the run number, the changes so far and the latest progress. You can close
  the page; the task carries on.
- **In the chat**, each run shows as a divider (*Background task · run 3*)
  followed by what that run did.
- **Stop task** on the banner stops it at once, along with the run in
  progress. The chat's normal **Stop** does the same. Changes already made
  stay, and each can be undone as usual.
- **When it ends** you get a notification. Clicking it opens the chat. The
  banner then says *finished*, *needs you* (with SED AI's question), or
  *stopped* / *couldn't finish* (with the reason).
- You can keep chatting in that chat between runs. Ask "how far is it?",
  "stop it", or change the instructions ("skip closed leads").

## How it always ends

A task never loops forever. It stops when:

- SED AI reports it **done**, or **blocked** (it needs the person);
- **2 runs in a row change nothing** (finished or stuck);
- **3 runs in a row fail**, after backing off 2 then 4 minutes;
- it reaches **40 runs**;
- the owner loses Act mode, their account is deactivated, or the chat is
  deleted.

## For admins

- A task runs as its owner, under the permission mode it was started with,
  re-checked against the company limit on every run. High-impact changes,
  changes needing an approver, and actions set to *always ask* still wait on
  cards.
- At the start of each run, cards the task left waiting (usually ones held
  back by the 60-change limit) are re-run under the same rules, oldest first.
  A plan's steps run in order.
- Nothing extra runs while no task is live. The poller does one indexed
  select every 30 seconds.

## How it works

- `assistant_tasks` (migration 0092): the goal, the progress SED AI writes
  each run, and the runner's bookkeeping. One live task per chat. RLS lets
  owners read their own; all writes use the service role.
- `lib/assistant/tasks.ts`: the store, plus `afterRun`, the pure decision of
  what happens after each run.
- `lib/assistant/taskRunner.ts`:
  - The instrumentation poller POSTs `/api/assistant/tasks/process` every
    30 seconds (x-wge-secret; on the middleware's public list).
  - The route answers at once and sweeps in `after()`.
  - Each due task gets one run: an ordinary `runTurn` as its owner (`actAs`,
    like the phone channels), with `source: "scheduler"` and `task` set.
  - A run claims the row and sends a heartbeat every 30 seconds. A run that
    dies with the server goes silent for 3 minutes, and the next sweep runs
    the task again. One run lasts at most 20 minutes.
- Engine (`lib/assistant/engine.ts`):
  - **Start.** When an autonomous Act answer runs out of rounds, or of
    changes with work left, it starts a task (`ensureTask`).
  - **Tools.** `start_background_task` and `update_task_progress`
    (`lib/assistant/tools/tasks.ts`).
  - **Prompt.** A background run's prompt says nobody is watching, gives the
    goal and the progress so far, and says to report before ending.
  - **Waiting cards.** `request_permission_mode` is refused in a background
    run.
- Bulk steering (`lib/assistant/tools/actions.ts`, `tools/leads.ts`):
  - A `propose_plan` made only of `lead.update {lead, category}` steps becomes
    one `lead.categorize`.
  - After 5 single-lead lookups in one answer, `get_lead_details` points to
    `search_leads` with `include_services` (100 leads per call).
