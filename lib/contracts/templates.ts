import type { ContractSnapshot } from "@/lib/contracts/types";
import { formatUsd } from "@/lib/contracts/merge";

/**
 * Contract template registry — the scalable core of the contract system.
 *
 * A template is pure content: a title, the intro "agreement noun", and an
 * ordered list of sections built from typed nodes. Merge values (prices, etc.)
 * are expressed as `(snapshot) => string` so the same template renders for any
 * lead. Adding a NEW contract type = add one entry to CONTRACT_TEMPLATES; the
 * `template_key` column, the composer selector, and ContractDocument all pick
 * it up automatically — no other code changes. The branded letterhead, the
 * parties block, and the signature block are shared shell (ContractDocument),
 * so a new template only supplies its own clauses.
 */

/** A dynamic-or-static text value. Functions receive the contract snapshot. */
export type ContractText = string | ((s: ContractSnapshot) => string);

export type ContractNode =
  | { kind: "para"; text: ContractText }      // body paragraph
  | { kind: "subhead"; text: string }          // bold inline label (e.g. "a. Website Development")
  | { kind: "bullet"; text: ContractText };    // bulleted list item

export interface ContractSection {
  heading: string;         // e.g. "1. Scope of Services"
  nodes: ContractNode[];
}

export interface ContractTemplate {
  key: string;
  label: string;           // shown in the composer's template selector
  title: string;           // large heading on the PDF, e.g. "WEBSITE DEVELOPMENT AGREEMENT"
  agreementNoun: string;   // used in the intro sentence: This Service Agreement ("<agreementNoun>") …
  sections: ContractSection[];
}

/** Resolve a ContractText against the snapshot. */
export function nodeText(t: ContractText, s: ContractSnapshot): string {
  return typeof t === "function" ? t(s) : t;
}

const STANDARD_WEBSITE_AGREEMENT: ContractTemplate = {
  key: "standard",
  label: "Website Development Agreement",
  title: "WEBSITE DEVELOPMENT AGREEMENT",
  agreementNoun: "Website Development Agreement",
  sections: [
    {
      heading: "1. Scope of Services",
      nodes: [
        { kind: "para", text: "The Service Provider agrees to provide the following services to the Client:" },
        { kind: "subhead", text: "a. Website Development" },
        { kind: "bullet", text: "Development of a business website" },
        { kind: "bullet", text: "Mobile-responsive design" },
        { kind: "bullet", text: "Content structured for local service visibility" },
        { kind: "bullet", text: "Contact information integration (phone, email, address)" },
      ],
    },
    {
      heading: "2. Pricing & Payment Terms",
      nodes: [
        { kind: "bullet", text: (s) => `Fee: ${formatUsd(s.one_time_price)} (USD) / One Time + ${formatUsd(s.yearly_price)} (USD) / Year` },
        { kind: "subhead", text: "Payment Terms:" },
        { kind: "bullet", text: (s) => `The ${formatUsd(s.one_time_price)} one-time and ${formatUsd(s.yearly_price)} / Year fee covers website maintenance.` },
        { kind: "bullet", text: "Payments are non-refundable once work has commenced." },
      ],
    },
    {
      heading: "3. Timeline",
      nodes: [
        { kind: "bullet", text: "Website development will typically be completed within 5–10 business days after receipt of payment and required business information." },
        { kind: "bullet", text: "Timeline may vary depending on client responsiveness and content approvals." },
      ],
    },
    {
      heading: "4. Client Responsibilities",
      nodes: [
        { kind: "para", text: "The Client agrees to:" },
        { kind: "bullet", text: "Provide accurate business information, branding details, and service descriptions" },
        { kind: "bullet", text: "Respond in a timely manner to requests for approvals or information" },
        { kind: "bullet", text: "Ensure that all provided content is lawful and owned or authorized for use" },
      ],
    },
    {
      heading: "5. Ownership & Rights",
      nodes: [
        { kind: "bullet", text: "Upon full payment, the Client will have full lifetime ownership of the website." },
        { kind: "bullet", text: "The Service Provider retains the right to showcase the project in portfolios or marketing materials unless otherwise requested in writing." },
      ],
    },
    {
      heading: "6. Term & Termination",
      nodes: [
        { kind: "bullet", text: "This Agreement becomes effective on the date signed." },
        { kind: "bullet", text: "Either party may terminate the agreement with written notice." },
        { kind: "bullet", text: "Annual fees already paid are non-refundable." },
        { kind: "bullet", text: "Termination does not negate payment obligations for work already completed." },
      ],
    },
    {
      heading: "7. Limitation of Liability",
      nodes: [
        { kind: "para", text: "The Service Provider shall not be held liable for:" },
        { kind: "bullet", text: "Search engine algorithm changes" },
        { kind: "bullet", text: "Loss of rankings due to factors outside direct control" },
        { kind: "bullet", text: "Indirect or consequential damages" },
        { kind: "para", text: "Total liability shall not exceed the amount paid by the Client under this Agreement." },
      ],
    },
    {
      heading: "8. Confidentiality",
      nodes: [
        { kind: "para", text: "Both parties agree to keep confidential any non-public business, technical, or financial information shared during the course of this Agreement." },
      ],
    },
    {
      heading: "9. Entire Agreement",
      nodes: [
        { kind: "para", text: "This document constitutes the entire agreement between both parties and supersedes all prior discussions or agreements, whether written or verbal." },
      ],
    },
  ],
};

export const CONTRACT_TEMPLATES: ContractTemplate[] = [STANDARD_WEBSITE_AGREEMENT];

export const DEFAULT_TEMPLATE_KEY = "standard";

export function isContractTemplateKey(v: string): boolean {
  return CONTRACT_TEMPLATES.some((t) => t.key === v);
}

/** Resolve a template by key, falling back to the standard template. */
export function getContractTemplate(key: string): ContractTemplate {
  return CONTRACT_TEMPLATES.find((t) => t.key === key) ?? STANDARD_WEBSITE_AGREEMENT;
}
