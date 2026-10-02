// ============================================================
// SED Website Content — local mirror of the future dashboard API
// Shape matches GET /api/public/site-content, /offers, /stats,
// /portfolio, /testimonials. In Phase 4 these exports are replaced
// by live fetches; component code stays untouched.
// ============================================================

export interface PricingTier {
  name: string;
  price: number;
  priceNote: string; // e.g. "one-time" | "/mo" | "/30-min session"
  billingNote: string;
  features: string[];
  badge?: "Popular" | "Recommended";
}

export interface FAQ {
  question: string;
  answer: string;
}

export interface Service {
  slug: string;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  icon: string; // key into the icon map
  features: string[];
  tiers: PricingTier[];
  quoteBased?: boolean;
  startingAt?: string; // shown when quoteBased or as a summary chip
  marketComparison: { label: string; marketPrice: string; ourPrice: string };
  faqs: FAQ[];
}

export const services: Service[] = [
  {
    slug: "website-development",
    name: "Website Development",
    shortName: "Websites",
    tagline: "A hand-built website your customers trust — at a price that makes agencies nervous.",
    description:
      "Custom-coded, mobile-first websites for small businesses. Complete ownership goes to you — no rentals, no lock-in. Built, launched, and ranking in days, not months.",
    icon: "globe",
    features: [
      "100% client ownership",
      "Mobile-first, sub-2s loads",
      "SEO built in from day one",
      "Launched in days",
    ],
    tiers: [
      {
        name: "Starter",
        price: 249,
        priceNote: "one-time",
        billingNote:
          "+ $99/yr domain, hosting & maintenance — $0/yr if you bring your own hosting and domain",
        features: [
          "3–5 custom webpages",
          "Custom gallery / portfolio",
          "SEO optimization",
          "Contact form wired to your email",
          "Complete website ownership",
        ],
      },
      {
        name: "Business",
        price: 549,
        priceNote: "one-time",
        billingNote: "+ $99/yr — domain, hosting & maintenance FREE for the first year",
        badge: "Popular",
        features: [
          "7–10 custom webpages",
          "Dedicated page per service",
          "1 custom business domain email",
          "Custom dashboard on request",
          "Specialized SEO optimization",
          "Everything in Starter",
        ],
      },
      {
        name: "Growth",
        price: 999,
        priceNote: "one-time",
        billingNote: "+ $99/yr — 39% off domain, hosting & maintenance for the first year",
        badge: "Recommended",
        features: [
          "15+ custom webpages",
          "Trained AI chatbot on your site",
          "Everything in Business",
        ],
      },
    ],
    marketComparison: {
      label: "US agencies charge for a comparable custom site",
      marketPrice: "$2,500–$10,000",
      ourPrice: "from $249",
    },
    faqs: [
      {
        question: "Do I really own the website?",
        answer:
          "Yes — completely. Code, content, domain, everything is yours. If you ever leave, you take the whole site with you. No rental model, no hostage situations.",
      },
      {
        question: "How fast can you launch?",
        answer:
          "Most Starter and Business sites go live within 5–7 business days of receiving your content. We launch 5–10 client sites every month.",
      },
      {
        question: "What if I already have hosting and a domain?",
        answer:
          "Then the yearly fee is $0 on the Starter plan. We build on your infrastructure and hand over the keys.",
      },
    ],
  },
  {
    slug: "seo",
    name: "GMB & Website SEO",
    shortName: "SEO",
    tagline: "Show up when your neighbors search. Month-to-month — we earn the renewal.",
    description:
      "Google Business Profile optimization and website SEO for local businesses. No 12-month contracts — every month is performance-based. If we don't perform, you don't renew.",
    icon: "chart",
    features: [
      "Month-to-month, no lock-in",
      "Performance-based renewals",
      "Google Business Profile mastery",
      "Local keyword domination",
    ],
    tiers: [
      {
        name: "GBP Essentials",
        price: 250,
        priceNote: "/mo",
        billingNote: "Month-to-month. Performance-based renewal — cancel anytime.",
        features: [
          "Google Business Profile optimization",
          "Citation building & cleanup",
          "Review strategy & monitoring",
          "Monthly ranking report",
        ],
      },
      {
        name: "Local Growth",
        price: 449,
        priceNote: "/mo",
        billingNote: "Month-to-month. Performance-based renewal — cancel anytime.",
        badge: "Recommended",
        features: [
          "Everything in GBP Essentials",
          "On-page website SEO",
          "Local content creation",
          "Link building",
          "Competitor tracking & monthly strategy call",
        ],
      },
    ],
    marketComparison: {
      label: "Typical US local SEO retainers run",
      marketPrice: "$500–$1,500/mo with 6–12 month contracts",
      ourPrice: "from $250/mo, no contract",
    },
    faqs: [
      {
        question: "Why month-to-month when everyone else demands contracts?",
        answer:
          "Because results keep clients better than paperwork does. Each month you see the report and decide. That accountability is the product.",
      },
      {
        question: "How long until I see results?",
        answer:
          "GBP improvements often show within 2–4 weeks. Meaningful map-pack and organic movement typically takes 60–90 days depending on your market's competition.",
      },
    ],
  },
  {
    slug: "ai-voice-assistant",
    name: "AI Voice Assistant",
    shortName: "Social Expert AI",
    tagline: "Your website answers questions out loud — and books the job while you work.",
    description:
      "Social Expert AI is our in-house voice assistant for websites. It greets visitors, answers questions about your business in natural speech, captures leads, and never takes a day off.",
    icon: "mic",
    features: [
      "Trained on YOUR business",
      "Natural voice conversations",
      "Captures leads 24/7",
      "Live demo on this site",
    ],
    tiers: [
      {
        name: "Monthly",
        price: 299,
        priceNote: "/mo",
        billingNote: "1-month plan",
        features: ["Full voice assistant", "Trained on your business", "Lead capture & notifications"],
      },
      {
        name: "Quarterly",
        price: 599,
        priceNote: "/3 mo",
        billingNote: "Effectively $200/mo",
        badge: "Popular",
        features: ["Everything in Monthly", "FREE 1-page landing page", "Priority retraining"],
      },
      {
        name: "Annual",
        price: 1599,
        priceNote: "/yr",
        billingNote: "Effectively $133/mo",
        badge: "Recommended",
        features: ["Everything in Quarterly", "FREE 5-page website", "Quarterly performance reviews"],
      },
    ],
    marketComparison: {
      label: "Comparable voice AI platforms charge",
      marketPrice: "$99–$349/mo + setup fees",
      ourPrice: "$133–$299/mo, site included",
    },
    faqs: [
      {
        question: "Can I hear it before I buy?",
        answer: "Yes — the assistant on this very website is Social Expert AI. Ask it anything about our services.",
      },
      {
        question: "How is it trained on my business?",
        answer:
          "We feed it your services, pricing, hours, service area, and FAQ answers. It only speaks from your approved information.",
      },
    ],
  },
  {
    slug: "ai-receptionist",
    name: "AI Receptionist",
    shortName: "AI Receptionist",
    tagline: "Every missed call is a job your competitor booked. Stop missing them.",
    description:
      "A phone receptionist powered by AI that answers every call, qualifies the customer, books appointments, and texts you the summary — around the clock, for less than a part-time hire.",
    icon: "phone",
    features: [
      "Answers every call, 24/7",
      "Books appointments",
      "Instant call summaries to your phone",
      "Fraction of a human hire's cost",
    ],
    tiers: [],
    quoteBased: true,
    startingAt: "Custom quote — tell us about your call volume",
    marketComparison: {
      label: "US AI receptionist services typically run",
      marketPrice: "$109–$299/mo",
      ourPrice: "quoted to your call volume",
    },
    faqs: [
      {
        question: "What happens on complex calls?",
        answer:
          "The receptionist takes a detailed message, flags the call as priority, and can forward genuinely urgent calls to your cell.",
      },
    ],
  },
  {
    slug: "custom-dashboards",
    name: "Custom Company Dashboards",
    shortName: "Dashboards",
    tagline: "Your own CRM — one price, your domain, no per-seat fees eating your margin.",
    description:
      "A lead pipeline, analytics, and operations dashboard configured for your company and running on your own domain. Own your system instead of renting seats from HubSpot forever.",
    icon: "layout",
    features: [
      "Lead pipeline & KPIs",
      "No per-user monthly fees",
      "Runs on your domain",
      "Grows with custom features",
    ],
    tiers: [
      {
        name: "Operations",
        price: 669,
        priceNote: "one-time",
        billingNote:
          "+ $120/yr domain, hosting & upkeep · maintenance from $39/mo · infra (database etc.) billed at cost",
        features: [
          "Lead management pipeline",
          "Analytics dashboard + KPIs",
          "Mailbox integration",
          "10 users included",
          "Bug fixes & UI adjustments (3×/mo)",
        ],
      },
      {
        name: "Company",
        price: 959,
        priceNote: "one-time",
        billingNote:
          "+ $120/yr · maintenance from $39/mo (full care $100/mo) · unlimited users +$299/yr · payment gateway +$99",
        badge: "Recommended",
        features: [
          "Everything in Operations",
          "25 users included",
          "Contract management",
          "Asset & department management",
          "Invoice management",
          "1 custom feature included",
        ],
      },
    ],
    quoteBased: false,
    startingAt: "Custom feature add-ons from $149 each",
    marketComparison: {
      label: "A custom-built CRM from a US dev shop starts at",
      marketPrice: "$8,000–$15,000",
      ourPrice: "from $669",
    },
    faqs: [
      {
        question: "How is this different from HubSpot or Salesforce?",
        answer:
          "Those charge per user, per month, forever — $30–$100+ per seat. You pay once, own the system, and add exactly the features your company needs from $149 each.",
      },
      {
        question: "What does maintenance cover?",
        answer:
          "From $39/mo: bug fixes and UI adjustments. The $100/mo full-care plan adds regular updates, monitoring, and priority turnaround. Software needs upkeep — we say so upfront.",
      },
    ],
  },
  {
    slug: "custom-saas",
    name: "Custom SaaS Products",
    shortName: "SaaS",
    tagline: "Have a product idea? We take it from napkin sketch to paying subscribers.",
    description:
      "Full product design, development, and launch for SaaS ideas — multi-tenant architecture, billing, dashboards, the works. Scoped and quoted per project.",
    icon: "box",
    features: [
      "Idea → launched product",
      "Subscriptions & billing built in",
      "Scales with your users",
      "You own the code",
    ],
    tiers: [],
    quoteBased: true,
    startingAt: "Scoped per project — book a free discovery call",
    marketComparison: {
      label: "Example: a booking SaaS MVP we'd scope around",
      marketPrice: "dev-shop quotes $25,000+",
      ourPrice: "a fraction — scoped honestly",
    },
    faqs: [
      {
        question: "What do you need from me to give a quote?",
        answer:
          "A description of the problem, who pays for the solution, and the 3–5 features version one truly needs. We respond with a scoped plan and a real number.",
      },
    ],
  },
  {
    slug: "developer-consultancy",
    name: "Developer Consultancy",
    shortName: "Consultancy",
    tagline: "A senior developer on the phone in minutes — pay only for the time you use.",
    description:
      "One-on-one sessions with a senior developer. Architecture reviews, tech decisions, code walkthroughs, vendor sanity-checks — straight answers, billed by the half hour.",
    icon: "headset",
    features: [
      "Senior-level expertise",
      "No retainers required",
      "Screen-share sessions",
      "Straight answers, fast",
    ],
    tiers: [
      {
        name: "Session",
        price: 60,
        priceNote: "/30-min session",
        billingNote: "$120/hr equivalent · 30-minute minimum · extend in 10-min blocks ($20)",
        features: [
          "Video or phone session",
          "Screen-share & live code review",
          "Written summary of recommendations",
          "Book same-week",
        ],
      },
    ],
    marketComparison: {
      label: "Senior US freelance developers average",
      marketPrice: "$128/hr",
      ourPrice: "$120/hr, no minimum retainer",
    },
    faqs: [
      {
        question: "What topics are fair game?",
        answer:
          "Anything software: stack choices, architecture, debugging strategy, hiring dev vendors, reviewing quotes you've received, AI integration — if it's code, it's in scope.",
      },
    ],
  },
  {
    slug: "product-debugging",
    name: "Commercial Product Debugging",
    shortName: "Debugging",
    tagline: "Production is on fire and your dev is unreachable. We pick up.",
    description:
      "Diagnosis and repair for commercial software products — websites, apps, plugins, integrations. We find the root cause, fix it, and document what happened.",
    icon: "bug",
    features: [
      "Root-cause diagnosis",
      "Production-safe fixes",
      "Written post-mortem",
      "Fast turnaround",
    ],
    tiers: [],
    quoteBased: true,
    startingAt: "Quoted after a free 15-minute triage call",
    marketComparison: {
      label: "Emergency dev-shop hourly rates run",
      marketPrice: "$150–$275/hr",
      ourPrice: "flat quotes, no meter running",
    },
    faqs: [
      {
        question: "My original developer disappeared. Can you take over?",
        answer:
          "Yes — inherited codebases are most of what we debug. We triage first, quote a flat price, then fix and document so you're never stranded again.",
      },
    ],
  },
  {
    slug: "plugin-development",
    name: "Custom Plugin Development",
    shortName: "Plugins",
    tagline: "Chrome extensions and WordPress plugins built exactly to your workflow.",
    description:
      "Custom Chrome extensions and WordPress plugins — from a simple workflow tool for your team to a polished product you sell. Scoped flat, from $299.",
    icon: "puzzle",
    features: [
      "Chrome extensions",
      "WordPress plugins",
      "Flat-price quotes",
      "From $299",
    ],
    tiers: [],
    quoteBased: true,
    startingAt: "from $299 — scoped flat after a short call",
    marketComparison: {
      label: "Typical US quotes for a basic custom plugin",
      marketPrice: "$500–$2,000",
      ourPrice: "from $299",
    },
    faqs: [
      {
        question: "Can you build something my whole team uses internally?",
        answer:
          "That's the most common request — internal Chrome extensions that automate a repetitive workflow. Describe the workflow; we'll quote it flat.",
      },
    ],
  },
];

