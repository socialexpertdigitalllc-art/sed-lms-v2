/**
 * Shared button class strings.
 *
 * Presentation only — no behaviour lives here. Kept as plain strings (rather than
 * components) so callers keep full control of `<button>` / `<a>` semantics and can
 * merge extra classes through `cn`.
 */

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 " +
  focusRing +
  " disabled:pointer-events-none disabled:opacity-55";

/** Solid teal call-to-action. One per surface. */
export const btnPrimary = `${base} bg-accent px-3.5 py-2 text-sm text-white hover:bg-accent-ink`;

/** Bordered neutral action. */
export const btnSecondary = `${base} border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-surface-2`;

/** Compact bordered action, for use inside dense list rows. */
export const btnSecondarySm = `${base} border border-border bg-surface px-2.5 py-1.5 text-xs text-text hover:bg-surface-2`;

/** Borderless action that only reveals its chrome on hover. */
export const btnGhostSm = `${base} px-2 py-1.5 text-xs text-text-muted hover:bg-surface-2 hover:text-text`;

/** Square 32px icon-only action. Always pair with a `title` + `aria-label`. */
export const iconBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-text-muted transition-colors duration-150 " +
  focusRing +
  " hover:border-border hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-45";

/** Destructive variant of `iconBtn`. */
export const iconBtnDanger =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-text-muted transition-colors duration-150 " +
  focusRing +
  " hover:border-dropped-bg hover:bg-dropped-bg hover:text-dropped-fg disabled:pointer-events-none disabled:opacity-45";
