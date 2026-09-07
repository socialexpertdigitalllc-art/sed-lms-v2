import { randomBytes } from "node:crypto";
import { z } from "zod";

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "hostname only, e.g. example.com or *.example.com");

const httpUrl = z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), "must start with http:// or https://");

// Base validators with no `.default()`, shared between the full-input schema
// (which applies defaults) and the patch schema (which must NOT — in zod 4,
// `.partial()` still runs each field's `.default()` on parse, so building the
// patch schema off the defaulted object would silently fill in every omitted
// field instead of leaving it absent).
const nameField = z.string().trim().min(1, "name is required").max(120);
const leadIdField = z.string().uuid().nullable();
const toEmailsField = z.array(z.string().trim().email()).min(1, "at least one recipient").max(10);
const subjectTemplateField = z.string().trim().max(200);
const mailboxIdField = z.string().uuid().nullable();
const allowedOriginsField = z.array(hostname).max(20);
const dailyLimitField = z.number().int().min(1).max(10_000);
const successRedirectUrlField = httpUrl.nullable();
const statusField = z.enum(["active", "paused"]);

export const endpointInputSchema = z.object({
  name: nameField,
  lead_id: leadIdField.default(null),
  to_emails: toEmailsField,
  subject_template: subjectTemplateField.default(""),
  mailbox_id: mailboxIdField.default(null),
  allowed_origins: allowedOriginsField.default([]),
  daily_limit: dailyLimitField.default(200),
  success_redirect_url: successRedirectUrlField.default(null),
  status: statusField.default("active"),
});
export type EndpointInput = z.infer<typeof endpointInputSchema>;

export const endpointPatchSchema = z
  .object({
    name: nameField,
    lead_id: leadIdField,
    to_emails: toEmailsField,
    subject_template: subjectTemplateField,
    mailbox_id: mailboxIdField,
    allowed_origins: allowedOriginsField,
    daily_limit: dailyLimitField,
    success_redirect_url: successRedirectUrlField,
    status: statusField,
  })
  .partial();
export type EndpointPatch = z.infer<typeof endpointPatchSchema>;

/** 24 random bytes → 32 base64url chars. Public in the site's HTML, so not a secret; unique index guards collisions. */
export function generateAccessKey(): string {
  return randomBytes(24).toString("base64url");
}