// ---- Offers / promo banner (mirror of GET /api/public/offers) ----
export interface Offer {
  title: string;
  bannerText: string;
  serviceSlug: string | null; // null = sitewide
  active: boolean;
}

export const offers: Offer[] = [
  {
    title: "Launch offer",
    bannerText:
      "Summer launch: FREE first-year hosting & maintenance on every Business plan website →",
    serviceSlug: "website-development",
    active: true,
  },
];

// ---- Live stats (mirror of GET /api/public/stats) ----
export const stats = {
  sitesLaunched: 100,
  activeClients: 80,
  statesServed: 12,
  yearsActive: 2,
};

// ---- Portfolio sample (mirror of GET /api/public/portfolio) ----
export interface PortfolioItem {
  clientName: string;
  industry: string;
  state: string;
  liveUrl: string;
  featured: boolean;
  /** Optional screenshot path. Cards render a typographic mock when absent. */
  screenshot?: string;
}

// NOTE: business names, industries, and states below were inferred from the
// live domain names on the Hostinger account. VERIFY each entry (especially
// state) before launch — these become public claims about real clients.
// Entries with state "" simply don't show a state chip.
export const portfolio: PortfolioItem[] = [
  { clientName: "Katy Kinetic Plumbing", industry: "Plumbing", state: "TX", liveUrl: "https://katykineticplumbing.com", featured: true },
  { clientName: "Victory Auto Glass", industry: "Auto Glass", state: "TX", liveUrl: "https://victoryautoglasstx.com", featured: true },
  { clientName: "Sacred Steel", industry: "Metal Fabrication", state: "AZ", liveUrl: "https://sacredsteelaz.com", featured: true },
  { clientName: "Brick Brothers Masonry", industry: "Masonry", state: "", liveUrl: "https://brickbrothersmasonry.com", featured: true },
  { clientName: "SRJ HVAC", industry: "HVAC", state: "", liveUrl: "https://srjhvac.com", featured: true },
  { clientName: "Tint Monster", industry: "Window Tinting", state: "CA", liveUrl: "https://tintmonsterlb.com", featured: true },
  { clientName: "Carter Family Towing", industry: "Towing", state: "", liveUrl: "https://carterfamilytowing.com", featured: true },
  { clientName: "The Drywall Pro", industry: "Drywall", state: "", liveUrl: "https://thedrywallpro.com", featured: true },
  { clientName: "Handyman In San Antonio", industry: "Handyman", state: "TX", liveUrl: "https://handymaninsanantonio.com", featured: true },
  { clientName: "Brooklyn Appliance Repairs", industry: "Appliance Repair", state: "NY", liveUrl: "https://brooklynappliancerepairs.com", featured: true },
  { clientName: "Appliance Repair in Marietta", industry: "Appliance Repair", state: "GA", liveUrl: "https://appliancerepairinmarietta.com", featured: false },
  { clientName: "Staten Island Handyman Service", industry: "Handyman", state: "NY", liveUrl: "https://statenislandhandymanservice.com", featured: false },
  { clientName: "Marlon Ironworks NYC", industry: "Ironwork", state: "NY", liveUrl: "https://marlonironworksnyc.com", featured: true },
  { clientName: "Rite Touch Auto NYC", industry: "Auto Detailing", state: "NY", liveUrl: "https://ritetouchautonyc.com", featured: false },
  { clientName: "Florida Electric Motor Services", industry: "Electrical", state: "FL", liveUrl: "https://floridaelectricmotorservices.com", featured: false },
  { clientName: "Roof Claim TX", industry: "Roofing", state: "TX", liveUrl: "https://roofclaimtx.com", featured: true },
  { clientName: "Tone City Electric", industry: "Electrical", state: "TX", liveUrl: "https://tonecityelectrictx.com", featured: false },
  { clientName: "Fancy Floors Houston", industry: "Flooring", state: "TX", liveUrl: "https://fancyfloorshouston.com", featured: true },
  { clientName: "City Handyman", industry: "Handyman", state: "CA", liveUrl: "https://cityhandymanlb.com", featured: false },
  { clientName: "D&J Painting Richmond", industry: "Painting", state: "VA", liveUrl: "https://dandjpaintingrichmond.com", featured: false },
  { clientName: "Revive Electric", industry: "Electrical", state: "CA", liveUrl: "https://reviveelectricca.com", featured: false },
  { clientName: "Handy Master MA", industry: "Handyman", state: "MA", liveUrl: "https://handymasterma.com", featured: false },
  { clientName: "SA Tech Handyman", industry: "Handyman", state: "TX", liveUrl: "https://satechhandyman.com", featured: false },
  { clientName: "Boom Boom Handyman", industry: "Handyman", state: "GA", liveUrl: "https://boomboomhandymanga.com", featured: false },
  { clientName: "Hammer & Nail DC", industry: "Construction", state: "DC", liveUrl: "https://hammernaildc.com", featured: true },
  { clientName: "East Coast Prime Floors", industry: "Flooring", state: "", liveUrl: "https://eastcoastprimefloors.com", featured: false },
  { clientName: "Excel Floor Sanding", industry: "Flooring", state: "", liveUrl: "https://excelfloorsanding.com", featured: false },
  { clientName: "Granada Floors", industry: "Flooring", state: "", liveUrl: "https://granada-floors.com", featured: false },
  { clientName: "Specialty Plumbing", industry: "Plumbing", state: "", liveUrl: "https://specialtyplumbinginc.com", featured: false },
  { clientName: "VC General Construction", industry: "Construction", state: "", liveUrl: "https://vcgeneralconstruction.com", featured: false },
  { clientName: "Steam Dry Carpet Cleaning", industry: "Carpet Cleaning", state: "", liveUrl: "https://steamdrycarpetcleaningaca.net", featured: false },
  { clientName: "Stewart's Carpet Repairs", industry: "Carpet Cleaning", state: "", liveUrl: "https://stewartscarpetrepairs.com", featured: false },
  { clientName: "24/7 Truck & Trailer Repair", industry: "Truck & Fleet", state: "", liveUrl: "https://247trucktrailerrepair.com", featured: true },
  { clientName: "Powerstroke Diesel Guys", industry: "Truck & Fleet", state: "", liveUrl: "https://powerstrokedieselguys.com", featured: false },
  { clientName: "Sprinter Vans Repair", industry: "Truck & Fleet", state: "", liveUrl: "https://sprintervansrepair.com", featured: false },
  { clientName: "Landa Fleet Maintenance", industry: "Truck & Fleet", state: "", liveUrl: "https://landafleetmaintenance.com", featured: false },
  { clientName: "Lalo's Auto Tint", industry: "Window Tinting", state: "", liveUrl: "https://lalosautotint.com", featured: false },
  { clientName: "Cool's Window Tinting", industry: "Window Tinting", state: "", liveUrl: "https://coolswindowtinting.com", featured: false },
  { clientName: "Stratton Window Tinting", industry: "Window Tinting", state: "", liveUrl: "https://strattonwindowtinting.com", featured: false },
  { clientName: "Omar's Discount Tire", industry: "Tire & Auto", state: "", liveUrl: "https://omarsdiscounttire.com", featured: false },
  { clientName: "Diego's Tires & Alignment", industry: "Tire & Auto", state: "", liveUrl: "https://diegostiresalignment.com", featured: false },
  { clientName: "Brothers Auto Upholstery", industry: "Upholstery", state: "", liveUrl: "https://brothersautoupholstery.com", featured: false },
  { clientName: "Pars Oriental Rug", industry: "Rug Cleaning", state: "", liveUrl: "https://parsorientalrug.com", featured: false },
  { clientName: "La Calavera Tattoo", industry: "Tattoo Studio", state: "", liveUrl: "https://lacalaveratattoo.com", featured: false },
  { clientName: "Ferhat Turan Photography", industry: "Photography", state: "", liveUrl: "https://ferhatturanphotography.com", featured: true },
  { clientName: "Mt Everest Electric", industry: "Electrical", state: "", liveUrl: "https://mteverestelectric.com", featured: false },
  { clientName: "JT Painting & Drywall", industry: "Painting", state: "", liveUrl: "https://jtpaintinganddrywall.com", featured: false },
  { clientName: "HK Drywall Services", industry: "Drywall", state: "", liveUrl: "https://hkdrywallservices.com", featured: false },
  { clientName: "Rich Brothers Bulky Trash", industry: "Junk Removal", state: "", liveUrl: "https://richbrothersbulkytrash.com", featured: false },
  { clientName: "Tony & Son Tile", industry: "Tile", state: "", liveUrl: "https://tonyandsontile.com", featured: false },
  { clientName: "Vicente Carpentry", industry: "Carpentry", state: "", liveUrl: "https://vicentecarpentry.com", featured: false },
];

