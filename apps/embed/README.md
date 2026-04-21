# @q3dq/embed

The customer-facing iframe widget for Quick3DQuote. Shops drop a one-line
`<script src="https://embed.quick3dquote.com/embed.js?key=..."></script>`
into their site; that script injects an iframe pointing at this app, which
renders the upload-viewer-price-checkout flow.

This app is deliberately separate from `apps/web` (the shop dashboard) so
the widget can serve an `frame-ancestors *` CSP without loosening the
dashboard's own headers. See `docs/architecture.md` §2.

## Stack

- Next.js 15 App Router (port **3001** in dev)
- React 19 RC
- Tailwind 3.4 with shadcn-style CSS variable tokens
- react-three-fiber + three-stdlib (`STLLoader`, `OBJLoader`)
- react-dropzone for upload UX
- Zod on every wire contract
- Cloudflare R2 via `@aws-sdk/client-s3` + `s3-request-presigner`
- Stripe Checkout with `stripeAccount` (direct charge on the shop's
  connected account, CLAUDE.md §11.3)
- Supabase service-role client (embed customers are unauthenticated —
  tenant scoping is done in the route handlers via the signed session
  cookie)

## Running locally

From the repo root:

```bash
pnpm install
pnpm --filter @q3dq/embed dev
```

The widget then serves on `http://localhost:3001`. Route summary:

| Path                                     | What                                          |
| ---------------------------------------- | --------------------------------------------- |
| `/?key=<embed_key>`                      | The widget itself (the iframe source).        |
| `/embed.js?key=<embed_key>`              | The loader script shops paste into their site. |
| `/api/v1/embed/session`                  | Bootstrap session + branding.                 |
| `/api/v1/embed/upload-url`               | Presigned R2 PUT (10-min TTL).                |
| `/api/v1/embed/quotes`                   | Create / re-price a quote.                    |
| `/api/v1/embed/quotes/:id`               | Fetch a quote (for the success page).         |
| `/api/v1/embed/quotes/:id/checkout`      | Start Stripe Checkout on the shop's account.  |

### Required env vars

Copy `.env.local.example` (or the root `env.example`) into `.env.local`:

```
# Supabase (service-role — keep out of any client bundle)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=q3dq-meshes
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com

# Quote engine (Fly app)
QUOTE_ENGINE_URL=http://localhost:8080
QUOTE_ENGINE_INTERNAL_KEY=dev-shared-secret

# Stripe (platform key — we create Checkout Sessions on connected accounts)
STRIPE_SECRET_KEY=sk_test_...

# Session cookie signing (rotate this and every session dies; that's fine)
SESSION_SIGNING_SECRET=long-random-hex-or-base64

# Where the widget is served from (used for embed.js origin checks + CSP)
NEXT_PUBLIC_EMBED_ORIGIN=http://localhost:3001
```

## Testing the iframe embed locally

The loader script assumes the widget is on a different origin than the
host page — that's the whole point. You have two ergonomic options for
reproducing that on a single machine:

### Option A — /etc/hosts (recommended)

Add to `/etc/hosts` (Windows: `C:\Windows\System32\drivers\etc\hosts`,
edit as admin):

```
127.0.0.1   embed.localhost
127.0.0.1   shop.localhost
```

Run the widget on `embed.localhost:3001`:

```bash
pnpm --filter @q3dq/embed dev -- -H 0.0.0.0
# then browse to http://embed.localhost:3001
```

Serve a fake shop page on `shop.localhost` — anything will do. The
simplest smoke test is a static file:

```html
<!-- smoke-host.html, served with `npx serve -l 8000` -->
<!doctype html>
<meta charset="utf-8" />
<title>Shop smoke test</title>
<h1>Pretend this is a printing shop</h1>
<script src="http://embed.localhost:3001/embed.js?key=YOUR_DEV_EMBED_KEY"></script>
```

Browse it at `http://shop.localhost:8000/smoke-host.html`. Because
`shop.localhost` and `embed.localhost` are different origins, you'll
exercise the cross-origin cookie (`SameSite=None`), postMessage bridge
(iframe → host resize), and top-level Stripe redirect in dev exactly
as they'd work in production.

Set `NEXT_PUBLIC_EMBED_ORIGIN=http://embed.localhost:3001` while
running this mode so CSP and CORP headers align.

### Option B — Caddy reverse proxy

If you prefer not to touch hosts files:

```caddy
# Caddyfile
embed.test:80 {
  reverse_proxy localhost:3001
}
shop.test:80 {
  root * ./smoke-host
  file_server
}
```

Then `caddy run` and hit `http://shop.test`.

## Testing

```bash
pnpm --filter @q3dq/embed test        # vitest, jsdom
pnpm --filter @q3dq/embed test:watch
pnpm --filter @q3dq/embed lint
pnpm --filter @q3dq/embed typecheck
```

The state-machine reducer has a full unit suite
(`src/lib/state-machine.test.ts`) — that's the highest-value spec for the
widget because it guards the upload → priced → checkout → success flow
against illegal transitions.

## Security quick-reference

Full detail: `docs/security.md`. Highlights enforced in this app:

- Session cookie is HMAC-signed (`SESSION_SIGNING_SECRET`), `HttpOnly`,
  `SameSite=None; Secure` in prod, `Lax` in dev.
- `X-Embed-Key` header is required on every non-bootstrap route and must
  match the session's shop's `embed_key` — defeats session-token replay
  across shops.
- R2 keys are scoped to `meshes/{shop_id}/{session_id}/` and the quote
  route rejects keys outside that prefix.
- Stripe Checkout Sessions are created on the shop's connected account
  (`{ stripeAccount }`); we compute `unit_amount` from the DB row and
  never trust any client-supplied price.
- Success/cancel URLs are origin-checked against the shop's
  `allowed_redirect_origins`.
- `frame-ancestors *` is scoped to the widget routes only;
  `/embed.js` has `Cross-Origin-Resource-Policy: cross-origin` so shops
  can actually load it.

## Deferred / stubbed

- **3MF preview** — the 3D viewer renders STL (ASCII + binary) and OBJ.
  3MF shows a "coming soon" placeholder; the backend still analyses the
  file and the quote flow works normally. Wire up `3MFLoader` from
  `three-stdlib` + an fflate ZIP reader when this becomes a priority.
- **Rate limiting** — `POST /session` and `POST /upload-url` should sit
  behind an upstash-backed limiter (see `docs/api-design.md` §5). Stub
  for now; limiter lives in a shared package once the dashboard lands.
- **PostHog / telemetry** — `src/lib/telemetry.ts` is a no-op stub.
  Swap the `track()` impl for a real PostHog client once the key is
  provisioned.
- **DB migrations** — this app assumes `embed_sessions`, `quotes`,
  `materials`, `processes`, and `shops.stripe_account_id` + `shops.
  allowed_redirect_origins` already exist. Migrations live in the root
  `supabase/` package; make sure they're applied before running the
  widget against a real DB.
