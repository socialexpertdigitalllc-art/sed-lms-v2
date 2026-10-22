# AI logo generator — runbook

Added 2026-10-22 (migration 0093). For leads with no logo: the LMS designs
one from the lead's details with MiniMax, and the accepted design goes
straight into the lead's **Logo link**.

## For users

On a lead, under **Business info → Logo link**:

1. Press **Generate logo** (or **New logo with AI** when the lead already has
   one). It takes about a minute. The panel shows *Ideas → Drawing →
   Proofreading*, and each design appears as soon as it is drawn. **Stop**
   cancels the round.
2. You get **4 horizontal designs**:
   - the only words on them are the business name (without "LLC", "Inc." and
     so on): no services, phone, email, website or slogan;
   - they use the lead's colour scheme. With no scheme on the lead, the AI
     picks colours that suit the trade.
3. Each design is read back letter by letter. **Spelled right** or
   **Misspelled — reads "…"** shows on each one, and the best designs come
   first. If nothing came back spelled right, it draws 4 more with plainer
   lettering by itself.
4. Click a design to see it large. **Transparent / Light / Dark** shows it on
   different backgrounds, so you can see how it looks on a dark website
   header.
5. **Accept** uploads the design to our imgbb account and puts its direct
   link in the Logo link field.
   - **Save as: Transparent PNG** (default) makes the background see-through,
     and any white inside letters or shapes too.
   - **On white** keeps the logo exactly as drawn, on white.
   - If the lead already has a logo, Accept asks before replacing it. The old
     link stays in the lead's activity log.
6. **Retry** opens a popup with two options:
   - **Change this design**: say what to change ("simpler roof icon, name
     on one line"). Quick chips help. You get 4 versions of that design with
     everything else kept.
   - **Try a new idea**: describe the logo you want ("a shield with a
     wrench"). Leave it empty for fresh designs.
   - You can also change the **Words on the logo**.
7. **Earlier rounds** lists previous tries. You can open any of them and
   accept a design from it.

Who can use it: anyone who can edit the lead's logo link. That means
**leads.edit**, plus the lead is yours, or you see all leads, or you are the
closer acting for the lead's agent.

## Limits

- **One round at a time per lead.** Pressing again shows the running one.
- **15 rounds per person per hour**, and **40 rounds per lead per day**.
- **100 designs per day for the whole company** (UTC), shown in the panel as
  *Today: N of 100 designs used*.
  - The MiniMax Max plan includes about 120 image-01 pictures a day, so 100
    keeps some back.
  - Change it with the `LOGO_DAILY_IMAGE_BUDGET` environment variable.
- A round draws 4 designs, or 8 when the first 4 were misspelled.

## When something goes wrong

| Message | What to do |
|---|---|
| *MiniMax isn't set up* | Admin → AI providers: add or enable the MiniMax key. |
| *no image allowance left* (MiniMax 1008) | The plan's daily image quota is used up. It refills on MiniMax's schedule. |
| *flagged as sensitive* / *safety filter* | Reword the Retry request. |
| *Couldn't upload the logo to the image host* | Admin → Image hosts: check the imgbb key. postimages and imgchest are the fallbacks. |
| *isn't set up yet … migration 0093* | Apply `supabase/migrations/0093_lead_logo_generations.sql`. |
| *stopped part-way (the server restarted)* | A deploy or restart killed the round. Press Try again. |
| *standard layouts were used* | The text model was down. The designs are still drawn, from built-in layouts. |
| *spelling couldn't be checked* | The vision model was down. Read each design before accepting. |

Admins can route the two AI steps under **Admin → AI models**:
- **Logo ideas**: the text model that writes the concepts;
- **Logo proofreading**: a vision model is required.

Both default to MiniMax-M3. The drawing itself is always MiniMax image-01.

## How it works

- `lib/logos/brief.ts`: what goes on the logo (`logoTextFor`), and the lead's
  colours, given names an image model paints well. Hex codes are never sent
  to the image model, because it would draw them as text.
- `lib/logos/prompt.ts`: the concept writer's instructions, its JSON, a
  fallback that needs no AI, and the image prompt. The image prompt stays
  under 1,500 characters, quotes the exact name, and lists what must never
  appear.
- `lib/logos/minimaxImage.ts`: the image call.
  - `POST /v1/image_generation`, model `image-01`, 1536×640, base64, no
    prompt optimiser.
  - It goes through the MiniMax rate gate, shared with SED AI.
  - MiniMax's error codes become plain messages.
- `lib/logos/cleanup.ts` (sharp):
  - removes the plain light background, including the holes in letters;
  - un-mixes the 2-pixel edge so there is no white halo;
  - crops with an even margin;
  - measures the shape (horizontal) and the colours (brand colours present).
- `lib/logos/check.ts`: the proofreading prompt, the spelling verdict
  (computed in code, not by the AI) and the ranking.
- `lib/logos/runner.ts`: one round, run after the request with `after()`.
  - Each design is saved as soon as it is drawn.
  - Every write is guarded, so Stop wins.
  - It sends a heartbeat every minute. A round silent for 5 minutes is
    marked failed.
- `lib/logos/store.ts`: the `lead_logo_generations` table, the limits and
  what the page is sent.
- `lib/logos/accept.ts`: uploads through the image-host chain
  (`lib/photo-capture/hosts/*`, imgbb first), then sets `leads.logo_link`
  and writes `activity_log`.
- Drafts are PNGs in the public `branding` bucket under
  `lead-logos/<lead>/<round>/`.
- Routes, all under `/api/leads/[id]/logo`:
  - `GET`, `POST`: list rounds, start one;
  - `[genId]` `GET`: one round;
  - `[genId]/cancel`;
  - `[genId]/accept`.
- UI: `components/leads/logo/LogoField.tsx` (the field and panel) and
  `LogoRetryDialog.tsx`.
