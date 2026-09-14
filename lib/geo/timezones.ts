// lib/geo/timezones.ts
// State → IANA timezone for lead-aware timestamps (form relay emails). States
// that span zones get their DOMINANT zone — close enough for "when did this
// lead come in", and an endpoint can always pin an explicit zone instead.

export const DEFAULT_FORM_TIMEZONE = "America/New_York";

const EASTERN = "America/New_York";
const CENTRAL = "America/Chicago";
const MOUNTAIN = "America/Denver";
const PACIFIC = "America/Los_Angeles";

const STATE_TIMEZONE: Record<string, string> = {
  Alabama: CENTRAL, Alaska: "America/Anchorage", Arizona: "America/Phoenix", Arkansas: CENTRAL,
  California: PACIFIC, Colorado: MOUNTAIN, Connecticut: EASTERN, Delaware: EASTERN,
  "District of Columbia": EASTERN, Florida: EASTERN, Georgia: EASTERN, Hawaii: "Pacific/Honolulu",
  Idaho: MOUNTAIN, Illinois: CENTRAL, Indiana: EASTERN, Iowa: CENTRAL, Kansas: CENTRAL,
  Kentucky: EASTERN, Louisiana: CENTRAL, Maine: EASTERN, Maryland: EASTERN, Massachusetts: EASTERN,
  Michigan: EASTERN, Minnesota: CENTRAL, Mississippi: CENTRAL, Missouri: CENTRAL, Montana: MOUNTAIN,
  Nebraska: CENTRAL, Nevada: PACIFIC, "New Hampshire": EASTERN, "New Jersey": EASTERN,
  "New Mexico": MOUNTAIN, "New York": EASTERN, "North Carolina": EASTERN, "North Dakota": CENTRAL,
  Ohio: EASTERN, Oklahoma: CENTRAL, Oregon: PACIFIC, Pennsylvania: EASTERN, "Rhode Island": EASTERN,
  "South Carolina": EASTERN, "South Dakota": CENTRAL, Tennessee: CENTRAL, Texas: CENTRAL,
  Utah: MOUNTAIN, Vermont: EASTERN, Virginia: EASTERN, Washington: PACIFIC,
  "West Virginia": EASTERN, Wisconsin: CENTRAL, Wyoming: MOUNTAIN,
};

export function timezoneOfState(state: string | null | undefined): string | null {
  return state ? STATE_TIMEZONE[state.trim()] ?? null : null;
}

export function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** Option list for the endpoint editor's custom-timezone select. */
export const US_TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix, no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];
