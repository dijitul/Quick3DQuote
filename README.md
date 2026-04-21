# Quick3DQuote

Instant 3D-printing quote widget — embeddable on any site. Shops sign up, configure their materials and margins, and drop a script tag on their site. Their customers upload an STL, see a 3D preview, pick material + colour + quantity, and pay instantly via Stripe.

Competitor: [RapidQuote3D](https://rapidquote3d.com/) at £300/mo. We target £50/mo.

## Status

**Phase 2 — Scaffold complete.** See [`CLAUDE.md`](./CLAUDE.md) §7 for live status and [`docs/`](./docs/) for the full design documents.

## Repo layout

```
apps/
  web/              # Next.js 15 — marketing + shop dashboard (port 3000)
  embed/            # Next.js 15 — embeddable widget (port 3001, deploys to embed.quick3dquote.com)
services/
  quote-engine/     # FastAPI + trimesh — mesh analysis + pricing (Fly.io)
supabase/
  migrations/       # DDL, RLS policies, triggers, storage buckets
  tests/rls/        # pgTAP-style tenant-isolation tests
docs/               # Design docs — 8 specialist docs covering every concern
.github/workflows/  # CI: lint/test/build for JS + Python + SQL syntax
```

## Quick start (once toolchain is installed)

```bash
# 1. Install Node 20+, pnpm 9+, Python 3.11+, and the Supabase CLI.
# 2. Copy env files.
cp .env.example .env.local
# 3. Install JS deps.
pnpm install
# 4. Install Python deps for the engine.
cd services/quote-engine && pip install -r requirements.txt -r requirements-dev.txt && cd -
# 5. Boot local Supabase (auth, db, storage).
supabase start
# 6. Apply migrations + seed.
pnpm run db:reset
# 7. Run everything in parallel.
pnpm dev           # web:3000, embed:3001 (engine is started separately)
pnpm dev:engine    # in another terminal
```

## Prerequisites (for when we start building)

- Node 20+
- pnpm 9+
- Python 3.11+
- A Postgres database (Supabase recommended)
- A Stripe account (test mode for dev)
- A Cloudflare R2 bucket (or any S3-compatible store)

## License

Proprietary — dijitul / Quick3DQuote.
