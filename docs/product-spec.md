# Quick3DQuote — Product Specification

**Status**: Draft v1.0 · **Owner**: PM (Alex) · **Last updated**: 2026-04-21
**Related docs**: `CLAUDE.md` (source of truth), `architecture.md`, `ux-flows.md`, `db-schema.md`

---

## 1. Product vision

Quick3DQuote turns any 3D printing shop's website into an instant-quote storefront in under an hour. A small UK bureau signs up, configures their materials and printers, pastes a single `<script>` tag on their site, and their customers upload STL/OBJ/3MF files, see a 3D preview, pick material and quantity, and pay via Stripe — without a single email thread. We win where RapidQuote3D (£300/mo) over-serves and email-based quoting under-serves: a £50/mo, zero-bullshit widget that looks premium, installs in ten minutes, and converts visitors into paid orders while the shop sleeps.

---

## 2. Primary personas

### 2.1 The Shop Owner (paying customer)

**Who**: Owner-operator of a small UK 3D-printing bureau. Typical revenue £2k–£20k/mo, 1–3 printers (mix of FDM and SLA), 0–2 staff. Ex-engineer, ex-maker, or side-hustle turned full-time. Technically literate enough to paste a script tag and edit a Shopify theme, not a developer. Currently quotes by email — screenshots of STLs, back-of-envelope maths, 1–3 day turnaround on quotes, loses ~40% of enquiries to slow response.

**Pain points**:
- Every quote email takes 10–20 minutes of measuring, pricing, replying.
- Customers ghost after the quote arrives — no sense of conversion rate.
- RapidQuote3D exists but £300/mo is unjustifiable at £5k/mo revenue.
- No time or skill to build a custom quoting tool in-house.

**Goals**: More paid orders per hour worked. Look professional next to bigger competitors. Stop answering "how much for this?" emails on Sunday night.

### 2.2 The End Customer (widget user)

Broad and bimodal. Three sub-types matter:

- **Hobbyist / maker** — prints cosplay, tabletop minis, repair parts. Price-sensitive, uploads one file, orders 1–2 units, pays under £50. High volume of enquiries, low margin.
- **Product-design student / indie designer** — iterating prototypes. Uploads multiple versions, cares about surface finish and material options, orders 1–5 units, pays £30–£200. Medium volume, medium margin.
- **Professional user (dental lab tech, small manufacturer, architect)** — uploads production-intent geometry, often in batches. Cares about turnaround and repeatability. Orders £100–£2000, repeat customer. Low volume, high margin — the shop's best customers.

**Shared needs**: fast answer, visible 3D preview so they trust the shop "got the file", clear pricing breakdown, pay now or get quoted now.

**Shared fears**: uploading a proprietary design, getting a wrong quote, the file being unprintable and only finding out after payment.

### 2.3 Secondary personas

- **Internal admin (us)** — one of the founding team. Needs to impersonate any shop, suspend abusive accounts, see billing health, diagnose failed quotes. Low volume, high stakes.
- **Support (us, for now)** — answers shop onboarding questions, triages widget bugs reported by shops or their customers. Needs a shop-scoped timeline of events to reproduce issues without asking for ten screenshots.

---

## 3. Jobs-to-be-done

- **Shop Owner**: "When a visitor lands on my site with a printable file, help me turn them into a paid order without me touching my inbox — so I can spend my time printing, not quoting."
- **End Customer (hobbyist/student)**: "When I've designed or downloaded a part, help me find out in under a minute whether a local shop can print it, what it'll cost, and let me pay now — so I don't have to email three shops and wait two days."
- **End Customer (professional)**: "When I need a production-quality part, help me verify the shop can handle my geometry and material, and give me a firm price I can expense today — so I can keep my project on schedule."
- **Internal admin**: "When a shop reports an issue, help me reproduce their exact state and fix it without needing a screen-share — so support scales past 20 shops without hiring."
- **Support**: "When a customer's quote looks wrong, help me see the file, the pricing inputs, and the calc output side-by-side — so I can tell the shop 'your throughput is set to 2 cm³/hr, change it to 12' in one reply."

---

## 4. MVP user stories

