// @vitest-environment node
import { describe, it, expect } from "vitest";
import { classifyMxRecords, deriveDnsStatus, type LookupOutcome, type MxRecord } from "@/lib/email-verify/dns";

const ok = (records: MxRecord[]): LookupOutcome<MxRecord[]> => ({ kind: "ok", value: records });

describe("email-verify DNS classification", () => {
  describe("null MX (RFC 7505)", () => {
    it("detects a single preference-0 record with a root exchange", () => {
      expect(classifyMxRecords([{ exchange: ".", priority: 0 }])).toEqual({ hasMx: false, nullMx: true });
      expect(classifyMxRecords([{ exchange: "", priority: 0 }])).toEqual({ hasMx: false, nullMx: true });
    });

    it("is not fooled by a real MX at preference 0", () => {
      expect(classifyMxRecords([{ exchange: "mx.example.com", priority: 0 }])).toEqual({ hasMx: true, nullMx: false });
    });

    it("requires a SINGLE record", () => {
      const two = classifyMxRecords([
        { exchange: ".", priority: 0 },
        { exchange: "mx.example.com", priority: 10 },
      ]);
      expect(two).toEqual({ hasMx: true, nullMx: false });
    });

    it("requires preference 0", () => {
      expect(classifyMxRecords([{ exchange: ".", priority: 10 }])).toEqual({ hasMx: false, nullMx: false });
    });
  });

  describe("status derivation", () => {
    it("ok when there is a usable MX", () => {
      expect(deriveDnsStatus({ mx: ok([{ exchange: "mx.example.com", priority: 10 }]), addr: null }).status).toBe("ok");
    });

    it("null_mx blocks", () => {
      expect(deriveDnsStatus({ mx: ok([{ exchange: ".", priority: 0 }]), addr: null }).status).toBe("null_mx");
    });

    it("nxdomain blocks", () => {
      expect(deriveDnsStatus({ mx: { kind: "nxdomain" }, addr: null }).status).toBe("nxdomain");
    });

    it("NODATA on MX falls back to A/AAAA (RFC 5321 implicit MX)", () => {
      const r = deriveDnsStatus({ mx: { kind: "nodata" }, addr: { kind: "ok", value: true } });
      expect(r.status).toBe("ok");
      expect(r.hasAddr).toBe(true);
      expect(r.hasMx).toBe(false);
    });

    it("blocks only when both MX and address are absent", () => {
      expect(deriveDnsStatus({ mx: { kind: "nodata" }, addr: { kind: "ok", value: false } }).status).toBe(
        "no_mx_no_addr"
      );
      expect(deriveDnsStatus({ mx: { kind: "nodata" }, addr: { kind: "nodata" } }).status).toBe("no_mx_no_addr");
    });

    it("an empty MX answer behaves like NODATA", () => {
      expect(deriveDnsStatus({ mx: ok([]), addr: { kind: "ok", value: true } }).status).toBe("ok");
      expect(deriveDnsStatus({ mx: ok([]), addr: { kind: "ok", value: false } }).status).toBe("no_mx_no_addr");
    });

    it("SERVFAIL / timeout is unknown, NEVER a block", () => {
      expect(deriveDnsStatus({ mx: { kind: "unknown" }, addr: null }).status).toBe("unknown");
      expect(deriveDnsStatus({ mx: { kind: "nodata" }, addr: { kind: "unknown" } }).status).toBe("unknown");
    });

    it("an NXDOMAIN discovered during the address fallback still blocks", () => {
      expect(deriveDnsStatus({ mx: { kind: "nodata" }, addr: { kind: "nxdomain" } }).status).toBe("nxdomain");
    });

    it("is unknown when the address lookup was never attempted", () => {
      expect(deriveDnsStatus({ mx: { kind: "nodata" }, addr: null }).status).toBe("unknown");
    });
  });
});
