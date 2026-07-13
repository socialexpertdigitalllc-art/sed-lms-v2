/** Date → value for an `<input type="datetime-local">`: yyyy-MM-ddTHH:mm, LOCAL time, zero-padded. */
export function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value `mins` minutes after `from` (defaults to now). */
export function inMinutes(mins: number, from?: Date): string {
  return toDateTimeLocal(new Date((from ?? new Date()).getTime() + mins * 60_000));
}
