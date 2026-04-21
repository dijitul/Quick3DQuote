# CLAUDE.md — Quick3DQuote Project Memory

> Live status document. Claude agents read this first before doing any work on this repo. Keep it current.

---

## 1. What we're building

**Quick3DQuote** — a multi-tenant SaaS instant-quote widget for 3D printing shops.

**The product in one paragraph.** A 3D printing shop signs up on our landing page, picks a plan, configures their materials (name, £/cm³, density, colour) and printers (FDM, SLA, hourly rates, setup fee, markup %). They paste a single `<script>` snippet onto their own website. Their customers upload an STL/OBJ/3MF file into an embedded widget, see the model rendered in 3D, pick a material + colour + quantity, get an instant price, and pay via Stripe. The shop gets the order in their dashboard with file download and customer contact.

**Competitor & pricing.** [RapidQuote3D](https://rapidquote3d.com/) charges £300/mo. We target **£50/mo** as the headline plan. Undercut on price, match on UX polish, win on ease-of-setup.

---

## 2. Architecture at a glance

```
                           ┌────────────────────────────┐
                           │  quick3dquote.com (Vercel) │
                           │  - Marketing site          │
                           │  - Shop dashboard (Next)   │
                           │  - Embed host (/embed)     │
                           └─────────────┬──────────────┘
                                         │
                                         │ REST / tRPC
                                         ▼
                           ┌────────────────────────────┐
                           │  API routes (Next.js)      │
                           │  - Auth (Supabase)         │
                           │  - Quotes CRUD             │
                           │  - Stripe webhooks         │
                           └──┬──────────────────┬──────┘
                              │                  │
                              ▼                  ▼
            ┌────────────────────────┐   ┌──────────────────┐
            │ quote-engine (Fly.io)  │   │  Supabase        │
            │ FastAPI + trimesh      │   │  Postgres + Auth │
            │ - volume / bbox        │   │  + file storage  │
            │ - price calc           │   └──────────────────┘
            │ - print-time estimate  │
            └────────────────────────┘

                           ┌────────────────────────────┐
                           │  Cloudflare R2             │
                           │  Mesh file storage         │
                           │  (zero egress fees)        │
                           └────────────────────────────┘
```

**Embed flow**: customer site loads `<script src="https://quick3dquote.com/embed.js?key=SHOP_KEY">`. Script injects a same-origin iframe pointing at `https://quick3dquote.com/embed?key=SHOP_KEY`. Widget talks back to our API over HTTPS; no customer site CORS issues.

---

## 3. Stack decisions (and why)

| Layer | Pick | Why |
|---|---|---|
| App framework | **Next.js 15 (App Router) + TypeScript** | Dashboard + marketing + embed + API routes in one deploy. |
| 3D viewer | **react-three-fiber + drei + three-stdlib** | Best React-flavoured wrapper for three.js; STLLoader/OBJLoader ship with three-stdlib. |
| Styling | **Tailwind + shadcn/ui** | Fast to look premium; we control the DOM so components can be rebranded. |
| Auth | **Supabase Auth** | Email + Google; row-level security for multi-tenancy. |
| DB | **Supabase Postgres** | Managed, cheap, RLS-capable. |
| File store | **Cloudflare R2** | Zero egress — STL files are 5–200MB. Presigned direct upload from browser. |
| Payments | **Stripe Checkout + Subscriptions** | Shop subs (£50/mo) AND customer one-off checkout for quotes. Stripe Connect later if we want to take a platform fee from shop payouts. |
| Quote engine | **Python 3.11 + FastAPI + trimesh** | `trimesh` is the de-facto library for STL volume/bbox/repair. Python is the only sane choice. |
| Deploy (web) | **Vercel** | Next.js native host; edge + serverless out of the box. |
| Deploy (engine) | **Fly.io** | Cheap always-on Python worker, multi-region. |
| Monorepo | **pnpm workspaces + Turborepo** | Standard JS monorepo; Turborepo caches builds. |

**Deliberately deferred:**
- STEP file support (needs OCCT — defer to v1.1; STL/OBJ/3MF cover 90% of FDM/SLA users).
- Real slicer-based print-time (CuraEngine is heavy). MVP uses `volume ÷ process-throughput + setup` heuristic — same approach RapidQuote3D uses.
- Stripe Connect / platform fee mechanics — defer to v1.1 once we have paying shops.
- Support-material estimation beyond bbox overhang heuristic — defer.

---

## 4. MVP scope (what ships in v1.0)

1. **Public marketing site** — landing page, pricing (£50/mo), login/signup.
2. **Shop onboarding** — Stripe Checkout subscription gate, no trial for v1 (can add later).
3. **Shop dashboard** —
   - Materials CRUD (name, process: FDM/SLA, £/cm³, density g/cm³, colour hex, active flag)
   - Process settings (hourly rate, setup fee £, min order £, markup %, turnaround days)
   - Branding (shop name, logo, accent colour for widget)
   - Embed snippet page
   - Quotes inbox (status: quoted / paid / in-production / shipped / cancelled)
4. **Embed widget** —
   - Drag-drop upload (STL, OBJ, 3MF up to 100MB)
   - 3D preview (rotate, zoom, dimensions overlay in mm)
   - Material + colour + quantity selectors
   - Live price (updates in <2s of file upload, <500ms on material change)
   - Customer email + phone capture
   - Stripe Checkout redirect on "Order now"
5. **Order fulfilment hooks** — shop gets email on paid order + dashboard entry with file download link (signed URL, 24h TTL).
6. **Admin** — internal-only super-admin to see all shops, suspend, impersonate.

**Out of scope for v1:** multi-user shops (shop = one user), bulk quote uploads, API for shops, discount codes, shop-side file annotation, quote expiry emails, refunds UI.

---

## 5. Pricing engine (the heart of the product)

Given a mesh and a material+process+qty:

```
volume_cm3       = mesh volume (from trimesh)
material_cost    = volume_cm3 × material.price_per_cm3
print_hours      = volume_cm3 ÷ process.throughput_cm3_per_hour
machine_cost     = print_hours × process.hourly_rate
setup_cost       = process.setup_fee
subtotal_per_part = (material_cost + machine_cost + setup_cost)
total            = max(min_order, subtotal_per_part × qty × (1 + markup%))
```

Per-process throughput defaults (editable by shop):
- **FDM**: 12 cm³/hour
- **SLA**: 18 cm³/hour

These are close to real-world averages; shops will tune them. This is the same class of model RapidQuote3D uses — it's not slicer-accurate but it's fast, transparent, and easy for the shop to override.

---

## 6. Multi-tenancy model

- `shops` table is the tenant boundary. Every tenant-scoped table has `shop_id` FK.
- Supabase **Row Level Security (RLS)** enforces: a shop user can only read/write rows where `shop_id = auth.uid()`'s shop.
- Embed widget is unauthenticated from the customer POV but includes `shop_key` (a public embed key stored on `shops.embed_key`). All embed API calls are rate-limited per `shop_key` AND per IP.
- File uploads: presigned PUT URL scoped to `r2://meshes/{shop_id}/{quote_id}/{filename}`.

---

## 7. Current status

| Phase | State | Owner |
|---|---|---|
| 1. Design docs (architecture, schema, UX, security, devops) | **✅ COMPLETE** (2026-04-21) | specialist agents |
| 2. Repo scaffold (workspaces, Next.js, FastAPI skeleton) | **NEXT** | |
| 3. Pricing engine (Python + unit tests) | pending | |
| 4. Widget MVP (upload → preview → price) | pending | |
| 5. Dashboard MVP (auth, materials CRUD, quotes inbox) | pending | |
| 6. Stripe integration (shop subs + customer checkout) | pending | |
| 7. Alpha with 1 friendly shop | pending | |

---

## 8. Conventions for Claude agents working on this repo

- **Read this file first.** It is the source of truth for scope and decisions.
- **Design docs live in `/docs/`.** One concern per file (architecture.md, db-schema.md, etc.). Don't create sibling docs without updating this index.
- **Code conventions**: TypeScript strict mode; Python with type hints + ruff; no unguarded `any`. Zod for all API input validation.
- **Secrets**: never commit. Use `.env.example` to document required vars.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`). Co-author trailer on Claude commits.
- **Before making architecture changes** that affect more than one doc, update this file first, then the affected docs, then code.
- **When scope grows**: write it down in §10 (deferred) rather than silently building it.

---

## 9. Design documents (index)

- [x] `docs/product-spec.md` — Product Manager (personas, stories, roadmap) ✅
- [x] `docs/architecture.md` — Software Architect (full system design, service boundaries) ✅
- [x] `docs/ux-flows.md` — UX Researcher (shop-owner + end-customer flows) ✅
- [x] `docs/design-system.md` — UI Designer (colour, type, components) ✅
- [x] `docs/db-schema.md` — Database Optimizer (Postgres schema + RLS) ✅
- [x] `docs/api-design.md` — Backend Architect (REST surface, auth, webhooks) ✅
- [x] `docs/security.md` — Security Engineer (threat model, Stripe webhook, file upload, embed CORS) ✅
- [x] `docs/devops.md` — DevOps (Vercel + Fly.io + Supabase + R2, CI/CD, cost model) ✅

All Phase 1 design docs complete. **Next phase: reconcile conflicts between docs, then scaffold code.**

### Flagged for reconciliation
- Design system recommends **Indigo accent #6366F1** (Candidate A) — confirm with Olly before locking.
- Security doc is longer than planned (5,327 words vs 2,500–4,000 target) because of STRIDE tables; content quality is fine, leaving as-is.
- Same-origin vs separate `embed.quick3dquote.com` subdomain — devops doc has a recommendation; cross-check against api-design's CORS policy before code.

---

## 10. Deferred / parked (so we don't silently bloat scope)

- STEP file support (needs OCCT)
- Slicer-accurate print-time (CuraEngine integration)
- Stripe Connect / platform fee from shop payouts
- Multi-user shops, roles & permissions
- Discount codes
- Quote-request-only mode (no instant checkout) — might revisit if shops ask
- Self-hosted / on-prem option
- Public API for shops
- White-label custom domain for widget

---

## 11. Open questions to resolve with Olly (the owner)

1. **Who holds the customer payment?** v1 assumption: money goes straight to the shop's Stripe account (we just charge them £50/mo). Alternative: we collect and payout (needs Stripe Connect, more complex, takes 1–2 extra weeks). **Current default: direct-to-shop.**
2. **Trial?** 14-day free trial or straight to paid? **Current default: no trial in v1**, add later.
3. **Brand/visual direction.** Placeholder: clean, technical, mid-century-engineering vibe. UI designer agent will propose.
4. **File size cap.** Default 100MB upload. Might need to go higher for SLA dental-lab type users — revisit post-launch.

---

## 12. Repo

- GitHub: https://github.com/dijitul/Quick3DQuote
- Branch strategy: `main` (protected) + feature branches, squash-merge.
- CI: Vercel previews on PR (app), Fly.io deploy on merge to main (engine).
