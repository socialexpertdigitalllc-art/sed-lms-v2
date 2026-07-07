/** Progressive US phone mask: 2524012775 -> "(252) 401-2775". */
export function formatPhone(raw: string): string {
  const v = raw.replace(/\D/g, "").slice(0, 10);
  let f = "";
  if (v.length > 0) f = "(" + v.slice(0, 3);
  if (v.length >= 4) f += ") " + v.slice(3, 6);
  if (v.length >= 7) f += "-" + v.slice(6, 10);
  return f;
}

export const PHONE_RE = /^\(\d{3}\) \d{3}-\d{4}$/;
