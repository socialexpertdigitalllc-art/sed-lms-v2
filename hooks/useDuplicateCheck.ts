"use client";

import { useEffect, useRef, useState } from "react";
import type { Collision } from "@/lib/leads/duplicate";

export function useDuplicateCheck(
  endpoint: string,
  input: { business_name?: string; phone?: string; email?: string }
) {
  const [collisions, setCollisions] = useState<Collision[]>([]);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = `${input.business_name ?? ""}|${input.phone ?? ""}|${input.email ?? ""}`;

  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    if (!input.business_name && !input.phone && !input.email) {
      setCollisions([]);
      return;
    }
    t.current = setTimeout(async () => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const json = await res.json();
        setCollisions(json.collisions ?? []);
      } catch {
        /* fail-soft: server re-checks on submit */
      }
    }, 500);
    return () => {
      if (t.current) clearTimeout(t.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, endpoint]);

  return collisions;
}
