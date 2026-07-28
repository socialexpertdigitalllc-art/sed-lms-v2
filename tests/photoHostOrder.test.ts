// @vitest-environment node
import { describe, it, expect } from "vitest";
import { orderHosts, PROVIDER_RANK } from "@/lib/photo-capture/hosts/order";
import type { ImageHost } from "@/lib/photo-capture/hosts/types";

function host(p: Partial<ImageHost> & Pick<ImageHost, "id" | "provider">): ImageHost {
  return {
    label: p.id,
    position: 0,
    enabled: true,
    exhaustedUntil: null,
    credentials: { api_key: "k" },
    ...p,
  } as ImageHost;
}

const NOW = new Date("2026-07-28T12:00:00Z");

describe("orderHosts", () => {
  it("puts imgbb before postimages before imgchest", () => {
    expect(PROVIDER_RANK).toEqual({ imgbb: 0, postimages: 1, imgchest: 2 });
    const out = orderHosts(
      [host({ id: "c", provider: "imgchest" }), host({ id: "p", provider: "postimages" }), host({ id: "b", provider: "imgbb" })],
      NOW
    );
    expect(out.map((h) => h.id)).toEqual(["b", "p", "c"]);
  });

  it("orders keys within a provider by position, i.e. the order they were added", () => {
    const out = orderHosts(
      [host({ id: "second", provider: "imgbb", position: 1 }), host({ id: "first", provider: "imgbb", position: 0 })],
      NOW
    );
    expect(out.map((h) => h.id)).toEqual(["first", "second"]);
  });

  it("drops disabled hosts", () => {
    const out = orderHosts([host({ id: "off", provider: "imgbb", enabled: false })], NOW);
    expect(out).toEqual([]);
  });

  it("drops hosts still cooling down", () => {
    const out = orderHosts(
      [host({ id: "cooling", provider: "imgbb", exhaustedUntil: new Date("2026-07-28T12:30:00Z") })],
      NOW
    );
    expect(out).toEqual([]);
  });

  it("readmits a host once its cooldown has passed", () => {
    const out = orderHosts(
      [host({ id: "back", provider: "imgbb", exhaustedUntil: new Date("2026-07-28T11:59:00Z") })],
      NOW
    );
    expect(out.map((h) => h.id)).toEqual(["back"]);
  });

  it("breaks a position tie deterministically by id", () => {
    const out = orderHosts(
      [host({ id: "b", provider: "imgbb" }), host({ id: "a", provider: "imgbb" })],
      NOW
    );
    expect(out.map((h) => h.id)).toEqual(["a", "b"]);
  });
});
