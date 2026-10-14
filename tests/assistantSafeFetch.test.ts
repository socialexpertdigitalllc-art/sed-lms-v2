// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === "rebind.example.com") return [{ address: "10.0.0.5", family: 4 }];
    if (host === "maps.app.goo.gl") return [{ address: "142.250.72.14", family: 4 }];
    return [];
  }),
}));

const { assertPublicUrl, isPrivateAddress, safeFetch, UnsafeUrlError } = await import("@/lib/assistant/safeFetch");

/**
 * Links the model passes (a "profile link", a pasted listing) are fetched by
 * the server — so they must never reach inside our own network.
 */
describe("safeFetch", () => {
  it("knows private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "142.250.72.14", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses internal addresses, odd ports, credentials and private DNS answers", async () => {
    for (const url of [
      "http://localhost:3000/api/assistant/scheduler",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "https://maps.app.goo.gl:8443/x",
      "https://user:pw@maps.app.goo.gl/x",
      "file:///etc/passwd",
      "http://intranet/",
      "https://rebind.example.com/",
    ]) {
      await expect(assertPublicUrl(url), url).rejects.toBeInstanceOf(UnsafeUrlError);
    }
    await expect(assertPublicUrl("https://maps.app.goo.gl/abc")).resolves.toBeInstanceOf(URL);
  });

  it("re-checks every redirect hop", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
    await expect(safeFetch("https://maps.app.goo.gl/abc")).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });
});
