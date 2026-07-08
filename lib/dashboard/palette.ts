// Plain (server-safe) shared chart color data. Kept OUT of the "use client"
// Charts module so server components (the dashboard page) can import and
// iterate these values — importing a plain value from a client module yields
// a client *reference*, not the value, so `.filter`/indexing fails on the server.

export const STATUS_COLORS: Record<string, string> = {
  Ready: "#15803D",
  "Not Ready": "#D97706",
  Closed: "#7E22CE",
  Dropped: "#DC2626",
  "Long Term": "#1D4ED8",
};

export const STATUS_LEGEND = Object.entries(STATUS_COLORS).map(([name, color]) => ({
  name,
  color,
}));

export const PALETTE = ["#0D9488", "#2563EB", "#7E22CE", "#D97706", "#0EA5E9"];
export const SITE_PALETTE = PALETTE;
