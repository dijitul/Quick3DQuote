# API Design — Quick3DQuote

> Owner: Backend Architect agent. Source of truth for the HTTP surface, auth model, and contract between Next.js, the quote-engine, and Stripe. Read `CLAUDE.md` first.

---

## 1. API principles

### 1.1 Shape and transport

- **REST over HTTPS with JSON bodies.** No GraphQL, no raw RPC over the wire. REST is legible in browser devtools, trivial for shop-side debugging, and maps cleanly onto Next.js route handlers.
- **Versioned under `/api/v1/...`.** Every path below is prefixed. When we break compatibility we introduce `/api/v2` alongside; we do not mutate v1. Internal-only endpoints (quote-engine) are not versioned in the URL — the shared-secret header carries the contract version if we ever need to bump it.
- **Zod validation on every route.** The first thing each Next.js route handler does is `Schema.parse(await req.json())` (or `.safeParse` where we want to return a 400 ourselves). No endpoint reads an unvalidated field off `req.body`. Schemas live next to the route file (`route.ts` + `schema.ts`) and are exported for client-side form reuse.
- **Snake_case in JSON bodies, camelCase in TS.** We transform at the edge in a small `case.ts` helper. The wire format matches Postgres column names, which reduces cognitive load when debugging with raw SQL.
- **Timestamps are ISO-8601 UTC strings.** Money is integers in pence (`price_pence: number`), never floats. Volumes and areas are decimals to two places.

### 1.2 tRPC for the dashboard? No.

