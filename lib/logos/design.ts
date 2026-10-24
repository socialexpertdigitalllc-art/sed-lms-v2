/** The vocabulary of a logo design (shared by the concept writer, the composer and the page). */

/** Horizontal lockups only: a symbol or a badge to the left of the name, or the name alone. */
export type LogoLayout = "icon-left" | "badge-left" | "wordmark";
export const LOGO_LAYOUTS: LogoLayout[] = ["icon-left", "badge-left", "wordmark"];

/** The badge that holds the initials in a badge-left logo. */
export type BadgeShape = "circle" | "rounded" | "shield" | "hexagon";
export const BADGE_SHAPES: BadgeShape[] = ["circle", "rounded", "shield", "hexagon"];

/** How the name is cased. "title" only capitalises words typed all in lower case. */
export type LetterCase = "upper" | "title" | "as-is";
export const LETTER_CASES: LetterCase[] = ["upper", "title", "as-is"];
