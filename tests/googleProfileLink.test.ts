// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isGoogleProfileLink } from "@/lib/photo-capture/googleLink";

describe("isGoogleProfileLink", () => {
  it("accepts a maps place url", () => {
    expect(isGoogleProfileLink("https://www.google.com/maps/place/Joe+Plumbing/@40.7,-73.9,17z")).toBe(true);
  });

  it("accepts a country-domain maps url", () => {
    expect(isGoogleProfileLink("https://www.google.co.uk/maps/place/Acme+Ltd")).toBe(true);
  });

  it("accepts a maps.google.com url", () => {
    expect(isGoogleProfileLink("https://maps.google.com/?cid=1234567890")).toBe(true);
  });

  it("accepts a shortened maps.app.goo.gl link", () => {
    expect(isGoogleProfileLink("https://maps.app.goo.gl/AbCdEf123")).toBe(true);
  });

  it("accepts a g.page short link", () => {
    expect(isGoogleProfileLink("https://g.page/acme-plumbing")).toBe(true);
  });

  it("rejects a Yelp link", () => {
    expect(isGoogleProfileLink("https://www.yelp.com/biz/acme-plumbing")).toBe(false);
  });

  it("rejects a plain website", () => {
    expect(isGoogleProfileLink("https://acmeplumbing.com")).toBe(false);
  });

  it("rejects google search and other google properties", () => {
    expect(isGoogleProfileLink("https://www.google.com/search?q=acme")).toBe(false);
  });

  it("rejects blank, null and junk", () => {
    expect(isGoogleProfileLink("")).toBe(false);
    expect(isGoogleProfileLink(null)).toBe(false);
    expect(isGoogleProfileLink("not a url")).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isGoogleProfileLink("  https://maps.app.goo.gl/xyz  ")).toBe(true);
  });

  it("rejects a path that merely starts with the letters 'maps'", () => {
    expect(isGoogleProfileLink("https://www.google.com/mapsfoo")).toBe(false);
    expect(isGoogleProfileLink("https://www.google.com/mapsomething/place/x")).toBe(false);
  });

  it("accepts the bare /maps path and /maps/ subpaths", () => {
    expect(isGoogleProfileLink("https://www.google.com/maps")).toBe(true);
    expect(isGoogleProfileLink("https://www.google.com/maps/place/Acme")).toBe(true);
  });

  it("ignores a google URL smuggled into another host's query string", () => {
    expect(isGoogleProfileLink("https://evil.com/?x=https://www.google.com/maps/place/x")).toBe(false);
  });

  it("rejects non-http protocols", () => {
    expect(isGoogleProfileLink("javascript:alert(1)")).toBe(false);
    expect(isGoogleProfileLink("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects lookalike domains that merely start with google.", () => {
    expect(isGoogleProfileLink("https://google.com.evil.com/maps/place/x")).toBe(false);
    expect(isGoogleProfileLink("https://google.evil.com/maps")).toBe(false);
    expect(isGoogleProfileLink("https://maps.google.evil.com/maps")).toBe(false);
    expect(isGoogleProfileLink("https://google.attacker.tld/maps")).toBe(false);
  });

  it("still accepts genuine Google country domains", () => {
    expect(isGoogleProfileLink("https://www.google.com/maps/place/Acme")).toBe(true);
    expect(isGoogleProfileLink("https://www.google.co.uk/maps/place/Acme")).toBe(true);
    expect(isGoogleProfileLink("https://www.google.de/maps/place/Acme")).toBe(true);
    expect(isGoogleProfileLink("https://www.google.com.au/maps/place/Acme")).toBe(true);
    expect(isGoogleProfileLink("https://maps.google.com/?cid=123")).toBe(true);
  });

  it("accepts any short alphabetic TLD — a deliberate trade-off", () => {
    // Enumerating Google's ~190 ccTLDs would be worse to maintain and would
    // break whenever the list changes, so the shape is matched instead. The
    // residual risk is bounded: a URL only ever gets opened in the operator's
    // own browser, and the extension harvests nothing on a non-Google host.
    expect(isGoogleProfileLink("https://www.google.xyz/maps/place/x")).toBe(true);
  });
});