// ---- Testimonials (mirror of GET /api/public/testimonials) ----
export interface Testimonial {
  clientName: string;
  business: string;
  quote: string;
  rating: number;
}

// Empty until real, verifiable client quotes are collected. The homepage
// automatically shows a verifiable-proof section instead while this is empty,
// and switches to the testimonial cards the moment entries are added.
//
// ONLY add quotes a client actually gave you, attributed to that client.
// Invented testimonials attributed to real businesses violate the FTC Rule on
// Consumer Reviews and Testimonials (16 CFR Part 465) — civil penalties apply
// per violation, and the named businesses can disprove them.
//
// Example of a filled entry:
//   {
//     clientName: "First name + last initial, as the client approved",
//     business: "Their business name",
//     quote: "Their words, lightly trimmed for length but not rewritten.",
//     rating: 5,
//   },
export const testimonials: Testimonial[] = [];

export const company = {
  name: "Social Expert Digital LLC",
  shortName: "Social Expert Digital",
  tagline: "Agency-quality work at software prices. No lock-in contracts.",
  phoneDisplay: "(252) 401-2775",
  phoneHref: "tel:+12524012775",
  email: "socialexpertdigitalllc@gmail.com",
  serviceArea: "United States",
  domain: "https://socialexpertdigitalllc.com",
  // GA4 measurement ID — public by design (it ships in the page HTML).
  gaMeasurementId: "G-B9E0F7QXPD",
};