Tempting, but rejected. The dashboard is one of two clients; the widget is the harder one, and it cannot use tRPC (it's a standalone HTML page loaded in an iframe on a third-party site, and we want the embed surface to be a stable, documented HTTP contract). Adding tRPC just for the dashboard means maintaining two parallel API styles, and tRPC's value (end-to-end types) is already covered by exporting the Zod schemas from shared packages. Dashboard routes call the same REST endpoints the widget uses where they overlap, and dashboard-only endpoints are plain REST with exported Zod schemas + a thin typed `fetch` wrapper.

### 1.3 Idempotency keys

All mutating endpoints (`POST`, `PATCH`, `DELETE`) accept an optional `Idempotency-Key` request header. When present, the server persists the first (status, body) response in a `idempotency_keys` table keyed by `(shop_id or session_token, key, route)` with a 24-hour TTL. A retried request with the same key returns the stored response verbatim without re-executing the handler. This is mandatory for:

- `POST /api/v1/embed/quotes` (widget customers lose network mid-click)
- `POST /api/v1/embed/quotes/:id/checkout` (Stripe retries)
- `POST /api/v1/billing/checkout`
- `POST /api/v1/webhooks/stripe` (Stripe already sends an event id; we use it as the key — see §3.4)

The key is a client-generated opaque string up to 128 chars. We reject keys outside `[A-Za-z0-9_-]`.

---

## 2. Auth model

Three distinct caller contexts. Each has its own middleware.

### 2.1 Shop user (dashboard)

- Auth via **Supabase Auth**. Email + password and Google OAuth. Access token in an **HttpOnly, Secure, SameSite=Lax cookie** set by Supabase's Next.js SSR helper.
- On every dashboard route the middleware resolves the Supabase session server-side, loads `shop_id` from a `shop_members` row (v1: one shop per user, so this is a direct FK on `users`), and attaches it to the request context.
- **RLS does the real work.** The Supabase Postgres client is created with the user's JWT, and RLS policies enforce `shop_id = auth_shop_id()`. Even if a route handler has a bug that passes a mismatched id, Postgres refuses the query. This is the single most important security control in the system.
- CSRF: SameSite=Lax + `Origin` header check on all mutating routes (see §10).

### 2.2 Embed widget (unauthenticated end-customer)

Embed customers never sign up. We need to keep their quotes isolated to their browser without giving them real user accounts.

- The `<script>` snippet on the shop's website loads an iframe with `?key=EMBED_KEY`. `EMBED_KEY` is a public, non-secret identifier stored on `shops.embed_key` (rotatable — see `POST /shop/regenerate-embed-key`).
- On first load the widget POSTs to `/api/v1/embed/session` with `{embed_key}`. The server:
  1. Looks up the shop, verifies it has an active subscription.
  2. Generates a **session_token** (opaque 256-bit value, stored hashed in `embed_sessions` with columns `shop_id`, `session_hash`, `created_at`, `expires_at`, `customer_email` nullable).
  3. Returns the token in an **HttpOnly, Secure, SameSite=None cookie** scoped to `quick3dquote.com` (SameSite=None because the iframe is cross-site to the parent page, but the request itself is same-origin to our API). Also returns the token in the response body so non-cookie clients and debugging tools can work.
- Subsequent embed API calls require **both** the session cookie and the `embed_key` in the request (header `X-Embed-Key`). We check the session belongs to the shop identified by the key. Mismatch → 401.
- Sessions expire after 24 hours of inactivity, 7 days absolute. The customer's quotes are tied to the session; if they close the tab and come back, they start over (acceptable for MVP — we are not building a customer account system).

### 2.3 Server-to-server (Next.js → quote-engine)

- The quote-engine (FastAPI on Fly.io) is **never** exposed to the public internet. It has a Fly.io private IPv6 address and sits behind a Fly machine with `auto_stop`. The Next.js API routes are the only caller.
- Auth is a single shared secret in the `X-Internal-Key` header. The secret is a 32-byte random value stored in both Vercel and Fly environment variables (`INTERNAL_API_KEY`). The engine rejects any request without a matching key with a plain 401 (no body, to avoid leaking the header name to accidental public probes).
- The engine also checks `X-Request-Id` and logs it, so we can trace a customer quote through both services.
- **mTLS optional later.** If we ever expose the engine across the public internet (e.g. split providers), we upgrade to mTLS with a Fly-issued client cert. For v1, shared secret + private networking is enough.

---

## 3. Endpoint inventory

Conventions for this section: `SHOP` = authenticated shop user, `WIDGET` = embed session, `PUBLIC` = no auth required (rare — really only the session bootstrap), `STRIPE` = signature-verified Stripe webhook, `INTERNAL` = server-to-server shared secret. "RL" = rate limit budget (§5). "Idem" = whether the endpoint honours `Idempotency-Key`.

All error responses follow the shape in §6.

### 3.1 Public / widget endpoints

#### `POST /api/v1/embed/session`

Bootstraps a widget session. Caller: `PUBLIC`.

```ts
// Request
{
  embed_key: string;        // 32-char public shop identifier
  referrer: string | null;  // document.referrer from the host page; logged for abuse triage
}

// Response 200
{
  session_token: string;    // also set as HttpOnly cookie
  expires_at: string;       // ISO-8601
  shop: {
    id: string;
    name: string;
    accent_colour: string;  // hex
    logo_url: string | null;
    currency: "GBP";
    supported_formats: ("stl" | "obj" | "3mf")[];
    max_file_bytes: number;
    materials: MaterialPublic[];  // active materials only; no cost data
    processes: ProcessPublic[];   // names + turnaround days only
  };
}
```

- Errors: `404 shop_not_found`, `403 subscription_inactive`, `429 rate_limited`.
- RL: 10/min per IP, 30/min per `embed_key`.
- Idem: yes, but rarely useful; provided for completeness.

#### `POST /api/v1/embed/upload-url`

Returns a presigned R2 PUT URL. Caller: `WIDGET`.

```ts
// Request
{
  filename: string;         // original filename; sanitised server-side
  content_type: "model/stl" | "model/obj" | "model/3mf" | "application/octet-stream";
  size_bytes: number;       // must be <= shop.max_file_bytes
}

// Response 200
{
  upload_url: string;       // R2 presigned PUT, 10-min TTL
  r2_key: string;           // meshes/{shop_id}/{session_id}/{uuid}-{sanitised_filename}
  expires_at: string;
  required_headers: {       // client must send these on the PUT
    "Content-Type": string;
    "Content-Length": string;
  };
}
```

- Errors: `400 file_too_large`, `400 unsupported_format`, `401 invalid_session`, `403 subscription_inactive`, `429 rate_limited`.
- RL: 10/min per IP, 20/min per `session_token`.
- Idem: no — client should just request a new URL if the first upload fails.

The URL is narrowly scoped: PUT only, exact key, exact `Content-Length` upper bound, 10-minute expiry.

#### `POST /api/v1/embed/quotes`

Creates a quote from an uploaded mesh. Caller: `WIDGET`.

```ts
// Request
{
  r2_key: string;
  material_id: string;
  process_id: string;
  quantity: number;           // int, 1..1000
  customer_email: string;     // validated RFC 5322; optional until checkout
  customer_phone: string | null;
  notes: string | null;       // max 2000 chars
}

// Response 201
{
  id: string;                  // quote id, UUID
  status: "quoted";
  mesh: {
    volume_cm3: number;
    surface_area_cm2: number;
    bbox_mm: { x: number; y: number; z: number };
    triangle_count: number;
    watertight: boolean;
    repairable: boolean;
  };
  pricing: {
    unit_price_pence: number;
    material_cost_pence: number;
    machine_cost_pence: number;
    setup_cost_pence: number;
    markup_pence: number;
    subtotal_pence: number;
    total_pence: number;         // includes qty + min_order clamp
    currency: "GBP";
    breakdown_lines: { label: string; amount_pence: number }[];
  };
  expires_at: string;            // 24h; after expiry we re-price on fetch
}
```

- Errors: `400 invalid_mesh`, `400 mesh_not_watertight_and_unrepairable`, `401 invalid_session`, `404 material_not_found`, `404 process_not_found`, `422 mesh_analysis_failed`, `429 rate_limited`, `502 quote_engine_unavailable`, `504 quote_engine_timeout`.
- RL: 60/min per `embed_key`, 20/min per `session_token`, 10/min per IP (see §5).
- Idem: yes — critical. A widget customer double-clicking "Get quote" must not create two quotes.

Handler pipeline:

1. Validate body with Zod.
2. HEAD the r2_key; verify it's under `meshes/{shop_id}/{session_id}/` and the size is under the cap.
3. Call `POST /analyze-mesh` on the quote-engine (§4). 30s timeout, 2 retries with jittered backoff.
4. Load material + process rows (RLS not applicable — we're server-side and have the shop context from the session).
5. Call `POST /price`.
6. Insert `quotes` row + `quote_events('created')` audit row (§9).
7. Return the shape above.

#### `GET /api/v1/embed/quotes/:id`

Fetch own quote. Caller: `WIDGET`. Returns the same shape as the POST response. Fails with `404 quote_not_found` if the session doesn't own the quote (we deliberately do not leak existence).

- RL: 120/min per `session_token` (the widget may poll during status updates).
- Idem: n/a (GET).

#### `POST /api/v1/embed/quotes/:id/checkout`

Creates a Stripe Checkout session for the quote. Caller: `WIDGET`.

```ts
// Request
{
  success_url: string;    // must match shop.allowed_redirect_origins
  cancel_url: string;
  customer_email: string; // required now if not captured earlier
}

// Response 200
{
  checkout_url: string;
  expires_at: string;     // Stripe sessions expire in 24h
}
```

- Errors: `400 invalid_redirect_url`, `404 quote_not_found`, `409 quote_expired`, `409 quote_already_paid`, `502 stripe_error`.
- RL: 6/min per `session_token`.
- Idem: yes (keyed by quote id if no explicit key).

Stripe session is created **on the shop's connected Stripe account** (destination charges deferred to v1.1; for v1 the shop has supplied their own Stripe secret via OAuth or direct key entry — see `docs/security.md`). The `client_reference_id` is the quote id; the webhook handler uses it to reconcile.

### 3.2 Shop dashboard endpoints

All of these require `SHOP` auth. RLS ensures multi-tenant isolation regardless of handler bugs.

#### Materials CRUD

```
GET    /api/v1/materials            -> Material[]
POST   /api/v1/materials            -> Material
PATCH  /api/v1/materials/:id        -> Material
DELETE /api/v1/materials/:id        -> 204
```

```ts
// Material
{
  id: string;
  name: string;                 // 1..80 chars
  process_id: string;
  price_pence_per_cm3: number;  // int, > 0
  density_g_per_cm3: number;    // decimal
  colour_hex: string;           // "#RRGGBB"
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

- Errors: `400 validation_error`, `404 material_not_found`, `409 material_in_use` (delete blocked if referenced by open quotes — soft-delete via `is_active=false` instead).
- RL: 120/min per shop user.
- Idem: yes on POST/PATCH/DELETE.

#### Processes CRUD

Same pattern, under `/api/v1/processes`.

```ts
// Process
{
  id: string;
  name: string;                          // "FDM", "SLA", or custom
  kind: "FDM" | "SLA" | "OTHER";
  hourly_rate_pence: number;
  setup_fee_pence: number;
  min_order_pence: number;
  markup_percent: number;                // 0..500
  throughput_cm3_per_hour: number;       // > 0
  turnaround_days: number;               // 1..60
  is_active: boolean;
}
```

#### Quotes list and detail

```
GET /api/v1/quotes?status=&cursor=&limit=
GET /api/v1/quotes/:id
PATCH /api/v1/quotes/:id
```

```ts
// GET /quotes query
{
  status?: "quoted" | "paid" | "in_production" | "shipped" | "cancelled";
  cursor?: string;            // opaque; base64({created_at, id})
  limit?: number;             // 1..100, default 25
  q?: string;                 // search email or quote id prefix
}

// Response
{
  items: QuoteSummary[];
  next_cursor: string | null;
}

// QuoteSummary
{
  id: string;
  status: string;
  customer_email: string;
  total_pence: number;
  created_at: string;
  material_name: string;
  process_name: string;
  quantity: number;
}

// GET /quotes/:id Response
{
  ...QuoteSummary,
  mesh: { ... };
  pricing: { ... };
  mesh_download_url: string;     // signed R2 GET, 24h TTL, generated on read
  events: QuoteEvent[];          // §9
  stripe_payment_intent_id: string | null;
}

// PATCH /quotes/:id body
{
  status?: "in_production" | "shipped" | "cancelled";
  tracking_number?: string;
  tracking_carrier?: string;
  internal_notes?: string;
}
```

- Errors: `400 invalid_status_transition` (e.g. shipped → quoted), `404 quote_not_found`.
- RL: 300/min per shop user on GET, 60/min on PATCH.
- Idem: yes on PATCH.

Signed download URL is generated fresh on every read (never cached in the row) and logged as a `quote_events('mesh_downloaded')` entry on first click.

#### Shop settings

```
GET   /api/v1/shop                 -> Shop
PATCH /api/v1/shop                 -> Shop
POST  /api/v1/shop/regenerate-embed-key -> { embed_key, rotated_at }
```

```ts
// Shop
{
  id: string;
  name: string;
  logo_url: string | null;
  accent_colour: string;
  embed_key: string;
  allowed_redirect_origins: string[];   // exact origins for success/cancel URLs
  max_file_bytes: number;               // default 100MB
  supported_formats: ("stl" | "obj" | "3mf")[];
  currency: "GBP";
  subscription: {
    status: "active" | "past_due" | "canceled" | "incomplete";
    plan: "solo";
    current_period_end: string;
  };
}
```

Rotating the embed key immediately invalidates all existing widget sessions for that shop (cascading delete on `embed_sessions where shop_id=...`). This is the break-glass action when a shop thinks their key has been abused. RL: 1/min per shop.

### 3.3 Billing

```
POST /api/v1/billing/checkout     -> { checkout_url }
POST /api/v1/billing/portal       -> { portal_url }
```

Both require `SHOP`. The checkout endpoint creates a subscription Checkout session for the £50/mo plan; the portal endpoint returns a Stripe customer portal link (Stripe handles the UI for cancelling, updating card, viewing invoices). No state is mutated on our side here — that all flows through webhooks.

- Errors: `409 already_subscribed` on checkout, `404 no_stripe_customer` on portal (shouldn't happen post-signup), `502 stripe_error`.
- RL: 10/min per shop.
- Idem: yes on checkout.

### 3.4 Webhooks

#### `POST /api/v1/webhooks/stripe`

Receives Stripe events. Caller: `STRIPE`.

- Signature verified with `stripe.webhooks.constructEvent(rawBody, signature, SIGNING_SECRET)`. **Raw body is required** — Next.js route handler disables body parsing for this route and reads the stream directly.
- **Idempotency**: every event has `event.id`. We insert into `webhook_events (event_id PK, type, received_at, processed_at, payload)` with `ON CONFLICT (event_id) DO NOTHING`. If conflict, we return 200 immediately without re-processing. This is the single source of truth for "have we seen this?"
- Events we act on:
  - `customer.subscription.created / updated / deleted` → update `shops.subscription_status`, `current_period_end`.
  - `invoice.payment_failed` → mark `past_due`, email shop.
  - `checkout.session.completed` (mode=payment, customer-side) → mark `quotes.status=paid`, insert `quote_events('paid')`, email shop.
  - `payment_intent.succeeded` → redundancy confirmation; idempotent.
  - Anything else → stored but unhandled (we return 200 so Stripe doesn't retry forever).
- RL: Stripe's own retry budget; we don't apply our limiter here. We do drop requests whose signature fails before any DB work.

---

## 4. Quote-engine contract

Internal FastAPI service. Python 3.11 + trimesh. Always returns JSON. All endpoints require `X-Internal-Key`.

### 4.1 `POST /analyze-mesh`

```ts
// Request
{
  r2_key: string;            // engine fetches the file itself via R2 S3 API with its own credentials
}

// Response 200
{
  volume_cm3: number;        // 2dp
  surface_area_cm2: number;  // 2dp
  bbox_mm: { x: number; y: number; z: number };
  triangle_count: number;
  watertight: boolean;
  repairable: boolean;       // true if trimesh.repair could close it
  warnings: string[];        // e.g. ["non_manifold_edges", "inverted_normals"]
}

// Response 422
{ error: "invalid_mesh", detail: string }
```

- Failure modes:
  - Unreadable file → 422 `invalid_mesh`.
  - Non-watertight AND non-repairable → 200 with `watertight: false, repairable: false`. The Next.js caller decides whether to reject the quote (for MVP: we reject).
  - File larger than engine memory budget → 413; Next.js surfaces as `file_too_large`.
- Retry strategy: Next.js retries up to 2 times with 500ms + 1500ms backoff on 5xx or timeout. The operation is pure (no side effects except logs) so retries are safe.
- Timeout: 30s. Realistically a 50MB STL analyses in 2–5s.

### 4.2 `POST /price`

```ts
// Request
{
  volume_cm3: number;
  material: {
    price_pence_per_cm3: number;
    density_g_per_cm3: number;
  };
  process: {
    hourly_rate_pence: number;
    setup_fee_pence: number;
    min_order_pence: number;
    markup_percent: number;
    throughput_cm3_per_hour: number;
  };
  quantity: number;
}

// Response 200
{
  unit_price_pence: number;
  material_cost_pence: number;
  machine_cost_pence: number;
  setup_cost_pence: number;
  markup_pence: number;
  subtotal_pence: number;
  total_pence: number;
  breakdown_lines: { label: string; amount_pence: number }[];
}
```

- This endpoint is **pure** — given the same input, it always returns the same output. Trivially retriable. We could cache responses by a hash of the input for 1h, but MVP skips that; the calculation takes <1ms.
- No 4xx path for valid Zod-shaped input; any failure is a 500 bug.

### 4.3 Engine health

`GET /healthz` returns `{status: "ok", version: "..."}`. Next.js does not depend on this at request time; Fly.io uses it for health checks.

---

## 5. Rate limiting

Single rate-limiter implementation. **Upstash Redis** (serverless Redis, HTTP API, works from Vercel Edge/serverless with zero connection pooling). Rejected: Supabase row-based counters — they'd add write pressure to the main Postgres and be slower. Upstash is ~£10/mo at our anticipated volume and has a generous free tier.

Each limit is a sliding-window counter: key = `rl:{scope}:{identifier}:{route_bucket}`, value = count, TTL = window.

### 5.1 Budgets

| Scope | Route bucket | Limit | Window |
|---|---|---|---|
| IP | `POST /embed/session` | 10 | 1 min |
| embed_key | `POST /embed/session` | 30 | 1 min |
| IP | `POST /embed/upload-url` | 10 | 1 min |
| session_token | `POST /embed/upload-url` | 20 | 1 min |
| IP | `POST /embed/quotes` | 10 | 1 min |
| embed_key | `POST /embed/quotes` | 60 | 1 min |
| session_token | `POST /embed/quotes` | 20 | 1 min |
| session_token | `GET /embed/quotes/:id` | 120 | 1 min |
| session_token | `POST /embed/quotes/:id/checkout` | 6 | 1 min |
| shop_user | dashboard GET | 300 | 1 min |
| shop_user | dashboard mutating | 60 | 1 min |
| shop_user | `POST /shop/regenerate-embed-key` | 1 | 1 min |

On limit: respond `429 rate_limited` with `Retry-After` header and an error body (see §6).

### 5.2 IP derivation

`X-Forwarded-For` first entry, cross-checked against Vercel's `x-vercel-forwarded-for`. For widget endpoints we also accept a `Cf-Connecting-Ip` if present (Cloudflare Worker path — not in MVP but the code is ready).

---

## 6. Error format

**Decision: simple custom shape, not RFC 7807.** RFC 7807 Problem+JSON is fine but its `type: URI` field is dead weight — we'd never serve a docs page at that URI in v1, and shops debugging their widget in devtools benefit more from a flat, readable object than a spec-conformant one. We borrow the useful bits (machine-readable code, human message, optional detail) without the URI overhead. We can adopt 7807 in v2 if we publish a public API.

```ts
// All error responses
{
  error: {
    code: string;               // stable machine identifier
    message: string;            // human English, safe to show end users for some codes
    detail?: unknown;           // Zod issue list, or {field: reason} map
    request_id: string;         // matches X-Request-Id; logged server-side
  };
}
```

HTTP status is set appropriately (400/401/403/404/409/422/429/5xx). Error responses never leak stack traces, SQL, or row contents.

### 6.1 Defined error codes

| Code | HTTP | Notes |
|---|---|---|
| `validation_error` | 400 | Zod parse failed; `detail` is the issue list |
| `invalid_mesh` | 400 | Engine couldn't parse the file |
| `mesh_not_watertight_and_unrepairable` | 400 | Shop can disable this gate later |
| `file_too_large` | 400 | Over shop's `max_file_bytes` |
| `unsupported_format` | 400 | Extension not in shop's allow-list |
| `invalid_redirect_url` | 400 | Not in `allowed_redirect_origins` |
| `invalid_status_transition` | 400 | e.g. shipped → quoted |
| `invalid_session` | 401 | session_token missing/expired/mismatched |
| `unauthorized` | 401 | Shop JWT missing or invalid |
| `subscription_inactive` | 403 | Shop's subscription is not `active` or `trialing` |
| `forbidden` | 403 | RLS or role denied |
| `quote_not_found` | 404 | Also returned for cross-tenant lookups |
| `material_not_found` | 404 | |
| `process_not_found` | 404 | |
| `shop_not_found` | 404 | Bad embed_key |
| `no_stripe_customer` | 404 | Portal called before checkout completed |
| `quote_already_paid` | 409 | Double-checkout attempt |
| `quote_expired` | 409 | Price older than 24h |
| `material_in_use` | 409 | Delete blocked |
| `already_subscribed` | 409 | Checkout called when active |
| `mesh_analysis_failed` | 422 | Engine returned 422 |
| `rate_limited` | 429 | Include `Retry-After` |
| `stripe_error` | 502 | Wrap Stripe SDK errors; log full, expose code only |
| `quote_engine_unavailable` | 502 | Engine returned 5xx after retries |
| `quote_engine_timeout` | 504 | Engine exceeded 30s |
| `internal_error` | 500 | Catch-all; always includes request_id |

---

## 7. Validation

- Zod schemas live in `packages/schemas/src/` and are imported by both the Next.js routes and the React forms. Single source of truth for shape.
- Each route file exports its schemas: `export const CreateQuoteBody`, `export const CreateQuoteResponse`. Response schemas are used in tests (§11) to assert we don't accidentally widen the contract.
- We install `zod-to-openapi` and keep a build step that emits `openapi.json` to `packages/schemas/dist/` on every build. **We do not publish this in v1** — no public API yet — but having it generated means when we do (v1.1 or v1.2), it's one Vercel route away.
- Inputs are parsed with `.strict()` by default; unknown fields are rejected, which prevents accidental pass-through of sensitive data the client tried to set (`shop_id`, `is_admin`, etc.).

---

## 8. Pagination and filtering

**Cursor-based, most-recent-first, for `/quotes`.** Offset pagination gets progressively wrong as new quotes arrive mid-scroll; cursors are stable.

- Cursor = base64(`{created_at, id}`). The query is `WHERE (created_at, id) < (cursor.created_at, cursor.id) ORDER BY created_at DESC, id DESC LIMIT :limit`.
- `next_cursor` is null when the returned set is smaller than the requested limit.
- Filters combine with AND: `status`, `q` (email prefix or quote id prefix), date range (`from`, `to`) once we add it (deferred v1.1).
- Materials and processes lists are small (typically <50 rows per shop), so they return unpaginated in MVP. If a shop passes 100 materials we'll page; the Zod response already allows `items` + optional `next_cursor`.

---

## 9. Audit log

Table: `quote_events (id, quote_id, shop_id, type, actor_type, actor_id, data jsonb, created_at)`.

Endpoints that write:

| Endpoint | Event type | Actor |
|---|---|---|
| `POST /embed/quotes` | `created` | `customer` (session_token hash) |
| `POST /embed/quotes/:id/checkout` | `checkout_initiated` | `customer` |
| `POST /webhooks/stripe` (checkout.session.completed) | `paid` | `system` |
| `PATCH /quotes/:id` (status change) | `status_changed` | `shop_user` |
| `PATCH /quotes/:id` (tracking added) | `tracking_added` | `shop_user` |
| `GET /quotes/:id` (shop first download) | `mesh_downloaded` | `shop_user` |
| `POST /shop/regenerate-embed-key` | `embed_key_rotated` | `shop_user` (written to `shop_events`, not `quote_events`) |

The rule: any state-changing event visible to either the shop or the customer goes in the audit log. The events are surfaced in the quote detail UI as a timeline.

---

## 10. Security

### 10.1 CSRF

- Dashboard uses cookie auth. CSRF risk is real.
- Mitigations:
  1. `SameSite=Lax` on the Supabase session cookie (default) — blocks cross-site POSTs.
  2. `Origin` header check on every mutating dashboard route: must match `https://quick3dquote.com` (or the preview domain in staging). Reject with 403 otherwise.
  3. We do not use a double-submit CSRF token; SameSite=Lax + Origin check is sufficient for our threat model (no sensitive GETs that mutate state, no legacy browsers without SameSite support targeted).

### 10.2 CORS

- **Widget endpoints (`/api/v1/embed/*`)**: `Access-Control-Allow-Origin: *` for `OPTIONS` preflight; credentials are carried via SameSite=None cookies, which requires an explicit origin — so the real answer is `Access-Control-Allow-Origin: <Origin>` reflected from the request, `Access-Control-Allow-Credentials: true`, allowed methods `GET, POST, OPTIONS`, allowed headers `Content-Type, X-Embed-Key, Idempotency-Key`. We deliberately **do not** restrict by origin on widget routes — the whole point is third-party embedding. The `embed_key` + per-shop `allowed_redirect_origins` controls do the tenant-scoping.
- **Dashboard endpoints (`/api/v1/` non-embed)**: no CORS headers set → browser blocks cross-origin reads. Only our own origin can call them.
- **Webhook endpoints**: no CORS (server-to-server).
- **Quote-engine endpoints**: not exposed publicly; CORS is irrelevant.

### 10.3 Content-Security-Policy

The embed page at `/embed` is iframed by arbitrary third-party sites. CSP:

- `frame-ancestors *;` — any site can iframe us. This is the product.
- `default-src 'self';` — no inline scripts, no third-party JS except what we explicitly allowlist (Stripe.js).
- `script-src 'self' https://js.stripe.com;`
- `connect-src 'self' https://*.r2.cloudflarestorage.com https://api.stripe.com;`
- `img-src 'self' data: https:;`
- `style-src 'self' 'unsafe-inline';` — Tailwind JIT produces inline styles; acceptable for now.
- `worker-src 'self' blob:;` — three.js uses web workers for some loaders.

The marketing and dashboard pages get a stricter CSP with `frame-ancestors 'none'`.

### 10.4 Other

- HSTS on `quick3dquote.com` with 1-year max-age + preload.
- All cookies `HttpOnly`, `Secure`, `SameSite=Lax` (dashboard) or `SameSite=None` (embed).
- Presigned R2 URLs scoped as tightly as possible: exact key, method, max size, 10-min TTL.
- No PII in URL paths — customer email lives in request bodies only.
- `request_id` (ULID) generated at edge, propagated through headers to the quote-engine and back, included in every log line and error response.

---

## 11. Testing

### 11.1 Stripe webhooks locally

- `stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe` from the Stripe CLI, run alongside `pnpm dev`.
- Trigger fixtures with `stripe trigger checkout.session.completed` etc. We maintain a `scripts/stripe-fixtures/` folder of edited event payloads that carry a test `quote_id` in `client_reference_id`.
- The `webhook_events` table is the integration-test oracle: after each trigger we assert a row was inserted and the downstream side-effect (quote status, subscription status) applied.

### 11.2 Contract tests between Next.js and quote-engine

- Shared schemas: `packages/schemas/src/engine.ts` exports Zod definitions for the `/analyze-mesh` and `/price` request/response bodies. The Next.js client parses every response against these; contract drift fails CI.
- The Python side uses Pydantic models generated from the same OpenAPI document (we publish `openapi.json` from the Zod schemas and use `datamodel-code-generator` to emit Python types). This is one-way generation: Zod is the source of truth.
- An integration test suite (`apps/quote-engine/tests/test_contract.py`) spins up the engine in a container, posts canned fixture meshes, and snapshot-compares responses. A separate suite in `apps/web/tests/engine-client.test.ts` hits the engine via the real HTTP client and asserts schema parse.
- Unit tests for pricing: a small table of `(volume, material, process, qty) → expected_total` vectors lives in both services and is asserted in both to prevent silent divergence.

### 11.3 Widget end-to-end

- Playwright runs a harness page that iframes the embed URL with a test shop's embed_key and drives the upload flow with a fixture STL. Assertions against the quote detail endpoint verify the round-trip.

### 11.4 Load/fuzz

- A weekly CI job runs `autocannon` against `/api/v1/embed/quotes` with a small warm fixture, to catch regressions in p95 latency. Target: <500ms p95 end-to-end (including engine call) for a 20MB STL.
- Zod schemas are fuzzed with `fast-check` at PR time to ensure no valid input crashes a handler.

---

## Appendix A — Route auth matrix (quick reference)

| Route | Auth |
|---|---|
| `POST /api/v1/embed/session` | PUBLIC |
| `POST /api/v1/embed/upload-url` | WIDGET |
| `POST /api/v1/embed/quotes` | WIDGET |
| `GET  /api/v1/embed/quotes/:id` | WIDGET |
| `POST /api/v1/embed/quotes/:id/checkout` | WIDGET |
| `GET/POST/PATCH/DELETE /api/v1/materials` | SHOP |
| `GET/POST/PATCH/DELETE /api/v1/processes` | SHOP |
| `GET /api/v1/quotes` | SHOP |
| `GET /api/v1/quotes/:id` | SHOP |
| `PATCH /api/v1/quotes/:id` | SHOP |
| `GET/PATCH /api/v1/shop` | SHOP |
| `POST /api/v1/shop/regenerate-embed-key` | SHOP |
| `POST /api/v1/billing/checkout` | SHOP |
| `POST /api/v1/billing/portal` | SHOP |
| `POST /api/v1/webhooks/stripe` | STRIPE |
| `POST /analyze-mesh` (engine) | INTERNAL |
| `POST /price` (engine) | INTERNAL |

---

File: `C:/Users/Olly/Git/3d Printing Software/docs/api-design.md` — 4,555 words.
