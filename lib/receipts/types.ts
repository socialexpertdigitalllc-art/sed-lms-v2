// Payment receipts issued from a lead (table: lead_receipts, migration 0085).

export const RECEIPT_TERMS = ["one_time", "monthly", "yearly"] as const;
export type ReceiptTerm = (typeof RECEIPT_TERMS)[number];

export const TERM_LABEL: Record<ReceiptTerm, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const PAYMENT_METHODS = [
  "Stripe",
  "Credit/Debit Card",
  "Zelle",
  "Cash App",
  "PayPal",
  "Venmo",
  "Bank Transfer",
  "Check",
  "Cash",
  "Other",
] as const;

export type ReceiptItem = {
  title: string;
  description: string;
  term: ReceiptTerm;
  qty: number;
  rate: number;
};

export type ReceiptTotals = {
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
};

/** A lead_receipts row as the app reads it (numeric columns arrive as strings or numbers). */
export type ReceiptRow = {
  id: string;
  lead_id: string;
  receipt_no: string;
  created_by: string | null;
  bill_to_name: string;
  bill_to_business: string;
  bill_to_email: string | null;
  bill_to_phone: string | null;
  project_title: string;
  project_ref: string;
  items: ReceiptItem[];
  subtotal: number | string;
  discount: number | string;
  tax_rate: number | string;
  tax_amount: number | string;
  total: number | string;
  currency: string;
  paid_on: string;
  payment_method: string;
  payment_reference: string | null;
  notes: string[];
  signer_name: string;
  pdf_path: string | null;
  sent_to: string | null;
  sent_at: string | null;
  sent_by: string | null;
  mailbox_id: string | null;
  created_at: string;
};

/** What the receipt PDF prints. Built from a ReceiptRow (or a preview draft). */
export type ReceiptDoc = {
  receiptNo: string;
  issuedOn: string; // YYYY-MM-DD
  billToName: string;
  billToBusiness: string;
  billToEmail: string | null;
  billToPhone: string | null;
  projectTitle: string;
  projectRef: string;
  items: ReceiptItem[];
  totals: ReceiptTotals;
  paidOn: string; // YYYY-MM-DD
  paymentMethod: string;
  paymentReference: string | null;
  notes: string[];
  signerName: string;
};
