// ============================================================
// Per-service deep-page content: pain points + what's included.
// Keyed by service slug. Will move into the dashboard CMS with
// the rest of the content in Phase 4.
// ============================================================

export interface IncludedItem {
  title: string;
  text: string;
}

export interface ServiceDetail {
  painHeading: string;
  pains: string[];
  included: IncludedItem[];
}

export const serviceDetails: Record<string, ServiceDetail> = {
  "website-development": {
    painHeading: "Sound familiar?",
    pains: [
      "Your only web presence is a Facebook page, and customers who Google you find your competitors instead.",
      "An agency quoted you $4,000 and six weeks — for a five-page site.",
      "You paid a website rental service for years and own nothing to show for it.",
    ],
    included: [
      {
        title: "Custom design for your trade",
        text: "Not a recycled template. Your services, your photos, your service area — designed to make the phone ring.",
      },
      {
        title: "Mobile-first build",
        text: "Most of your customers search on their phone at the kitchen table. Your site loads in under two seconds there.",
      },
      {
        title: "SEO foundations from day one",
        text: "Proper page structure, local keywords, metadata, and Google indexing — baked in, not bolted on later.",
      },
      {
        title: "Lead capture that works",
        text: "Click-to-call buttons, quote forms wired to your email, and your reviews front and center.",
      },
      {
        title: "Complete ownership",
        text: "Code, content, and domain are legally and practically yours. Leave anytime and take everything with you.",
      },
      {
        title: "Launch support",
        text: "We connect your domain, set up business email, submit to Google, and stay on call through launch week.",
      },
    ],
  },
  seo: {
    painHeading: "Why you're not showing up",
    pains: [
      "Your competitors appear in the Google map pack and you don't — that's 40%+ of local clicks going to them.",
      "An SEO company locked you into a 12-month contract and sends reports you can't decipher.",
      "Your Google Business Profile is unclaimed, half-filled, or showing wrong hours.",
    ],
    included: [
      {
        title: "Google Business Profile overhaul",
        text: "Categories, services, photos, posts, Q&A — optimized weekly, because Google rewards active profiles.",
      },
      {
        title: "Citation building & cleanup",
        text: "Consistent name, address, and phone across 40+ directories. Inconsistency is a silent ranking killer.",
      },
      {
        title: "Review engine",
        text: "A simple system that gets happy customers to leave 5-star reviews — the #1 local ranking factor.",
      },
      {
        title: "On-page website SEO",
        text: "Local keyword targeting, service-area pages, and technical fixes on your site (Growth plan).",
      },
      {
        title: "Plain-English monthly report",
        text: "Rankings, calls, direction requests, and what we did — readable in two minutes, no jargon.",
      },
      {
        title: "Month-to-month accountability",
        text: "No annual contract. Every renewal is earned by the previous month's results.",
      },
    ],
  },
  "ai-voice-assistant": {
    painHeading: "Your website is silent. Your visitors have questions.",
    pains: [
      "Visitors land on your site after hours, can't get a quick answer, and bounce to a competitor.",
      "You answer the same five questions — pricing, hours, service area — dozens of times a week.",
      "Chat widgets you've tried felt robotic and went unused.",
    ],
    included: [
      {
        title: "Natural voice conversations",
        text: "Visitors talk to your website like they'd talk to your front desk — and it answers out loud, instantly.",
      },
      {
        title: "Trained exclusively on your business",
        text: "Your services, prices, hours, and policies. It never improvises beyond what you've approved.",
      },
      {
        title: "24/7 lead capture",
        text: "It collects the visitor's name, number, and job details, then notifies you immediately.",
      },
      {
        title: "Retraining included",
        text: "Prices change? New service? We update the assistant — same-week on Quarterly and Annual plans.",
      },
      {
        title: "Try it right now",
        text: "The assistant on this website is the product. Ask it anything about our services — that's the demo.",
      },
    ],
  },
  "ai-receptionist": {
    painHeading: "The math on missed calls",
    pains: [
      "62% of calls to small businesses go unanswered — and 85% of those callers never call back.",
      "You're under a sink or on a roof when the phone rings. The job goes to whoever answers.",
      "A human answering service costs $250–$500/month and still sends calls to voicemail at 2am.",
    ],
    included: [
      {
        title: "Answers every call, every hour",
        text: "Nights, weekends, holidays — your business always picks up on the second ring.",
      },
      {
        title: "Qualifies the customer",
        text: "It asks the right questions: what's the job, where, how urgent — so you know which calls matter.",
      },
      {
        title: "Books directly into your calendar",
        text: "Estimates and appointments scheduled while you work, synced to the calendar you already use.",
      },
      {
        title: "Instant summaries to your phone",
        text: "Every call becomes a text summary with the caller's details — triage your day at a glance.",
      },
      {
        title: "Priced to your call volume",
        text: "Tell us how many calls you get; we quote a flat monthly rate. No per-minute surprises.",
      },
    ],
  },
  "custom-dashboards": {
    painHeading: "Your business runs on sticky notes and seven browser tabs",
    pains: [
      "Leads live in your texts, jobs in a notebook, invoices in a spreadsheet — and things fall through cracks.",
      "HubSpot and Salesforce want $30–$100 per user per month, forever, for features you'll never use.",
      "Off-the-shelf tools force your business to work their way instead of yours.",
    ],
    included: [
      {
        title: "Lead pipeline built for your sales process",
        text: "Your stages, your fields, your workflow — from first call to paid invoice on one screen.",
      },
      {
        title: "Analytics & KPIs that matter to you",
        text: "Revenue, close rate, response time, jobs per crew — the numbers you actually run the business on.",
      },
      {
        title: "Mailbox integration",
        text: "Emails from leads and customers attach to their records automatically.",
      },
      {
        title: "Team access without seat taxes",
        text: "10–25 users included, unlimited for a flat $299/yr. Compare that to per-seat SaaS pricing.",
      },
      {
        title: "Grows feature by feature",
        text: "Need contract management, invoicing, or a customer portal later? Add features from $149 each.",
      },
      {
        title: "Honest maintenance",
        text: "Software needs upkeep — from $39/mo for fixes, $100/mo for full care. We say it upfront.",
      },
    ],
  },
  "custom-saas": {
    painHeading: "You've spotted the gap. Now build the product.",
    pains: [
      "You know your industry's software pain better than any developer — but dev shops quote $50k before listening.",
      "No-code tools got you a prototype that can't take payments, scale, or be sold.",
      "You need a technical partner, not a vendor who disappears after handoff.",
    ],
    included: [
      {
        title: "Discovery & honest scoping",
        text: "We define the smallest version that can earn revenue — and tell you if the idea has a fatal flaw.",
      },
      {
        title: "Full product build",
        text: "Multi-tenant architecture, user accounts, admin panel, and the workflows that make it yours.",
      },
      {
        title: "Subscriptions & billing",
        text: "Stripe-powered plans, trials, and invoicing wired in from day one.",
      },
      {
        title: "Launch infrastructure",
        text: "Hosting, monitoring, backups, and a deployment pipeline — production-grade from the first user.",
      },
      {
        title: "You own the code",
        text: "Full source code and infrastructure access. Your product, your asset, your exit option.",
      },
    ],
  },
  "developer-consultancy": {
    painHeading: "When you need a straight answer from someone who codes",
    pains: [
      "A vendor quoted you $20,000 and you have no way to know if that's fair.",
      "Your developer left and nobody knows how the system works.",
      "You're about to make a tech decision — platform, stack, hire — that's expensive to get wrong.",
    ],
    included: [
      {
        title: "Senior developer, on demand",
        text: "Real production experience across web, AI, and business systems — not a script reader.",
      },
      {
        title: "Screen-share working sessions",
        text: "Walk through code, architecture, or a vendor's proposal together, live.",
      },
      {
        title: "Written recommendations",
        text: "Every session ends with a short written summary of what we advised and why.",
      },
      {
        title: "Pay for minutes, not retainers",
        text: "$60 per 30-minute session, extend in 10-minute blocks. No minimum commitment beyond one session.",
      },
    ],
  },
  "product-debugging": {
    painHeading: "Something's broken and the clock is running",
    pains: [
      "Your checkout, booking flow, or integration broke — and every hour costs you real money.",
      "The developer who built it is unreachable, or the agency wants a full rebuild to 'fix' it.",
      "Emergency dev shops bill $150–$275/hr with the meter running and no end in sight.",
    ],
    included: [
      {
        title: "Free 15-minute triage",
        text: "Describe the problem; we tell you what's likely wrong and what it'll take. No charge to look.",
      },
      {
        title: "Flat-price quote",
        text: "You approve a fixed number before we touch anything. The meter never runs on your anxiety.",
      },
      {
        title: "Root-cause fix, not a patch",
        text: "We find why it broke, fix that, and check for the same class of bug elsewhere.",
      },
      {
        title: "Written post-mortem",
        text: "What broke, why, what we changed, and how to prevent a repeat — documented for whoever comes after.",
      },
      {
        title: "Inherited codebases welcome",
        text: "Most of what we debug was built by someone who's gone. We're used to spelunking.",
      },
    ],
  },
  "plugin-development": {
    painHeading: "The tool you need doesn't exist — yet",
    pains: [
      "Your team wastes hours daily on a repetitive browser task a small extension could automate.",
      "The WordPress plugin you need is abandoned, bloated, or $300/yr for one feature.",
      "Off-the-shelf tools almost fit — but 'almost' costs you every single day.",
    ],
    included: [
      {
        title: "Chrome extensions",
        text: "Workflow automation, data extraction, form filling, internal tools — built to Chrome Web Store standards.",
      },
      {
        title: "WordPress plugins",
        text: "Custom functionality, integrations, and admin tools that survive theme and core updates.",
      },
      {
        title: "Flat-price scoping",
        text: "Describe the workflow; we quote a fixed price from $299. Simple tools stay simple.",
      },
      {
        title: "Publish or keep private",
        text: "Internal team tool or a product you sell — we handle store submission if you want to go public.",
      },
    ],
  },
};
