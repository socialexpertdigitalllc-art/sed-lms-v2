import type { ReceiptTerm } from "@/lib/receipts/types";

// Quick-pick services for the receipt modal. Picking one fills the title,
// description and term; the price is always typed in (prices vary per deal).
export type ServicePreset = { title: string; description: string; term: ReceiptTerm };

export const SERVICE_PRESETS: ServicePreset[] = [
  {
    title: "Custom Website Development",
    description: "Design, development and launch of a custom website, built mobile-first with on-page SEO and a working contact form.",
    term: "one_time",
  },
  {
    title: "Domain, Hosting & Maintenance",
    description: "Domain renewal, managed hosting, SSL certificate and ongoing maintenance for one year.",
    term: "yearly",
  },
  {
    title: "Google Business Profile & Local SEO",
    description: "Google Business Profile optimization, citation cleanup, review routine and a monthly ranking report.",
    term: "monthly",
  },
  {
    title: "AI Voice Assistant",
    description: "Voice assistant on the client's website, set up with their services, prices and hours, with lead notifications.",
    term: "monthly",
  },
  {
    title: "AI Receptionist",
    description: "AI phone receptionist that answers calls, books appointments and texts a summary of every call.",
    term: "monthly",
  },
  {
    title: "Custom Dashboard",
    description: "Lead pipeline, reporting and team tools built for the client and hosted on their own domain.",
    term: "one_time",
  },
  {
    title: "Website Maintenance",
    description: "Content updates, fixes and monitoring for the client's website.",
    term: "monthly",
  },
  {
    title: "Developer Consultation",
    description: "One-on-one session with a senior developer, with a written summary of recommendations.",
    term: "one_time",
  },
];