Priority key: **MUST** (shipped in v1.0), **SHOULD** (ship if capacity), **COULD** (nice-to-have, defer if tight).

### Shop-side

| # | Story | Acceptance Criteria | Priority |
|---|---|---|---|
| S1 | As a shop owner, I can sign up with email + password or Google so I can start configuring my shop. | Account created in Supabase; redirected to subscribe step; verification email sent for email/password flow. | MUST |
| S2 | As a shop owner, I can subscribe to the £50/mo plan via Stripe Checkout so I can unlock the dashboard. | Stripe subscription active; webhook flips `shops.subscription_status = active`; dashboard accessible; failed payment → dashboard locked with banner within 24h. | MUST |
| S3 | As a shop owner, I can add, edit, and deactivate materials (name, process, £/cm³, density, colour hex) so my customers see accurate options. | Form validates positive numbers; hex format enforced; inactive materials hidden from widget; change visible in widget within 60s (cache TTL). | MUST |
| S4 | As a shop owner, I can set per-process rates (hourly, setup, min order, markup %, turnaround days) so quotes match my real costs. | Each field has sensible defaults (FDM 12 cm³/hr, SLA 18 cm³/hr); form rejects negatives; changes live within 60s. | MUST |
| S5 | As a shop owner, I can upload my logo, set a shop name and accent colour so the widget looks like my brand. | Logo stored in R2, max 2MB PNG/SVG; accent colour applied to widget primary button and price text; preview renders before save. | MUST |
| S6 | As a shop owner, I can copy my embed `<script>` snippet with one click so I can paste it into my website. | Snippet includes public `shop_key`; copy-to-clipboard with confirmation toast; one-page install guide linked (Shopify, WordPress, raw HTML). | MUST |
| S7 | As a shop owner, I can view all quotes in an inbox with filters (status, date, customer) so I can manage orders. | Paginated table; columns: date, customer email, material, total, status; status editable (quoted → paid → in-production → shipped → cancelled); signed download URL valid 24h. | MUST |
| S8 | As a shop owner, I receive an email when a customer pays so I don't miss new orders. | Email fires within 30s of Stripe `payment_intent.succeeded`; contains customer contact, material, qty, total, file download link. | MUST |
| S9 | As a shop owner, I can preview my own widget on a test page so I can sanity-check before going live. | `/dashboard/embed/preview` renders live widget using current settings; changes to materials/branding reflect within 60s. | SHOULD |
| S10 | As a shop owner, I can see my subscription status and update my payment method so I don't get surprise lock-outs. | Stripe Customer Portal link; current period end visible; cancel option documented. | SHOULD |
| S11 | As a shop owner, I can export quotes as CSV so I can do my own reporting. | CSV includes all inbox columns; downloads within 5s for <5k rows. | COULD |

### Customer-side (widget)

| # | Story | Acceptance Criteria | Priority |
|---|---|---|---|
| C1 | As a customer, I can drag-drop or click-to-upload an STL/OBJ/3MF file so the shop can quote it. | Accepts files up to 100MB; rejects other extensions with friendly message; presigned upload direct to R2; progress bar shown; upload completes in <15s on 50 Mbps for a 50MB file. | MUST |
| C2 | As a customer, I can see my model rendered in 3D with dimensions so I trust the shop has the right file. | react-three-fiber render within 3s of upload complete; orbit controls (rotate, zoom, pan); bounding-box dimensions in mm overlaid; auto-centres and auto-scales camera. | MUST |
| C3 | As a customer, I can pick a material, colour variant and quantity and see the price update live. | Material dropdown shows only active materials for shop; colour swatches from material config; quantity stepper 1–100; price recalculates in <500ms on any change; clearly shows per-unit and total. | MUST |
| C4 | As a customer, I can see a price breakdown (material, machine time, setup) so I understand what I'm paying for. | Expandable breakdown; totals reconcile exactly with headline price; shows estimated turnaround days from process config. | SHOULD |
| C5 | As a customer, I can enter my email and phone and pay via Stripe Checkout so I can place the order. | Form validates email; phone optional; Stripe Checkout redirect preserves quote_id; success page returns to widget with confirmation. | MUST |
| C6 | As a customer, I receive an order confirmation email with order ref and expected turnaround so I know what happens next. | Email fires within 30s of payment; contains order ref, material, qty, total, shop contact, turnaround. | MUST |
| C7 | As a customer, if my file is unprintable (non-manifold, too big for bed), I get a clear error before I try to pay. | Quote engine returns a blocking error with human-readable reason; widget shows inline error and suggests "contact shop"; no Pay button shown. | MUST |
| C8 | As a customer, I can request a manual quote if auto-pricing doesn't work for my file. | "Request quote" fallback button posts file + contact to shop inbox as `status: awaiting_manual_quote`. | SHOULD |
| C9 | As a customer, I can re-open my quote from the email link within 7 days and still pay. | Quote link resolves; if material prices unchanged, price holds; otherwise re-quoted with banner explaining change. | COULD |

