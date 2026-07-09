import { PAYMENT_CATEGORIES, type PaymentCategory, type PaymentLink } from "@/lib/payments/types";

export interface BoardFilter {
  query?: string;
  category?: PaymentCategory | "";
  includeArchived?: boolean;
}
export interface CategorySection { category: PaymentCategory; links: PaymentLink[] }

export function groupLinks(links: PaymentLink[], f: BoardFilter): CategorySection[] {
  const q = (f.query ?? "").trim().toLowerCase();
  const filtered = links.filter((l) => {
    if (!f.includeArchived && !l.is_active) return false;
    if (f.category && l.category !== f.category) return false;
    if (q && !l.label.toLowerCase().includes(q) && !String(l.amount).includes(q)) return false;
    return true;
  });
  const sections: CategorySection[] = [];
  for (const category of PAYMENT_CATEGORIES) {
    const inCat = filtered
      .filter((l) => l.category === category)
      .sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
    if (inCat.length) sections.push({ category, links: inCat });
  }
  return sections;
}
