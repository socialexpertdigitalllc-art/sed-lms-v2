export const PAYMENT_CATEGORIES = ["Website", "Yearly", "Add-on", "Other"] as const;
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

export interface PaymentLink {
  id: string;
  label: string;
  amount: number;
  currency: string;
  category: PaymentCategory;
  url: string;
  notes: string | null;
  provider: string;
  external_id: string | null;
  is_active: boolean;
  sort: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