### Admin / internal

| # | Story | Acceptance Criteria | Priority |
|---|---|---|---|
| A1 | As an internal admin, I can list all shops, see their subscription status, quote volume, and suspend a shop. | Protected route behind admin role; suspend flips `shops.status = suspended` and disables widget within 60s. | MUST |
| A2 | As an internal admin, I can impersonate a shop to reproduce bugs without asking for screenshots. | Impersonation starts read-only session; all actions logged to `admin_audit` table; banner in UI during impersonation. | SHOULD |

---

## 5. Success metrics for launch

**North star**: Paid customer orders per active shop per week. If this number doesn't climb month-over-month, the widget isn't earning its £50.

| Category | Metric | Target by 90 days post-launch |
|---|---|---|
| Activation | % signed-up shops that paste embed on their live site within 7 days | ≥ 60% |
| Activation | Time from signup to first embed paste (median) | < 24 hours |
| Revenue | Paying shops | 30 |
| Revenue | MRR | £1,500 |
| Revenue | Logo churn (monthly) | < 8% |
| Customer-side conversion | Widget opens → quote generated | ≥ 55% |
| Customer-side conversion | Quote generated → paid order | ≥ 12% |
| Customer-side conversion | Widget opens → paid order (end-to-end) | ≥ 7% |
| Technical | Widget TTI (time-to-interactive on median connection) | < 2.5s |
| Technical | Quote latency p95 (upload complete → price shown) | < 4s |
| Technical | Quote engine uptime | ≥ 99.5% |
| Technical | Stripe webhook processing success rate | ≥ 99.9% |
| Support | Support tickets per active shop per month | < 0.4 |

