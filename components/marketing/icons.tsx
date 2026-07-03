// Minimal inline line-icons (24x24, 1.6 stroke) — no external icon dependency.
type P = { className?: string };
const base = (className?: string) => ({
  className,
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconLeads = ({ className }: P) => (
  <svg {...base(className)}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <rect x="3" y="10" width="18" height="4" rx="1" />
    <rect x="3" y="16" width="11" height="4" rx="1" />
  </svg>
);

export const IconShield = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    <path d="M9.5 12l1.8 1.8L15 10" />
  </svg>
);

export const IconChart = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <rect x="7" y="11" width="3" height="6" rx="0.5" />
    <rect x="12.5" y="7" width="3" height="10" rx="0.5" />
    <rect x="18" y="13" width="3" height="4" rx="0.5" />
  </svg>
);

export const IconSparkles = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
    <path d="M18 14l.7 1.9L20.5 16.5l-1.8.7L18 19l-.7-1.8L15.5 16.5l1.8-.6L18 14z" />
  </svg>
);

export const IconLayers = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);

export const IconHistory = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v4h4" />
    <path d="M12 8v4l3 2" />
  </svg>
);

export const IconKey = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="8" cy="14" r="4" />
    <path d="M11 11l9-9" />
    <path d="M17 5l2 2" />
    <path d="M14 8l2 2" />
  </svg>
);

export const IconDatabase = ({ className }: P) => (
  <svg {...base(className)}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </svg>
);

export const IconArrowRight = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);

export const IconCheck = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M5 12.5l4 4 10-10" />
  </svg>
);
