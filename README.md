# Quick3DQuote

Instant 3D-printing quote widget — embeddable on any site. Shops sign up, configure their materials and margins, and drop a script tag on their site. Their customers upload an STL, see a 3D preview, pick material + colour + quantity, and pay instantly via Stripe.

Competitor: [RapidQuote3D](https://rapidquote3d.com/) at £300/mo. We target £50/mo.

## Status

**Phase 1 — Design.** See [`CLAUDE.md`](./CLAUDE.md) for the live project status and [`docs/`](./docs/) for the design documents.

## Repo layout (once scaffolded)

```
apps/
  web/              # Next.js — marketing site, shop dashboard, embed host
services/
  quote-engine/     # Python FastAPI — mesh analysis + pricing
packages/
  pricing/          # Shared TS pricing logic
  ui/               # Shared UI components
docs/               # Design docs (architecture, security, schema, ux, etc.)
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
