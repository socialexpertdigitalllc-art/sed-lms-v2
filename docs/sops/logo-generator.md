# AI logo generator — runbook

Added 2026-10-22 (migration 0093). For leads with no logo: the LMS designs
one from the lead's details with MiniMax, and the accepted design goes
straight into the lead's **Logo link**.

**Changed 2026-10-23: the name is typeset, never drawn.** Image models
misspell names and draw malformed letters. So MiniMax now draws only the
**symbol** (no text at all), and the LMS sets the business name beside it in
a real font. Every design is spelled exactly as typed, with properly formed
letters.

**Changed again 2026-10-23: Google can design complete logos.** The MiniMax
symbols looked like basic clip-art (a plain house beside the name).
- **Design with Google** (next to Generate logo) uses Google's Nano Banana
  Pro (`gemini-3-pro-image`). It draws complete, agency-style logos, graphic
  and name together, from briefs written by a "creative director" prompt.
- Every Google design's lettering is read back. A misspelled one goes back
  to Google to fix only the lettering, up to twice.
- **Retry → Change this design** on a Google design edits that very picture.
- **MiniMax stays the default** (Generate logo). Google is billed per
  picture, so it is chosen per round. MiniMax's art direction now also asks
  for distinctive, agency-style marks instead of stock icons.

## For users

On a lead, under **Business info → Logo link**:

1. Press **Generate logo** (or **New logo with AI** when the lead already has
   one). It takes about a minute. The panel shows *Ideas → Drawing →
   Proofreading*, and each design appears as soon as it is drawn. **Stop**
   cancels the round.
2. You get **4 horizontal designs**:
   - a symbol (or a badge with the initials) beside the name, or the name
     alone in two colours;
   - the only words on them are the business name (without "LLC", "Inc." and
     so on): no services, phone, email, website or slogan;
   - the name is set in one of 15 logo fonts (Montserrat, Oswald, Playfair
     Display, Pacifico…), on one line or two. Each design shows **Exact
     spelling** and its font;
   - they use the lead's colour scheme. With no scheme on the lead, the AI
     picks colours that suit the trade.
