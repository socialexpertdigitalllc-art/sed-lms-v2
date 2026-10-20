import type { PaymentPlan } from "./payments";

export interface ContractSnapshot {
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  one_time_price: number | null;
  yearly_price: number | null;
  agent_name: string;
  contract_date: string; // YYYY-MM-DD
  /** How the one-time fee is paid; null/absent = in full upon signing. */
  payment_plan?: PaymentPlan | null;
}

export interface ContractRow {
  id: string;
  lead_id: string;
  created_by: string | null;
  mailbox_id: string | null;
  template_key: string;
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  one_time_price: number | null;
  yearly_price: number | null;
  agent_name: string;
  contract_date: string;
  message_body: string;
  recipient_email: string | null;
  pdf_path: string | null;
  google_template_id: string | null;
  generated_doc_id: string | null;
  generated_doc_url: string | null;
  status: "draft" | "sent";
  sent_at: string | null;
  created_at: string;
  payment_plan?: PaymentPlan | null;
  /** The uploaded file's name when the PDF is the agent's own. */
  pdf_uploaded_name?: string | null;
  edited_at?: string | null;
}

/** Row shape for the contracts list (joins in a business/lead label). */
export interface ContractListItem extends ContractRow {
  lead_business_name: string;
}
