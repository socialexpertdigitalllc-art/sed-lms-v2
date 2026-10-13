// The issuing company as printed on every receipt.
export const RECEIPT_COMPANY = {
  name: "Social Expert Digital LLC",
  tagline: "Digital Solutions & Web Development",
  blurb: "Building brands that stand out online.",
  pillars: "Strategy · Design · Development · Growth",
  email: "billing@socialexpertdigitalllc.com",
  website: "socialexpertdigitalllc.com",
  phone: "(252) 401-2775",
} as const;

/** Receipts are sent from this mailbox unless the receipt settings pick another. */
export const BILLING_MAILBOX_ADDRESS = "billing@socialexpertdigitalllc.com";
