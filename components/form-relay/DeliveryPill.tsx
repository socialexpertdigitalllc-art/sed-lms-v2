import { Pill, type PillTone } from "@/components/common/Panel";
import type { FormDeliveryStatus } from "@/lib/forms/types";

const TONE: Record<FormDeliveryStatus, PillTone> = { sent: "ready", pending: "accent", sending: "accent", failed: "dropped", skipped: "neutral" };
const LABEL: Record<FormDeliveryStatus, string> = { sent: "Sent", pending: "Pending", sending: "Sending", failed: "Failed", skipped: "Skipped" };

export function DeliveryPill({ status, spam }: { status: FormDeliveryStatus; spam: boolean }) {
  if (spam) return <Pill tone="notready">Spam</Pill>;
  return <Pill tone={TONE[status]}>{LABEL[status]}</Pill>;
}
