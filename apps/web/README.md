# @q3dq/web — Quick3DQuote marketing site + shop dashboard

Next.js 15 (App Router) + TypeScript 5.6 + Tailwind 3.4. This package ships:

- Public marketing landing (`/`) with hero, benefits, pricing (£50 / £99 / £199), FAQ, CTA.
- Auth flows (magic-link signup + login) backed by Supabase.
- Shop dashboard at `/dashboard`, `/quotes`, `/materials`, `/processes`, `/branding`, `/embed`, `/billing`, `/settings`.
- Full `/api/v1/*` route handlers with Zod validation, Supabase RLS, and a signature-verified Stripe webhook.

## Quick start

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # if you have one; otherwise copy the table below
pnpm --filter @q3dq/web dev                    # boots on http://localhost:3000
```

### Environment variables

All are validated by Zod on boot — see `src/lib/env.ts`. Missing a required key will crash the server with a readable error.

| Variable | Scope | Required | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | public | no (defaults to `http://localhost:3000`) | Base URL of this app. |
| `NEXT_PUBLIC_EMBED_URL` | public | no (defaults to `http://localhost:3001`) | Base URL of the customer widget. |
| `NEXT_PUBLIC_SUPABASE_URL` | public | **yes** | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | **yes** | Supabase anon key (goes to the browser). |
| `SUPABASE_SERVICE_ROLE_KEY` | server | yes for webhooks | Bypasses RLS — only used by webhook + admin paths. |
| `STRIPE_SECRET_KEY` | server | yes for billing | `sk_test_...` or `sk_live_...`. |
| `STRIPE_WEBHOOK_SECRET` | server | yes for webhooks | Returned by `stripe listen` or Dashboard. |
| `STRIPE_PRICE_ID_STARTER` / `_PRO` / `_SCALE` | server | yes for checkout | Recurring price IDs for the £50/£99/£199 tiers. |
| `STRIPE_CLIENT_ID` | server | yes for Connect | `ca_...` from Stripe Connect settings. |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | server | yes for uploads | Cloudflare R2 credentials. |
| `R2_BUCKET_MESHES` | server | no (default `q3dq-meshes`) | Name of the bucket holding customer uploads. |
| `QUOTE_ENGINE_URL` | server | yes for repricing | e.g. `http://localhost:8080`. |
| `QUOTE_ENGINE_INTERNAL_KEY` | server | yes for repricing | Shared secret; sent as `X-Internal-Key`. |

### Stripe webhooks locally

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
# Copy the whsec_... line into STRIPE_WEBHOOK_SECRET
stripe trigger checkout.session.completed
```

The webhook route reads the raw body with `request.text()` and validates the
signature via `stripe.webhooks.constructEvent`. Every event is deduped through
the `webhook_events` table (`event_id` PK) before any handler runs.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server on port 3000 with hot reload. |
| `pnpm build` | Next build. |
| `pnpm start` | Start the production build on port 3000. |
| `pnpm lint` | `next lint` (extends `next/core-web-vitals` + `@typescript-eslint/recommended`). |
| `pnpm typecheck` | `tsc --noEmit` — CI runs this alongside lint. |
| `pnpm test` | `vitest run` — currently covers the marketing smoke test. |

## Layout

```
src/
  app/
    (auth)/                    login + signup + supabase callback
    (dashboard)/               shop-authenticated UI
    api/v1/                    route handlers (Zod + RLS + Stripe)
    page.tsx                   marketing landing
  components/
    dashboard-shell.tsx        sidebar + topbar + user menu
    ui/                        hand-written shadcn-style primitives
  lib/
    supabase/                  server + browser + middleware clients
    auth.ts                    requireShopSession()
    env.ts                     Zod-validated process.env
    api-error.ts, api.ts       uniform error body + typed fetch
    r2.ts                      S3 presign helpers against Cloudflare R2
    stripe.ts                  cached Stripe singleton
```

## Notes for the next developer

- The quote detail page renders the widget preview in an iframe pointed at
  `NEXT_PUBLIC_EMBED_URL/preview/<quote_id>` — the embed app must serve that
  route for the preview to light up.
- `PATCH /api/v1/quotes/:id` with `status=in_production|shipped` writes to the
  `orders` table (auto-creating the row if needed), not `quotes.status`, which
  is constrained to `draft|priced|checkout_started|paid|failed|expired|cancelled`.
- `POST /api/v1/shop/regenerate-embed-key` deletes existing `embed_sessions`
  via the service role client; omit `SUPABASE_SERVICE_ROLE_KEY` in dev and the
  rotation still works — it just doesn't actively kick live widget sessions.
- The marketing page is a pure React Server Component and contains zero
  network calls, so Lighthouse / CWV measurements are representative.
