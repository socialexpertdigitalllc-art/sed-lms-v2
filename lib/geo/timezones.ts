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

/* ---------------------------------------------------- timezone filter */

/**
 * US timezones as the Leads / HitList "Timezone" filter offers them. A lead's
 * zone comes from its region (custom_area, else the phone's area code → state),
 * with the area codes of split states that sit mostly in the OTHER zone
 * corrected (El Paso is Mountain, Pensacola Central, Knoxville Eastern…).
 */
export const LEAD_ZONES = [
  { key: "eastern", label: "Eastern (ET)", iana: "America/New_York" },
  { key: "central", label: "Central (CT)", iana: "America/Chicago" },
  { key: "mountain", label: "Mountain (MT)", iana: "America/Denver" },
  { key: "arizona", label: "Arizona (MST, no DST)", iana: "America/Phoenix" },
  { key: "pacific", label: "Pacific (PT)", iana: "America/Los_Angeles" },
  { key: "alaska", label: "Alaska (AKT)", iana: "America/Anchorage" },
  { key: "hawaii", label: "Hawaii (HT)", iana: "Pacific/Honolulu" },
] as const;
export type LeadZoneKey = (typeof LEAD_ZONES)[number]["key"] | "unknown";
export const UNKNOWN_ZONE_LABEL = "Unknown";

const ZONE_BY_IANA: Record<string, LeadZoneKey> = Object.fromEntries(LEAD_ZONES.map((z) => [z.iana, z.key]));

/** Area codes in split states whose zone differs from their state's main one. */
const AREA_CODE_ZONE: Record<string, LeadZoneKey> = {
  "915": "mountain", // El Paso, TX
  "850": "central", // Florida panhandle (Pensacola, Panama City)
  "448": "central", // overlay of 850
  "423": "eastern", // Chattanooga / Tri-Cities, TN
  "865": "eastern", // Knoxville, TN
  "270": "central", // western Kentucky
  "364": "central", // overlay of 270
  "219": "central", // northwest Indiana (Gary)
};

/** The timezone group a lead falls in, or "unknown" when its region isn't known. */
export function leadZone(lead: { business_phone: string | null; custom_area?: string | null }, areaCodeOf: (p: string | null) => string | null, stateOf: (lead: { business_phone: string | null; custom_area?: string | null }) => string | null): LeadZoneKey {
  const manual = lead.custom_area?.trim();
  if (!manual) {
    const code = areaCodeOf(lead.business_phone);
    if (code && AREA_CODE_ZONE[code]) return AREA_CODE_ZONE[code];
  }
  const tz = timezoneOfState(stateOf(lead));
  return (tz && ZONE_BY_IANA[tz]) || "unknown";
}

export function zoneLabel(key: string): string {
  return LEAD_ZONES.find((z) => z.key === key)?.label ?? UNKNOWN_ZONE_LABEL;
}
