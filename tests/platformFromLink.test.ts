import { describe, it, expect } from "vitest";
import { platformFromLink, mainDomain, linkHost } from "@/lib/leads/platformFromLink";

describe("platformFromLink — the platform comes from the link's domain", () => {
  it.each([
    ["https://maps.google.com/?cid=123", "Google"],
    ["https://www.google.com/maps/place/Acme+Plumbing", "Google"],
    ["maps.google.com/maps?q=acme", "Google"],
    ["https://maps.app.goo.gl/AbCdEf", "Google"],
    ["https://goo.gl/maps/xyz", "Google"],
    ["https://g.page/acme-plumbing", "Google"],
    ["https://business.google.com/n/123", "Google"],
    ["https://www.google.co.uk/maps/place/x", "Google"],
    ["https://www.yelp.com/biz/acme-plumbing-raleigh", "Yelp"],
    ["https://m.yelp.com/biz/acme", "Yelp"],
    ["yelp.com/biz/acme", "Yelp"],
    ["https://www.yelp.ca/biz/acme", "Yelp"],
    ["https://www.yelp.co.uk/biz/acme", "Yelp"],
  ])("%s → %s", (link, want) => {
    expect(platformFromLink(link)).toBe(want);
  });

  it("a subdomain never decides it: xyz.abc.com is Abc", () => {
    expect(platformFromLink("https://xyz.abc.com/profile/1")).toBe("Abc");
    expect(platformFromLink("https://shop.business.example.org/x")).toBe("Example");
  });

  it("other platforms by their main domain, in their usual spelling", () => {
    expect(platformFromLink("https://www.facebook.com/acmeplumbing")).toBe("Facebook");
    expect(platformFromLink("https://m.facebook.com/acme")).toBe("Facebook");
    expect(platformFromLink("https://www.linkedin.com/company/acme")).toBe("LinkedIn");
    expect(platformFromLink("https://www.angi.com/companylist/us/nc/acme.htm")).toBe("Angi");
    expect(platformFromLink("https://www.bbb.org/us/nc/raleigh/profile/acme")).toBe("BBB");
    expect(platformFromLink("https://www.homeadvisor.com/rated.Acme.html")).toBe("HomeAdvisor");
    expect(platformFromLink("https://nextdoor.com/pages/acme")).toBe("Nextdoor");
    expect(platformFromLink("https://www.thumbtack.com/nc/raleigh/plumbers/acme")).toBe("Thumbtack");
    expect(platformFromLink("https://www.instagram.com/acme")).toBe("Instagram");
    expect(platformFromLink("https://x.com/acme")).toBe("X");
    expect(platformFromLink("https://maps.apple.com/?q=acme")).toBe("Apple");
  });

  it("not a link: nothing is guessed", () => {
    for (const v of ["", "   ", "acme plumbing", "not a url", "http://", "localhost", "https://192.168.0.1/x"]) {
      expect(platformFromLink(v)).toBeNull();
    }
  });

  it("mainDomain keeps two-part country endings together", () => {
    expect(mainDomain("m.yelp.co.uk")).toBe("yelp.co.uk");
    expect(mainDomain("a.b.c.com")).toBe("c.com");
    expect(mainDomain("example.com")).toBe("example.com");
  });

  it("linkHost drops www and lowercases", () => {
    expect(linkHost("HTTPS://WWW.Yelp.COM/biz/x")).toBe("yelp.com");
  });
});
