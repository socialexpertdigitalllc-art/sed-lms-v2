import { colorToHex, parseColorScheme } from "@/lib/leads/colorScheme";

/**
 * A colour scheme as the reader sees it: the colours themselves, as small
 * circles, beside the text. "#0C5AA0, #F24F24" means nothing to a person
 * glancing at a lead; a navy dot and an orange dot do. Pure display —
 * editing stays with `ColorSchemeField`.
 *
 * Any entry that cannot be resolved to a colour (free text like "earthy") is
 * simply not drawn; the text still shows it.
 */
export function ColorSchemeSwatches({ value }: { value: string }) {
  const text = value.trim();
  if (!text) return null;
  const swatches = parseColorScheme(text)
    .map((c) => ({ label: c, hex: colorToHex(c) }))
    .filter((c): c is { label: string; hex: string } => c.hex !== null);

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      {swatches.length > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1" aria-hidden>
          {swatches.map((c, i) => (
            <span
              key={`${c.hex}-${i}`}
              title={c.label}
              className="inline-block h-4 w-4 rounded-full border border-black/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,.5)]"
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </span>
      )}
      <span className="min-w-0 break-words">{text}</span>
    </span>
  );
}
