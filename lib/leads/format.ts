import { toDateTimeLocal as dateToDateTimeLocal } from "@/lib/dates/datetimeLocal";

export function formatCurrency(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatCompactCurrency(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "$0";
  if (Math.abs(n) >= 1000) return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return "$" + n.toFixed(0);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Short relative time: "just now", "5m ago", "3h ago", "2d ago", else the date. Absolute value belongs in a title tooltip. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const min = 60_000, hr = 3_600_000, day = 86_400_000;
  if (abs < min) return "just now";
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < hr) return `${Math.round(abs / min)}m ${suffix}`;
  if (abs < day) return `${Math.round(abs / hr)}h ${suffix}`;
  if (abs < 7 * day) return `${Math.round(abs / day)}d ${suffix}`;
  return formatDate(iso);
}

/** ISO → value for an <input type="datetime-local"> (local time, no seconds). */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return dateToDateTimeLocal(d);
}

/** US phone mask: (XXX) XXX-XXXX as digits arrive. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  const len = digits.length;
  if (len === 0) return "";
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || "?";
}