**Anti-goals** (we watch these but don't optimise for them in v1): signups (vanity), widget load count (irrelevant without conversion), average quote value (dominated by a few pro customers, noisy).

---

## 6. Roadmap

### v1.0 — MVP (ship within 10 weeks of dev start)

Exactly the scope in `CLAUDE.md` §4. Nothing more. If a feature isn't listed there, it waits. Non-negotiable scope: shop signup + subscribe, materials & process CRUD, embed widget with STL/OBJ/3MF upload, 3D preview, live price, Stripe Checkout, quotes inbox, payment email hooks, internal admin.

### v1.1 — Next 3 months post-GA

Driven by evidence from first 10–20 paying shops.

- **STEP file support** — adds OCCT to the quote engine. Unblocks professional mechanical and dental-lab users who work in native CAD. Highest-asked feature in our pre-launch interviews.
- **Stripe Connect + platform fee** — optional path where Quick3DQuote collects payment and pays out to the shop, taking a 1–2% platform fee on top of the £50/mo. Creates a second revenue line and improves retention (harder to cancel when we hold the payout relationship).
- **Email template customisation** — shop can edit the order confirmation and shop-notification emails (subject, body, logo) from the dashboard. Addresses the #1 early complaint: "your emails don't look like mine."
- **Multi-user shops** — add teammates with roles (owner, staff). Required by any shop with 2+ people handling orders.
- **Quote expiry + nudge email** — 48h unpaid-quote reminder. Low effort, directly lifts conversion.

### v2.0 — 12-month horizon

- **Public API** — authenticated REST endpoints so shops and integrators can push quotes, pull orders, sync to ERPs.
- **White-label custom domain** — widget hosted at `quote.shopname.co.uk` instead of `quick3dquote.com/embed`. Pro/Scale tier feature.
- **Shop-side analytics dashboard** — funnel (opens → quotes → orders), material mix, average order value, top-uploaded files. Turns the tool from "cost" to "business intelligence".
- **CNC process support** — extends the pricing model and material types to subtractive manufacturing. Opens a second market the same shops often dabble in.
- **Internationalisation** — EUR, USD; localised copy for DE, FR, US markets. UK-first is a launch decision, not a permanent one.
- **Slicer-accurate print-time** — CuraEngine integration as an opt-in "accurate mode" for shops that want tighter margins.

Anything not listed here is parked. If a shop asks for it, it goes in the "Not building" column (§9 of this doc or CLAUDE.md §10) with a trigger condition.

---

## 7. Competitive positioning

### vs RapidQuote3D (£300/mo)

RapidQuote3D is the established player and the benchmark for widget UX. They have five years of field-tested features, a large materials library, and trust. **We win on price and simplicity**: £50/mo is 1/6 the cost, and our onboarding is a ten-minute paste-and-go instead of their two-hour setup wizard. **We lose on breadth**: they already support STEP, slicer-accurate timing, multi-user, and have a decade of edge-case handling. Our bet is that 80% of UK shops under £30k/mo revenue don't need the extra 80% of features — they need affordable and fast. We aggressively target shops who looked at RapidQuote3D, flinched at the price, and went back to email.

### vs 3DHubs-style marketplaces (Hubs / Craftcloud / Xometry)

Marketplaces route the customer to a pool of suppliers; the shop is one of many, competing on price in a race to the bottom, and the marketplace takes 10–30%. **We win on ownership**: the shop keeps their customer, their brand, their margin, their data. Quick3DQuote lives on the shop's own domain. **We lose on demand generation**: marketplaces bring traffic, we don't. That's fine — our target shop already has a website and some organic traffic; they need conversion, not discovery. If a shop has no website and no traffic, they're not our customer.

### vs "just emailing a quote" (the real status quo)

This is the incumbent we need to beat, not RapidQuote3D. Email quoting is free, familiar, and "good enough" — until you measure the time cost and lost conversions. **We win on speed and professionalism**: an instant 3D-preview widget looks like the shop is a serious business; a 24-hour email reply does not. We also win on conversion — a customer who gets a price in 30 seconds is 3–5x more likely to pay than one who waits a day. **We lose on zero-cost**: £50/mo is £600/year, and a shop doing two quotes a month won't feel the lift. We're not for them; we're for shops doing 20+ quotes a month where the widget pays for itself in saved hours by week two.

---

## 8. Pricing strategy

### Why £50/mo

Three constraints converge:

1. **Below the "do I need to think about it?" line for a small business.** £50/mo is roughly two hours of the shop owner's time. If the widget saves them two hours a month, it's free. Most target shops spend 5–15 hours/month on quoting today.
2. **6x undercut on RapidQuote3D.** Big enough gap to be a conversation-starter in marketing without looking suspiciously cheap.
3. **Sustainable unit economics.** At £50/mo, infrastructure cost per shop (Vercel + Supabase + R2 + Fly.io) is roughly £3–£5 depending on file volume. Stripe fees ~£1.75. Net ~£43/shop/mo gross. At 100 shops = £4.3k/mo gross — covers one part-time developer.

### Tier structure (proposed)

| Tier | Price | Included | Upsell trigger |
|---|---|---|---|
| **Starter** | **£50/mo** | 1 shop user, up to 10 materials, up to 200 quotes/mo, standard branding, Quick3DQuote domain, email support | Hitting 200 quotes or needing multi-user |
| **Pro** | **£99/mo** | Everything in Starter + unlimited materials, up to 1,000 quotes/mo, up to 3 users, email template customisation, remove "Powered by" badge, priority support | Hitting 1,000 quotes, needing API/white-label |
| **Scale** | **£199/mo** | Everything in Pro + unlimited quotes, unlimited users, public API access, white-label custom domain (v2.0), shop analytics dashboard, dedicated Slack support channel | — |

**What's in vs what's an upsell**:

- In all tiers: core widget, 3D preview, Stripe Checkout, quotes inbox, standard email notifications, STL/OBJ/3MF, FDM/SLA pricing.
- Upsells: material library size, quote volume, multi-user, branding polish (remove badge, custom emails, white-label domain), API access, analytics.

**Rationale**: the gate between Starter and Pro is volume and branding polish — the two things a shop starts caring about once they're actually using the product. The gate between Pro and Scale is programmatic/integration needs — that's where serious operators (£20k+/mo) live.

**Introductory offer for v1.0**: first 20 shops get Starter at £25/mo locked for 12 months in exchange for being reference customers and giving us structured feedback. Treated as a customer-acquisition line item, not a discount.

---

## 9. Launch risks & unknowns

### What could kill this product

1. **Quote inaccuracy erodes shop trust.** If our volume-divided-by-throughput heuristic produces prices that are 30% off real cost, shops lose money on underquoted jobs and turn the widget off within a week. **Mitigation**: shops fully control the inputs (material £/cm³, hourly rate, throughput, markup); we ship with a "calibration" guide showing how to tune from three real past jobs. First-month onboarding call for the first 20 shops.
2. **Shop trust in a new brand.** Why would a shop bet their revenue-critical quote flow on a company that didn't exist six months ago? **Mitigation**: public status page, published uptime, transparent pricing, no lock-in (export all quotes as CSV, cancel any time), visible founder presence in community forums (Reddit r/3Dprinting, 3D Printing UK Facebook group). Case studies from the first five alpha shops by week 8.
3. **Support load sinks the founding team.** Small shops expect hand-holding; if each onboarding takes 2 hours of our time, 30 shops = a full-time job and we can't build. **Mitigation**: invest in install guides, a pre-recorded 10-minute walkthrough video, and a public help doc before we open beyond alpha. Track time-to-first-embed obsessively.
4. **Quote-engine file handling edge cases.** Non-manifold meshes, huge files, exotic units in OBJ, malformed 3MF. One customer who pays for an unprintable file and loses the shop money is a churn event. **Mitigation**: robust validation in trimesh, explicit "request manual quote" fallback (C8), file size cap at 100MB in v1, error messages written for humans not developers.
5. **Payment split friction.** v1 pays customer money straight to the shop's Stripe. If a shop doesn't have a Stripe account, they can't onboard. **Mitigation**: Stripe is near-ubiquitous in UK SMBs; include "set up Stripe" as step 2 of onboarding with a direct signup link. Revisit with Stripe Connect in v1.1.
6. **Competitor response.** RapidQuote3D could drop to £75/mo or launch a lite tier and neutralise our price advantage overnight. **Mitigation**: speed is our moat. Ship v1.1 features (STEP, Connect, templates) within 90 days of GA. Build loyalty with the first 50 shops before any response can mobilise.

### What we'd validate with the first 5 alpha shops

Five hand-picked UK shops (2× FDM-primary, 2× SLA-primary, 1× mixed; revenue range £3k–£15k/mo). 30-day structured alpha with a weekly call.

- **Quote accuracy**: do the shop's actual completed jobs match the widget's quoted price within ±15%? If not, what inputs need to change, and is the model itself wrong?
- **Install time**: can the shop (non-developer) paste the embed and see it working on their live site inside 30 minutes without our help?
- **Customer-side conversion**: across 30 days of real traffic, what's the widget-open → paid-order rate? Does it beat their prior email-quote conversion (baseline from their records)?
- **Error rate**: what % of real customer uploads produce a usable quote vs hit an error? Which errors? This drives the v1.1 error-handling backlog directly.
- **Willingness to pay £50/mo**: after 30 days, would they pay £50? £99? £25? Where does the pricing hit friction, and why? (This is a structured conversation, not a survey.)
- **What they'd cancel for**: the single feature or failure that would make them turn it off. This is the roadmap signal we trust most.

Exit criteria for alpha: 4 of 5 shops willing to convert to paid at £50/mo, quote accuracy within ±15% on ≥80% of jobs, zero critical data-integrity incidents. Miss any of those, we fix before opening to public beta.

---
