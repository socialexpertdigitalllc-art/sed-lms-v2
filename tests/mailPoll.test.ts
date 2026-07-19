import { describe, it, expect } from "vitest";
import { planMailPoll, mailDedupKey, mailNotificationText, type PollMessage } from "@/lib/mail/poll";

const msg = (uid: number, from = "a@b.com", subject = "Hello"): PollMessage => ({ uid, from, subject });

describe("planMailPoll — first run", () => {
  it("notifies nobody and parks the watermark just below uidNext", () => {
    const plan = planMailPoll(null, 120, [msg(1), msg(2)]);
    expect(plan.firstRun).toBe(true);
    expect(plan.toNotify).toEqual([]);
    expect(plan.highestUid).toBe(119);
  });

  it("records no watermark when the server gave no uidNext", () => {
    expect(planMailPoll(null, null, []).highestUid).toBeNull();
    expect(planMailPoll(null, 0, []).highestUid).toBeNull();
  });
});

describe("planMailPoll — subsequent runs", () => {
  it("notifies only for UIDs strictly greater than the watermark", () => {
    const plan = planMailPoll(10, 14, [msg(10), msg(11), msg(13)]);
    expect(plan.firstRun).toBe(false);
    expect(plan.toNotify.map((m) => m.uid)).toEqual([11, 13]);
    expect(plan.highestUid).toBe(13);
  });

  it("returns the watermark unchanged when the n:* range only echoes the last message", () => {
    const plan = planMailPoll(42, 43, [msg(42)]);
    expect(plan.toNotify).toEqual([]);
    expect(plan.highestUid).toBe(42);
  });

  it("sorts new messages oldest-first", () => {
    const plan = planMailPoll(5, 20, [msg(9), msg(6), msg(8)]);
    expect(plan.toNotify.map((m) => m.uid)).toEqual([6, 8, 9]);
    expect(plan.highestUid).toBe(9);
  });

  it("handles an empty fetch", () => {
    expect(planMailPoll(7, 8, [])).toEqual({ firstRun: false, toNotify: [], highestUid: 7 });
  });

  it("treats uid 0 watermark as a real watermark, not a first run", () => {
    const plan = planMailPoll(0, 3, [msg(1), msg(2)]);
    expect(plan.firstRun).toBe(false);
    expect(plan.toNotify.map((m) => m.uid)).toEqual([1, 2]);
  });
});

describe("mailDedupKey", () => {
  it("is stable per mailbox + uid so overlapping runs cannot double-send", () => {
    expect(mailDedupKey("mb-1", 42)).toBe("mail:mb-1:42");
    expect(mailDedupKey("mb-1", 42)).toBe(mailDedupKey("mb-1", 42));
    expect(mailDedupKey("mb-2", 42)).not.toBe(mailDedupKey("mb-1", 42));
  });
});

describe("mailNotificationText", () => {
  it("uses the sender and subject", () => {
    const t = mailNotificationText(msg(1, "Jane <jane@x.com>", "Invoice"), "me@co.com");
    expect(t.title).toBe("New email from Jane <jane@x.com>");
    expect(t.body).toBe("Invoice — me@co.com");
  });

  it("falls back for blank sender/subject", () => {
    const t = mailNotificationText(msg(1, "  ", "   "), "me@co.com");
    expect(t.title).toBe("New email from Unknown sender");
    expect(t.body).toBe("(no subject) — me@co.com");
  });
});