3. Each symbol is checked for stray letters or scribbles. One that has any is
   drawn again. If it still has some, the design says so and is sorted last.
   If MiniMax can't draw a symbol at all, that design comes back with a badge
   of the initials instead, so the round still gives you 4 designs.
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
   - **Change this design**: say what to change ("bigger symbol, name on one
     line"). Quick chips help. You get 4 versions of that design.
     - A change to the lettering, font, colours, layout or the symbol's size
       keeps **the very same symbol**; nothing is redrawn.
     - Only a change to the symbol itself ("a simpler roof", "a different
       icon") redraws it. The first version starts from the same drawing seed.
   - **Try a new idea**: describe the logo you want ("a shield with a
     wrench"). Leave it empty for fresh designs.
   - **Font**: pick one from the list to use it in all 4. Picking a font is
     enough on its own.
   - You can also change the **Words on the logo**. They are set exactly as
     typed.
   - Designs from before 2026-10-23 (name drawn into the picture) get a new,
     typeset version when you change them. That is how to fix one that came
     out misspelled.
7. **Earlier rounds** lists previous tries. You can open any of them and
   accept a design from it.

Who can use it: anyone who can edit the lead's logo link. That means
**leads.edit**, plus the lead is yours, or you see all leads, or you are the
closer acting for the lead's agent.

## The two designers

| | Google ("Design with Google") | MiniMax (default: "Generate logo") |
|---|---|---|
| What it makes | Complete logos: graphic and name designed together (emblems, monograms, clever symbols, custom wordmarks) | A symbol, with the name set beside it in a real font |
| Spelling | Read back and corrected automatically. A design still wrong after 2 fixes is flagged and sorted last | Always exact (typeset) |
| Change this design | Edits the picture itself, keeping the rest | Keeps the same symbol unless the change is about it |
| Cost | Billed per picture to the Gemini API key's Google Cloud project: Nano Banana Pro is about $0.13 per picture, so a round is about $0.50 to $1 | The MiniMax plan |

- **Picking:**
  - **Generate logo** uses the default (MiniMax); **Design with Google**
    starts a Google round.
  - Retry → **Designer** offers both.
  - `LOGO_IMAGE_ENGINE=google` makes Google the default; the button then
    disappears.
- **Fallback:** if Google can't design at all (key, billing, quota), the
  round is made with MiniMax and the note says why.
- **About the Google AI Pro plan:**
  - It **can't** be connected to the LMS. It has no API access, and Flow
    credits only work inside Flow.
  - The LMS uses the **Gemini API key** under Admin → AI providers (the one
    the website builder already uses). Image models need billing switched on
    for its Google Cloud project; the free tier has no image quota.
  - Since January 2026 the AI Pro plan includes **$10/month of Google Cloud
    credit**, which can pay for some of this.

## Limits

- **One round at a time per lead.** Pressing again shows the running one.
- **30 rounds per person per hour**, and **60 rounds per lead per day**. These
  only guard against a runaway.
- **No company-wide daily cap.** The MiniMax plan is the limit. When MiniMax
  refuses, its reason is shown.
  - The first version had a 100-a-day cap, taken from an older version of
    MiniMax's plan page. MiniMax's current page gives no daily image figure,
    so the cap was removed.
  - An admin can still set one with `LOGO_DAILY_IMAGE_BUDGET` (pictures per
    UTC day). The panel then shows *Today: N of M pictures used*.
- A Google round draws at most 12 pictures: 4 logos, and up to 2 lettering
  fixes each.
- A MiniMax round draws at most 8: up to 4 symbols, and one redraw each.
  Badge and wordmark designs need no picture.

## When something goes wrong

| Message | What to do |
|---|---|
| *MiniMax isn't set up* | Admin → AI providers: add or enable the MiniMax key. |
| *no image allowance left* (MiniMax 1008) | The plan's daily image quota is used up. It refills on MiniMax's schedule. |
| *flagged as sensitive* / *safety filter* | Reword the Retry request. |
| *Couldn't upload the logo to the image host* | Admin → Image hosts: check the imgbb key. postimages and imgchest are the fallbacks. |
| *isn't set up yet … migration 0093* | Apply `supabase/migrations/0093_lead_logo_generations.sql`. |
| *stopped part-way (the server restarted)* | A deploy or restart killed the round. Press Try again. |
| *standard layouts were used* | The text model was down. The designs are still made, from built-in layouts. |
| *MiniMax couldn't draw some symbols … badge* | Those designs use the initials in a badge. MiniMax's reason is in the note. |
| *letter-like marks* | A symbol still had scribbles after a redraw. Pick another design, or Retry → "A different symbol". |

| *Google couldn't design these logos (…) — made with MiniMax instead* | Usually billing: switch it on for the Gemini API key's Google Cloud project. The reason is in the note. |
| *still has wrong lettering after two fixes* | Pick another design, or Retry → Change this design → "fix the spelling". |

Admins can route the two AI steps under **Admin → AI models**:
- **Logo ideas**: the text model that designs the concepts (layout, symbol,
  font, case, line split, colours);
- **Logo spelling & symbol check**: a vision model is required. It reads
  Google's lettering back, and looks for stray writing in MiniMax symbols.

**Logo ideas** defaults to MiniMax-M3; **Logo spelling & symbol check**
defaults to Gemini 3.5 Flash, a strong reader. The drawing itself is Google
`gemini-3-pro-image` (wide, 2K; other Nano Banana models if the key can't use
it) or MiniMax image-01 (square symbols, 1024×1024).

## How it works

- `lib/logos/artPrompt.ts` (Google):
  - the creative-director brief and six styles (symbol + name, emblem,
    monogram, abstract mark, mascot, custom wordmark);
  - the full picture prompt (the name quoted exactly; colours by name and
    hex);
  - the lettering-fix and change (edit) prompts.
- `lib/logos/geminiImage.ts`: the Google call.
  - `generateContent`, with the key in a header.
  - It walks a list of model IDs and remembers the one that works.
  - It drops a setting a model refuses, skips thinking drafts, and turns
    Google's refusals into plain messages.
- `lib/logos/brief.ts`: what goes on the logo (`logoTextFor`), and the lead's
  colours, given names an image model paints well. Hex codes are never sent
  to the image model.
- `lib/logos/prompt.ts`:
  - the concept writer's instructions, including the font menu;
  - `normalizeConcept`, which makes the reply safe:
    - known fonts and layouts only;
    - colours snapped to the brand's;
    - line splits re-cut from the name as typed, so the letters always come
      from the lead, never from the model;
  - a fallback that needs no AI;
  - `iconPrompt`: the symbol only, never the name, "absolutely no text".
- `lib/logos/fontList.ts` (catalogue) and `lib/logos/fonts/` (the TTF files,
  SIL OFL / Apache, see the README there).
- `lib/logos/typeset.ts`: fontkit lays out the name with kerning and
  ligatures and turns it into vector outlines. No installed fonts are needed.
- `lib/logos/compose.ts`: the lockup.
  - Symbol or badge on the left, sized to the name, then one or two lines.
    The second line is smaller, spaced capitals in a companion font.
  - Light colours are deepened so they read on white.
  - Rendered to a transparent PNG with sharp.
- `lib/logos/minimaxImage.ts`: the image call.
  - `POST /v1/image_generation`, model `image-01`, base64, no prompt
    optimiser.
  - It goes through the MiniMax rate gate, shared with SED AI.
- `lib/logos/cleanup.ts` (sharp): removes the symbol's white background and
  crops it.
- `lib/logos/check.ts`: the symbol check and the ranking.
- `lib/logos/runner.ts`: one round, run after the request with `after()`.
  - Each design is saved as soon as it is made.
  - A changed design reuses its parent's symbol file (`iconPath`) unless the
    change is about the symbol.
  - Stop wins. It sends a heartbeat every minute.
- `lib/logos/store.ts`: the `lead_logo_generations` table, the limits and
  what the page is sent.
- `lib/logos/accept.ts`: uploads through the image-host chain (imgbb first),
  then sets `leads.logo_link` and writes `activity_log`.
- Files go in the public `branding` bucket under `lead-logos/<lead>/<round>/`:
  `N.png` is the design, `symbol-N.png` its symbol.
- Routes, all under `/api/leads/[id]/logo`:
  - `GET`, `POST`: list rounds, start one. `POST` takes an optional `font`;
  - `[genId]` `GET`: one round;
  - `[genId]/cancel`;
  - `[genId]/accept`.
- UI: `components/leads/logo/LogoField.tsx` and `LogoRetryDialog.tsx` (with
  the font picker).
