"use client";

import { useEffect, useState } from "react";

const COMMON_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Istanbul",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const STORAGE_KEY = "sed.worldClocks";
const MAX_CLOCKS = 3;

function zoneLabel(zone: string): string {
  const seg = zone.split("/").pop() ?? zone;
  return seg.replace(/_/g, " ");
}

function formatTime(zone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
  } catch {
    return "—";
  }
}

function formatZoneDate(zone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(now);
  } catch {
    return "—";
  }
}

export function WorldClocks() {
  const [zones, setZones] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>(COMMON_ZONES[0]);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setZones(parsed.filter((z): z is string => typeof z === "string").slice(0, MAX_CLOCKS));
        }
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  function persist(next: string[]) {
    setZones(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage write failures
    }
  }

  function add() {
    if (zones.includes(selected) || zones.length >= MAX_CLOCKS) return;
    persist([...zones, selected]);
  }

  function remove(zone: string) {
    persist(zones.filter((z) => z !== zone));
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">World clocks</h3>
        <span className="text-[10px] uppercase tracking-wide text-text-faint">
          {zones.length}/{MAX_CLOCKS}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
        >
          {COMMON_ZONES.map((z) => (
            <option key={z} value={z}>
              {zoneLabel(z)}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={zones.includes(selected) || zones.length >= MAX_CLOCKS}
          className="bg-accent text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-accent-ink disabled:opacity-60 whitespace-nowrap"
        >
          Add
        </button>
      </div>

      {zones.length === 0 ? (
        <p className="mt-4 text-sm text-text-faint">Add a clock to track a timezone.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border-subtle">
          {zones.map((zone) => (
            <li key={zone} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-text truncate">{zoneLabel(zone)}</div>
                <div className="text-[11px] text-text-faint">{formatZoneDate(zone, now)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm tabular-nums font-semibold text-text">{formatTime(zone, now)}</span>
                <button
                  onClick={() => remove(zone)}
                  aria-label={`Remove ${zoneLabel(zone)}`}
                  className="text-text-faint hover:text-dropped-fg text-sm leading-none px-1"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
