// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { fakeHostEnv, installFakeHosts, withEnv } from "./helpers/fakeSiteHosts";
import { isProtectedSite, resolveSite } from "@/lib/sedcms/files";

/**
 * Protected company domains are never the CMS's to touch (the security
 * review's M4, its probe-protected-staging inverted). Every name a site is
 * served under is checked: the host, its apex and its www. twin. A staging
 * site is checked against every entry but the staging apex itself, so a
 * protected subdomain of DA_DOMAIN stays protected.
 */

let restore: () => void = () => {};
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
});

describe("protected domains, after a staging match", () => {
  it("a protected subdomain of DA_DOMAIN is refused, and other staging sites are not", async () => {
    restore = withEnv({ ...fakeHostEnv(), PROTECTED_DOMAINS: "sedsolutions.online,aqhsn.com,agency-demo.dmviral.com" });
    expect(await resolveSite("agency-demo.dmviral.com")).toMatchObject({ ok: false, status: 403, code: "PROTECTED" });
    expect(await resolveSite("acme-roofing.dmviral.com")).toMatchObject({ ok: true, kind: "staging", sub: "acme-roofing" });
  });

  it("the staging apex in PROTECTED_DOMAINS (it is always protected) protects only itself", async () => {
    restore = withEnv({ ...fakeHostEnv(), PROTECTED_DOMAINS: "dmviral.com,sedsolutions.online" });
    installFakeHosts();
    expect(await resolveSite("acme-roofing.dmviral.com")).toMatchObject({ ok: true, kind: "staging" });
    expect(await resolveSite("dmviral.com")).toMatchObject({ ok: false, code: "PROTECTED" });
    expect(await resolveSite("www.dmviral.com")).toMatchObject({ ok: false, code: "PROTECTED" });
  });

  it("an entry above the staging apex covers it all", () => {
    restore = withEnv({ ...fakeHostEnv(), DA_DOMAIN: "sites.sedsolutions.online", PROTECTED_DOMAINS: "sedsolutions.online" });
    expect(isProtectedSite("acme.sites.sedsolutions.online")).toBe(true);
  });
});

describe("protected domains, by every name of a site", () => {
  it("an entry written as www.<domain> protects <domain> too", async () => {
    restore = withEnv({ ...fakeHostEnv(), PROTECTED_DOMAINS: "www.agency-site.com" });
    installFakeHosts({ websites: [{ domain: "agency-site.com", username: "u1" }] });
    expect(await resolveSite("agency-site.com")).toMatchObject({ ok: false, status: 403, code: "PROTECTED" });
    expect(await resolveSite("www.agency-site.com")).toMatchObject({ ok: false, status: 403, code: "PROTECTED" });
  });

  it("an entry written as <domain> protects www.<domain> and its subdomains", async () => {
    restore = withEnv({ ...fakeHostEnv(), PROTECTED_DOMAINS: "agency-site.com" });
    installFakeHosts({ websites: [{ domain: "agency-site.com", username: "u1" }, { domain: "shop.agency-site.com", username: "u1" }] });
    for (const host of ["agency-site.com", "www.agency-site.com", "shop.agency-site.com", "www.shop.agency-site.com"]) {
      expect(await resolveSite(host), host).toMatchObject({ ok: false, code: "PROTECTED" });
    }
  });

  it("nothing is asked of the hosting for a protected site", async () => {
    restore = withEnv({ ...fakeHostEnv(), PROTECTED_DOMAINS: "www.agency-site.com" });
    const hosts = installFakeHosts({ websites: [{ domain: "agency-site.com", username: "u1" }] });
    await resolveSite("agency-site.com");
    expect(hosts.calls).toHaveLength(0);
  });

  it("an unrelated domain that only shares a suffix is not protected", async () => {
    restore = withEnv({ ...fakeHostEnv(), PROTECTED_DOMAINS: "agency-site.com" });
    installFakeHosts({ websites: [{ domain: "myagency-site.com", username: "u1" }] });
    expect(await resolveSite("myagency-site.com")).toMatchObject({ ok: true, kind: "custom" });
    expect(isProtectedSite("www.myagency-site.com")).toBe(false);
  });
});
