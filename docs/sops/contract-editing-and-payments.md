# Contracts: payment terms, editing, your own PDF — runbook

Added 2026-10-20 (migration 0089). Three additions to **Lead → Contracts → New**.

## For users

- **Payment terms.** Pick how the client pays the one-time fee:
  - *Paid in full*: due upon signing (the old behaviour).
  - *Deposit + balance*: an upfront deposit (type an amount or tap 25/30/50%),
    then the balance when work begins, on completion, on a date, or N
    days/weeks/months after signing.
  - *Installments*: N equal payments, the first upon signing, then one every
    N weeks/months. Any odd cent goes on the last one.
  - *Custom schedule*: any rows you like. Change an earlier amount and the
    last payment absorbs the difference.
  - The payments must add up to the one-time price. "In the contract" shows the
    exact wording that goes into the PDF.
- **Edit contract** (after *Create & preview*). Change, remove or add
  paragraphs, then **Save & update PDF**. Edits are written into the
  contract's Google Doc, so the PDF keeps the template's look. **Insert payment
  terms** adds the schedule after the paragraph you last clicked. Paragraphs
  with images or signatures can't be edited here. Use **Google Docs** for
  those, then **Refresh PDF**.
- **Upload your own PDF.** Choose *Upload your own PDF* as the template to
  send a contract you prepared yourself (PDF only, up to 15 MB). On a generated
  draft, **Replace with my PDF** sends your file instead. **Refresh PDF** goes
  back to the generated one.
- **Drafts** stay on the lead with a **Continue** button until sent. A sent
  contract can't be changed: create a new one.

## For admins: templates

Put `{{payment_terms}}` on its own line in a Google template where the
payment clause should go. Without it, the LMS adds the schedule after the
first paragraph that quotes the one-time price (e.g. "Fee: $1,200.00 …"). If no
paragraph quotes it, the agent is told to add the terms with Edit contract.

Other tokens: `{{payment_schedule}}` (just the numbered lines),
`{{deposit_amount}}` (first payment), `{{balance_amount}}` (everything after
it) and `{{installment_count}}`.

## How it works

- `lib/contracts/payments.ts`: the schedule model, validation (amounts must
  equal the fee, to the cent) and wording. Stored in `contracts.payment_plan`;
  null = paid in full.
- `lib/contracts/docEdit.ts`: turns the Doc into paragraphs and edits back into
  Docs `batchUpdate` requests. It changes only the characters that differ, and
  works from the end of the document backwards. The editor sends the doc's
  `revisionId`, and an edit against an older revision is refused ("reload").
- Routes: `GET/PUT /api/contracts/[id]/content` (edit),
  `POST /api/contracts/[id]/refresh-pdf`, `POST /api/contracts/[id]/pdf`
  (replace with an upload). `POST /api/contracts` accepts multipart for an
  upload. All of them work on drafts only and need `contracts.send`.
- Draft PDFs are stored as `{id}-v{time}.pdf`, a new file each time. The
  send route keeps what it emailed at `{id}.pdf`, so an edit racing a send can
  never overwrite the sent copy.
