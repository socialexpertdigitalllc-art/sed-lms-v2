// @vitest-environment node
import { describe, it, expect } from "vitest";
import { classifyBounceKind, detectBounce, extractFailedRecipient, looksLikeBounce } from "@/lib/mail/bounce";

const POSTFIX_DSN = `From: MAILER-DAEMON@mail.sed.com (Mail Delivery System)
Subject: Undelivered Mail Returned to Sender
Content-Type: multipart/report; report-type=delivery-status

This is the mail system at host mail.sed.com.

I'm sorry to have to inform you that your message could not be delivered.

<nosuchuser@example.com>: host mx.example.com[93.184.216.34] said: 550 5.1.1
    <nosuchuser@example.com>: Recipient address rejected: User unknown (in reply
    to RCPT TO command)

Reporting-MTA: dns; mail.sed.com

Final-Recipient: rfc822; nosuchuser@example.com
Original-Recipient: rfc822;nosuchuser@example.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 <nosuchuser@example.com>: Recipient address rejected
`;

const SOFT_DSN = `From: postmaster@mail.sed.com
Subject: Delivery Status Notification (Delay)

Final-Recipient: rfc822; busy@example.org
Action: delayed
Status: 4.2.2
Diagnostic-Code: smtp; 452 4.2.2 Mailbox full
`;

const EXIM = `From: Mail Delivery System <Mailer-Daemon@relay.example.net>
Subject: Mail delivery failed: returning message to sender

This message was created automatically by mail delivery software.

A message that you sent could not be delivered. The following address(es) failed:

  gone@example.co.uk
    host mx.example.co.uk [10.0.0.1]
    SMTP error from remote mail server after RCPT TO:<gone@example.co.uk>:
    550 No such user here
`;

describe("looksLikeBounce (header-only gate)", () => {
  it("recognises daemon senders", () => {
    expect(looksLikeBounce({ from: "MAILER-DAEMON@mail.sed.com", subject: "anything" })).toBe(true);
    expect(looksLikeBounce({ from: "postmaster@example.com", subject: "hello" })).toBe(true);
  });

  it("recognises the standard NDR subjects", () => {
    for (const subject of [
      "Undelivered Mail Returned to Sender",
      "Delivery Status Notification (Failure)",
      "Mail delivery failed: returning message to sender",
      "Undeliverable: Q3 proposal",
      "Failure notice",
    ]) {
      expect(looksLikeBounce({ from: "someone@example.com", subject })).toBe(true);
    }
  });

  it("leaves ordinary mail alone", () => {
    expect(looksLikeBounce({ from: "client@example.com", subject: "Re: our meeting" })).toBe(false);
    expect(looksLikeBounce({ from: "sales@example.com", subject: "Your order has been returned" })).toBe(false);
  });
});

describe("detectBounce", () => {
  it("parses a Postfix DSN end to end", () => {
    const out = detectBounce({
      from: "MAILER-DAEMON@mail.sed.com (Mail Delivery System)",
      subject: "Undelivered Mail Returned to Sender",
      body: POSTFIX_DSN,
    });
    expect(out).toEqual({ isBounce: true, failedRecipient: "nosuchuser@example.com", kind: "hard" });
  });

  it("parses an Exim plain-text NDR", () => {
    const out = detectBounce({
      from: "Mail Delivery System <Mailer-Daemon@relay.example.net>",
      subject: "Mail delivery failed: returning message to sender",
      body: EXIM,
    });
    expect(out.isBounce).toBe(true);
    expect(out.failedRecipient).toBe("gone@example.co.uk");
    expect(out.kind).toBe("hard");
  });

  it("classifies a 4.x.x delay as soft", () => {
    const out = detectBounce({ from: "postmaster@mail.sed.com", subject: "Mail delivery failed", body: SOFT_DSN });
    expect(out).toEqual({ isBounce: true, failedRecipient: "busy@example.org", kind: "soft" });
  });

  it("is not fooled by a delayed/relayed delivery notification", () => {
    expect(
      detectBounce({ from: "postmaster@mail.sed.com", subject: "Delivery Status Notification (Delayed)" })
    ).toEqual({ isBounce: false, failedRecipient: null, kind: null });
    expect(detectBounce({ from: "postmaster@x.com", subject: "Delivery Status Notification (Relayed)" }).isBounce).toBe(
      false
    );
  });

  it("still reports the bounce when the body is missing, with no recipient", () => {
    const out = detectBounce({ from: "MAILER-DAEMON@x.com", subject: "Undelivered Mail Returned to Sender" });
    expect(out).toEqual({ isBounce: true, failedRecipient: null, kind: "soft" });
  });

  it("never returns the daemon itself as the failed recipient", () => {
    const out = detectBounce({
      from: "MAILER-DAEMON@mail.sed.com",
      subject: "Undelivered Mail Returned to Sender",
      body: "Final-Recipient: rfc822; MAILER-DAEMON@mail.sed.com\nStatus: 5.1.1\n",
    });
    expect(out.failedRecipient).toBeNull();
  });

  it("returns a clean not-a-bounce for ordinary mail", () => {
    expect(detectBounce({ from: "client@example.com", subject: "Invoice", body: "hi" })).toEqual({
      isBounce: false,
      failedRecipient: null,
      kind: null,
    });
  });
});

describe("extractFailedRecipient", () => {
  it("prefers the DSN Final-Recipient field", () => {
    expect(extractFailedRecipient("Final-Recipient: rfc822; A.User@Example.COM")).toBe("a.user@example.com");
    expect(extractFailedRecipient("Original-Recipient: rfc822;<b@example.com>")).toBe("b@example.com");
  });

  it("falls back to common plain-text forms", () => {
    expect(extractFailedRecipient("<bad@example.com>: host mx said: 550 ...")).toBe("bad@example.com");
    expect(extractFailedRecipient("Your message to lost@example.com couldn't be delivered")).toBe(
      "lost@example.com"
    );
    expect(extractFailedRecipient("Recipient address rejected: nope@example.com")).toBe("nope@example.com");
  });

  it("returns null when there is nothing to find", () => {
    expect(extractFailedRecipient(null)).toBeNull();
    expect(extractFailedRecipient("")).toBeNull();
    expect(extractFailedRecipient("something went wrong")).toBeNull();
  });
});

describe("classifyBounceKind", () => {
  it("reads the DSN status code", () => {
    expect(classifyBounceKind("Status: 5.1.1")).toBe("hard");
    expect(classifyBounceKind("Status: 4.4.7")).toBe("soft");
  });

  it("falls back to the SMTP reply in the diagnostic code", () => {
    expect(classifyBounceKind("Diagnostic-Code: smtp; 550 mailbox unavailable")).toBe("hard");
    expect(classifyBounceKind("Diagnostic-Code: smtp; 421 try later")).toBe("soft");
  });

  it("reads unambiguous English when no code is present", () => {
    expect(classifyBounceKind("The account has been disabled")).toBe("hard");
    expect(classifyBounceKind("No such user here")).toBe("hard");
  });

  it("degrades the ambiguous case to soft, so nobody is wrongly blamed", () => {
    expect(classifyBounceKind("delivery problem, please retry")).toBe("soft");
    expect(classifyBounceKind(null)).toBe("soft");
  });
});
