"use client";

import { useEffect, useState } from "react";

/** Whether the current user has a verified linked mailbox (drives nav visibility). */
export function useHasMailbox(): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/mail/status")
      .then((r) => r.json())
      .then((d: { hasMailbox: boolean }) => { if (alive) setHas(!!d.hasMailbox); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return has;
}
