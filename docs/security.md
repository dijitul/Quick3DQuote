# Security Design & Threat Model — Quick3DQuote

> Owner: Security Engineer agent. Last updated: 2026-04-21. Status: pre-alpha, design phase.
> Read `CLAUDE.md` first for product context. This document is the source of truth for security decisions.

This is a pragmatic threat model for an embeddable, multi-tenant SaaS that handles mesh uploads, payments and tenant-scoped data. It prioritises realistic attacker paths over exhaustive coverage. We design for a solo-founder blast radius: minimise what we custody, lean on battle-tested providers (Stripe, Supabase, Cloudflare), and ruthlessly constrain the surface we own.

---

## 1. Asset inventory & trust boundaries

### 1.1 Assets (what we protect, ranked by blast radius)

| Asset | Sensitivity | Where it lives | Why it matters |
|---|---|---|---|
| **Supabase `service_role` key** | Critical | Vercel env var (server only), Fly secret | Bypasses RLS entirely. Leak = total tenant isolation collapse. |
| **Stripe secret key (`sk_live_…`)** | Critical | Vercel env var | Can create charges, refunds, customers. Leak = direct financial loss. |
| **Stripe webhook signing secret** | Critical | Vercel env var | Forged webhooks could mark unpaid orders as paid. |
| **R2 access key / secret** | Critical | Vercel env var, Fly secret | Leak = read/delete every mesh across every shop. |
| **Fly→Next shared HMAC secret** | High | Vercel + Fly secrets | Authenticates quote-engine calls. Leak = attacker can call engine directly. |
| **Customer mesh files (STL/OBJ/3MF)** | High | R2, `r2://meshes/{shop_id}/{quote_id}/…` | Often IP-sensitive (prototype parts, dental moulds). |
| **Customer PII** | High | Supabase `quotes` rows (email, phone, shipping address) | GDPR personal data; minimum set only. |
| **Shop `embed_key`** | Medium | `shops.embed_key`, public in embed script | Public by design, but rate-limited. Leak just means impersonation at shop level. |
| **Shop account credentials** | High | Supabase Auth | Access to shop dashboard, quotes, payouts config. |
| **Shop business data** (materials, pricing, customer list) | Medium | Supabase, RLS-scoped | Competitor intel value; leak undermines trust. |
| **Card PANs / CVV** | N/A — **we never see them** | Stripe-hosted checkout only | SAQ-A scope. Do not change this without rewriting this doc. |

### 1.2 Trust boundaries

Each arrow below crosses a trust boundary — data must be revalidated on the far side.

```
[Customer browser]    ──► [Cloudflare CDN / Vercel Edge]    untrusted → semi-trusted
[Shop host page]      ──► [our iframe embed]                fully untrusted → our code
[Embed iframe]        ──► [Next.js API lambdas]             anon w/ embed_key → server
[Dashboard SPA]       ──► [Next.js API lambdas]             authenticated user → server
[Next.js lambda]      ──► [Supabase (anon/user JWT)]        server → RLS-enforced DB
[Next.js lambda]      ──► [Supabase (service_role)]         server → RLS-bypassing DB (justify each call)
[Next.js lambda]      ──► [Fly quote-engine]                server → server, HMAC signed
[Browser]             ──► [R2 presigned PUT]                client → bucket, scoped URL
[Stripe]              ──► [Next.js webhook endpoint]        external → server, signature-verified
```

**Key rule:** the embed iframe is our code running on an adversarial host page. It holds nothing the host page can exfiltrate (no session tokens, no signed URLs for other shops, no service keys).

---

## 2. STRIDE threat model

### 2.1 Spoofing

| Threat | Control |
|---|---|
| Attacker impersonates a shop by guessing `embed_key` | 32-byte URL-safe random (≥128 bits entropy). Rotatable from dashboard. `embed_key` authorises *creation* only, not reads. |
| Attacker forges a Supabase session JWT | Supabase JWTs are RS256 (asymmetric). Never accept `alg: none` or HS256 with public key. Validate issuer, audience, expiry on every server call. |
| Attacker forges Stripe webhook calls | `stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)`. Reject any request without a valid `Stripe-Signature` header. Never parse the JSON before verifying. |
| Attacker spoofs Fly→Next traffic | Fly engine is not public. `quote-engine.internal` + Fly private networking + HMAC-signed request bodies (`X-Q3Q-Signature: sha256=…`) with a shared secret. Reject if clock skew >5 min (anti-replay). |
| Attacker impersonates a shop-owner for password reset | Supabase handles this. Enable email confirmation + rate-limit reset requests. |

### 2.2 Tampering

| Threat | Control |
|---|---|
| Client tampers with submitted price before Checkout | **Price is never accepted from the client.** Client sends `{quote_id, material_id, quantity}`. Server re-runs the quote-engine calc using DB-stored material and process values, then creates the Stripe Checkout line item server-side. |
| Client tampers with `shop_id` in request body | `shop_id` is derived from session (dashboard) or from the `embed_key → shops` lookup (widget). Never read `shop_id` from the body. |
| Attacker modifies shop's materials via IDOR | RLS on `materials` table: `shop_id = (select shop_id from shop_users where user_id = auth.uid())`. Dashboard uses the anon client with user JWT — RLS enforced. |
| Mesh file swap between upload and analysis (TOCTOU) | Quote engine fetches the mesh by object key that includes `{shop_id}/{quote_id}/{sha256}`. Hash is computed server-side after upload completes and stored in `quotes.mesh_sha256`. Engine refuses to analyse if the R2 object's ETag (content MD5/hash) doesn't match. |
| In-flight tampering | TLS 1.2+ everywhere. HSTS with `includeSubDomains; preload` on `quick3dquote.com`. |

### 2.3 Repudiation

We cannot prove *intent*, but we make the evidentiary trail hard to deny:

- **Immutable audit log table** (`audit_events`) written server-side for: quote created, Stripe Checkout session created, payment succeeded, order status changed, shop materials edited. Append-only (no UPDATE/DELETE grants). Include `actor`, `ip`, `user_agent`, `event_id`, `payload_hash`.
- **Stripe is authoritative for payments.** We store `stripe_event_id`, `stripe_checkout_session_id`, `stripe_payment_intent_id`. If a customer disputes, we can reconcile with Stripe's own log.
- **Webhook events persisted** in `webhook_events(event_id PK, payload, received_at, processed_at)` before any state change. This is both idempotency and non-repudiation evidence.
- **Customer order confirmation email** is sent via Stripe Checkout — Stripe retains sending logs.

### 2.4 Information disclosure

| Threat | Control |
|---|---|
| Cross-tenant data leak via a missing `shop_id` filter | RLS everywhere. Every tenant-scoped table has a policy; we add a CI test that enumerates all tables and fails if any is RLS-off without explicit allowlist. |
| Signed URL abuse (URL shared/scraped) | Short TTL (5 min for upload PUTs, 15 min for download GETs in widget, 24 h for shop-side downloads). Signed URLs bound to a single object key; no wildcards. |
| RLS bypass via SQL | Never use `service_role` for user-driven reads. All reads from the dashboard go via the user-JWT'd Supabase client. Every `service_role` use is documented in `/docs/security.md` §5. |
| Browser DevTools pulling *another* shop's config from our iframe | Our iframe only ever loads data for the shop matching the `embed_key` in the URL. Server-side enforcement — the `embed_key` is never trusted to grant reads beyond its own shop's public config (materials, branding). |
| Verbose error responses leak internals | Error middleware in Next API routes: log full error server-side (Sentry), return `{code, requestId}` to client. Never return stack traces. `NODE_ENV=production` in deployed env. |
| Cache leak (CDN serving tenant A's data to tenant B) | All authenticated/tenant-scoped API responses: `Cache-Control: private, no-store`. Public-ish endpoints (embed init) keyed by `embed_key` in the URL path so different shops don't share cache keys. |
| Direct R2 URL enumeration | R2 bucket is private. No public listing. All access via signed URLs. Bucket name does not leak shop identity. |

### 2.5 Denial of service

| Threat | Control |
|---|---|
| Upload flood exhausts a shop's R2 budget | Signed upload URL enforces `Content-Length` limit (100 MB default). Per-shop daily upload quota enforced at the URL-minting endpoint (e.g. 500 uploads/day). Per-IP + per-embed_key rate limit on the minting endpoint. |
| CPU-bomb mesh (2 GB STL via stream, pathological triangle count) | (a) Max 100 MB enforced at signed URL. (b) Quote engine pre-check: stream-parse header; if triangle count >10M, reject with `MESH_TOO_COMPLEX`. (c) Hard 30 s timeout on `trimesh.load()`; kill worker on timeout. (d) Fly engine is a worker pool with a concurrency cap per-machine; overload returns 503 not OOM. |
| Repeated quote calls to exhaust engine | Every `/quote` call requires a fresh mesh upload OR references an already-analysed `quote_id` (cached). Re-quoting with only a material change hits cache. Rate-limit: 30 new-mesh analyses per embed_key per hour, burst 5. |
| Zip bomb via 3MF (3MF = zip container) | See §3.4. Refuse 3MFs whose total uncompressed size >200 MB, or compression ratio >100×, or contain paths outside the archive. |
| Algorithmic complexity on JSON parse | Body size cap (500 KB) on all API routes except upload-init (which has no body payload, just URL minting). |
| Login/password-reset flood | Supabase built-in rate limits + our own per-IP limit on `/auth/*` proxy routes. |
| Widget embedded on a viral site (legit spike) | See §9 — the rate limits are tiered per-shop-plan, and embed requests use a stale-while-revalidate cache for shop branding/materials to minimise origin load. |

### 2.6 Elevation of privilege

| Threat | Control |
|---|---|
| `service_role` key leaks to browser | Server-only env var. Never in `NEXT_PUBLIC_*`. A CI lint step greps built JS bundles for the key and fails the build if found. Only referenced in files under `src/server/**` which is excluded from client imports by `eslint-plugin-import` rule. |
| `SECURITY DEFINER` functions escalate | Keep to a minimum. Each one is listed in `db-schema.md` with a justification (e.g. "`create_quote_from_embed` — needs to insert into `quotes` as anon user; runs as `authenticator`, not `postgres`; revokes `EXECUTE` from `PUBLIC` and grants only to `anon`"). Review these like we review kernel modules. |
| JWT forgery / algorithm confusion | Use Supabase's own JWT verification in `@supabase/supabase-js` — don't hand-roll. Explicit `algorithms: ['RS256']` if we ever verify manually. |
| A shop becomes super-admin via role bump | `role` column in `shop_users` is never writable via the dashboard. Super-admin is a separate `is_super_admin` flag in a separate `admins` table, writable only by DB migration. |
| Stripe Customer Portal session lets a shop change another shop's billing | Portal sessions are created server-side with the shop's own `stripe_customer_id` looked up via RLS. Never pass customer_id from the client. |

---

## 3. File upload security

This is the highest-risk surface. Unauthenticated (well, embed_key-gated) uploads of arbitrary binary content from arbitrary web origins.

### 3.1 Flow

1. Widget requests `POST /api/embed/upload-init` with `{embed_key, filename, size, content_type}`.
2. Server validates: embed_key exists, plan allows uploads, size ≤100 MB, content_type ∈ allowlist, filename passes `^[A-Za-z0-9._-]{1,120}$`.
3. Server mints R2 presigned PUT URL scoped to `r2://meshes/{shop_id}/{quote_id}/{uuid}.{ext}`, valid 5 min, with `Content-Length` and `Content-Type` constraints.
4. Browser PUTs directly to R2.
5. Widget calls `POST /api/embed/upload-complete` with `{quote_id}`. Server HEADs the object, confirms size, reads first N bytes, validates magic bytes, computes SHA-256 server-side (streaming), stores `mesh_sha256` and `mesh_byte_size`.
6. Server enqueues quote-engine job; engine re-fetches by exact key and verifies hash on load.

### 3.2 MIME allowlist + magic byte validation

Content-Type claimed by the client is advisory. We enforce:

| Extension | Accepted MIME | Magic bytes / structural check |
|---|---|---|
| `.stl` | `model/stl`, `application/sla`, `application/octet-stream` | ASCII STL starts with `solid `; binary STL: check `triangle_count * 50 + 84 == file_size`. Reject otherwise. |
| `.obj` | `model/obj`, `text/plain`, `application/octet-stream` | First non-comment token in `{v, vn, vt, f, o, g, mtllib, usemtl, s}`. Reject if file contains null bytes in first 8 KB (binary smuggling). |
| `.3mf` | `model/3mf`, `application/vnd.ms-package.3dmanufacturing-3dmodel+xml`, `application/zip` | ZIP magic `50 4B 03 04`. Must contain `[Content_Types].xml` and `3D/3dmodel.model`. |

Anything else → 415 Unsupported Media Type, logged.

### 3.3 Size enforcement — at every layer

- **Signed URL**: R2 presigned PUT is generated with `Content-Length` constraint. R2 rejects PUTs exceeding it. This is the real control — never trust client-side size checks.
- **Client-side pre-check**: UX only; rejects huge files before upload starts.
- **Post-upload HEAD**: server confirms actual size matches what the client declared. If not, delete object and fail the quote.

### 3.4 Zip bombs in 3MF

3MF is a ZIP container. Bombs are a real threat.

- Open with a streaming ZIP reader (`yauzl` in Node, `zipfile` stream mode in Python).
- Reject if **any single entry** has `uncompressed_size > 500 MB` or ratio `uncompressed/compressed > 100`.
- Reject if **sum of uncompressed sizes > 200 MB**.
- Reject filenames containing `..`, absolute paths, or path separators other than `/`. (Zip Slip.)
- Never extract to disk. Extract `3D/3dmodel.model` to an in-memory buffer with a hard size cap.

### 3.5 Mesh complexity bounds

Before `trimesh.load`:

- Parse STL header only (first 84 bytes) → triangle count. If >10 M triangles, reject `MESH_TOO_COMPLEX`.
- For OBJ, refuse files with >200 MB textual content or >10 M `f` lines (grep-based scan is fine, sub-second).
- `trimesh.load` call runs inside a subprocess with `resource.setrlimit(RLIMIT_AS, 2_000_000_000)` (2 GB) and a 30 s wall-clock timeout. If exceeded, kill and return `ANALYSIS_TIMEOUT`.

### 3.6 Never serve user-uploaded files from our origin

- Meshes are served only via **R2 signed URLs** on `meshes.quick3dquote.com` (separate subdomain, separate cookie jar from app origin).
- If we ever need to proxy (we don't, for v1), `Content-Disposition: attachment; filename="..."` + `Content-Type: application/octet-stream` + `X-Content-Type-Options: nosniff`.
- Signed URL TTL: 15 min for the widget preview fetch, 24 h for shop dashboard download link.
- 3D viewer fetches the mesh via signed URL and parses in-browser with `STLLoader`/`OBJLoader`. No server-side rendering of user content.

---

## 4. Stripe-specific

### 4.1 Webhook signature verification

```ts
// app/api/stripe/webhook/route.ts
export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text(); // MUST be raw body, not parsed JSON
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response('bad signature', { status: 400 });
  }
  // Idempotency check before any side effect
  const { error } = await supabaseAdmin
    .from('webhook_events')
    .insert({ event_id: event.id, type: event.type, payload: event, received_at: new Date() });
  if (error?.code === '23505') return new Response('duplicate', { status: 200 }); // unique violation
  await handleEvent(event);
  await supabaseAdmin.from('webhook_events').update({ processed_at: new Date() }).eq('event_id', event.id);
  return new Response('ok');
}
```

- **Raw body only** — Next.js API routes need explicit raw body capture; do not use automatic JSON parsing on this route.
- **Idempotent via unique `event_id`** — Stripe retries; we must not double-process.
- **No side effect before insert** — if the insert fails we either early-return (duplicate) or retry safely.
- Webhook secret is stored in Vercel env, rotatable via the Stripe dashboard + Vercel redeploy.

### 4.2 Price calculation — server-side only

The browser sends `{ quote_id, material_id, quantity, shipping_option }`. The Checkout-creation endpoint:

1. Loads the quote's persisted mesh metadata (`volume_cm3`, `mesh_sha256`) via service_role (justified: cross-tenant embed flow).
2. Loads the material + process from DB using `shop_id` bound to the quote (never from the client).
3. Re-computes `total` using the same formula the engine used.
4. Creates a Stripe Checkout Session with `line_items: [{ price_data: { unit_amount: total_pence, currency: 'gbp', … } }]`.
5. Stores `expected_amount_pence` on the quote row. The `checkout.session.completed` webhook verifies `event.data.object.amount_total === expected_amount_pence` before marking paid. If mismatch → alert, do not fulfil.

Never accept a `price` field from the client. Never.

### 4.3 What we log vs what we don't

- **Log** (to `audit_events` + Sentry): `event.id`, `event.type`, `checkout_session.id`, `payment_intent.id`, `customer.id`, `amount_total`, `currency`, `quote_id`.
- **Do not log**: card number (we never receive it), CVV, full billing address beyond country + postcode, Stripe raw payloads in plaintext beyond a truncated preview.
- **PCI scope**: SAQ-A. Card data flows customer → Stripe-hosted Checkout only. We never see, store, transmit, or process PANs. Do not introduce any UI that collects card data directly — doing so changes our scope to SAQ-A-EP or higher.

---

## 5. Multi-tenant isolation

### 5.1 RLS policies

Every tenant-scoped table (`shops`, `materials`, `processes`, `quotes`, `orders`, `audit_events`, etc.) has:

```sql
alter table <t> enable row level security;

create policy "<t>_shop_isolation_select" on <t> for select
  using (shop_id in (select shop_id from shop_users where user_id = auth.uid()));

create policy "<t>_shop_isolation_mod" on <t> for all
  using (shop_id in (select shop_id from shop_users where user_id = auth.uid()))
  with check (shop_id in (select shop_id from shop_users where user_id = auth.uid()));
```

### 5.2 `service_role` blast radius and justified uses

`service_role` bypasses RLS. Every use is logged in `src/server/supabase-admin.ts` and listed here. Additions require a PR that updates this doc.

| Call site | Why service_role | Mitigation |
|---|---|---|
| `POST /api/embed/*` (anon embed traffic) | Anon users have no Supabase session; we must insert `quotes` rows cross-tenant. | Endpoint authorises via `embed_key` lookup; `shop_id` derived server-side. Never echo data from other shops. |
| `POST /api/stripe/webhook` | Webhooks are from Stripe, not a user session. | Idempotent via `webhook_events.event_id`. Only touches rows keyed by `quote_id`/`customer_id` already bound to a shop. |
| `POST /api/internal/quote-engine-callback` | Fly engine is not a Supabase user. | HMAC-verified; scoped to updating a single `quotes` row by id. |
| Super-admin impersonation console | Operational. | Behind internal-only auth (IP allowlist + MFA), every use writes to `audit_events` with `actor_is_admin=true`. |

### 5.3 Anon embed flow without opening an RLS hole

- Widget authenticates with `embed_key` (NOT a Supabase JWT).
- Server exchanges `embed_key` → `shop_id` via a `service_role` lookup.
- Server uses `service_role` only for the specific insert into `quotes`, with `shop_id` set from the lookup.
- Every other operation (reading materials for the widget, reading shop branding) goes through a dedicated `SECURITY DEFINER` function `public.embed_public_config(p_embed_key text)` that returns only whitelisted public fields.
- The anon Supabase client is not given direct table grants. `GRANT USAGE ON SCHEMA public TO anon; REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;`.

---

## 6. Embed widget XSS, clickjacking, postMessage hygiene

### 6.1 Threat model for the widget

The widget iframe runs on a third-party origin we don't control. The host page is hostile-by-default from our perspective: it can try to sniff our requests, replace our iframe, message us, or frame us.

### 6.2 Controls

- **`frame-ancestors *` on `/embed` routes** — we *must* allow embedding (this is the product). Compensate with the controls below.
- **`frame-ancestors 'none'` on `/dashboard`, `/api`, `/admin`** — our own UI is not embeddable.
- **Nonce-based CSP on `/embed`**: `default-src 'self' https://*.r2.cloudflarestorage.com; script-src 'self' 'nonce-XYZ'; style-src 'self' 'nonce-XYZ'; connect-src 'self' https://*.supabase.co https://meshes.quick3dquote.com; img-src 'self' data: blob: https:; frame-ancestors *;`. No `unsafe-inline`, no `unsafe-eval`. Three.js does not need eval.
- **No cookies on the iframe's fetches** — use `credentials: 'omit'`. The `embed_key` in URL + per-request CSRF token (rotated per page-load) is our auth, not cookies. This avoids SameSite headaches and prevents the host page from piggybacking session state.
- **postMessage hygiene**: widget only posts to `window.parent` with a fixed message schema (`{type, payload}`). It ignores any inbound postMessage it didn't originate (no two-way protocol from host → widget for v1). If we add one later, we MUST validate `event.origin` against a per-shop allowlist of domains the shop configured in their dashboard.
- **No signed URLs in messages to parent**. The widget never posts signed URLs or session tokens to `window.parent`. The parent can only see what's visible in the iframe DOM, which never contains the signed URL (we fetch, stream, revoke).
- **Dashboard clickjacking**: `Content-Security-Policy: frame-ancestors 'none'` + `X-Frame-Options: DENY` (legacy).

### 6.3 XSS defence

- All user-provided text (material names, shop names, customer email) is rendered through React's default escaping. No `dangerouslySetInnerHTML` anywhere — CI lint rule enforces this.
- Shop-uploaded logos: PNG/JPG/SVG — SVG is rejected (XSS vector). Re-encode PNG/JPG server-side via `sharp` to strip EXIF/metadata.
- 3D viewer renders binary mesh data, not HTML — not an XSS vector, but see §3 for mesh-specific threats.

---

## 7. Secrets management

- **Vercel env vars** for Next.js: one set per environment (preview / production). `NEXT_PUBLIC_*` only for anon Supabase URL + anon key (safe to expose).
- **Fly secrets** for the quote engine: `fly secrets set` — never in `fly.toml`.
- **Nothing in the repo.** `.env.example` lists the var names. `.env.local` is `.gitignore`d.
- **Pre-commit hook**: `gitleaks` run via `pre-commit` hook on staged files. CI re-runs `gitleaks detect --source . --redact` on every push; blocks merge on finding.
- **CI bundle scan**: after `next build`, grep the `.next/static/**/*.js` artefacts for known secret patterns and known env var values; fail if any match.
- **Rotation cadence**:
  - Stripe keys: rotate on any suspicion, otherwise annually.
  - Supabase `service_role`: rotate on any suspicion, otherwise every 6 months. Requires redeploy.
  - R2 access keys: rotate every 6 months.
  - Shop `embed_key`: shop can rotate anytime from dashboard; forces widget redeploy on their site.
  - Fly↔Next HMAC shared secret: rotate every 6 months; support overlap window with two valid secrets for 24 h.

---

## 8. Auth hardening (Supabase)

Supabase project-level settings to set at creation:

- **Password policy**: min 10 chars, require 3 of {lower, upper, digit, symbol}, check against `haveibeenpwned` via Supabase's built-in pwned-passwords option.
- **Email confirmation required** before first login.
- **Rate limits**: sign-in 5/min/IP; password-reset 3/hour/email; sign-up 10/hour/IP.
- **Session TTL**: access token 1 h, refresh token 7 days with rotation on every refresh. Invalidate refresh chain on logout.
- **MFA (TOTP)**: optional in v1, required before alpha-release for admin/super-admin accounts.
- **Google OAuth**: restrict to `prompt=select_account`; validate `email_verified=true` on the ID token.
- **Session fixation**: Supabase rotates session tokens on login — verified.
- **Logout**: calls `signOut` + clears client storage; server-side `auth.admin.signOut(userId)` on "sign out everywhere".
- **Email change**: requires re-authentication + confirmation email to both old and new addresses.

---

## 9. Rate limiting & abuse

Limits below are per-plan defaults; upgradeable. Implemented at the edge (Vercel Edge Middleware using Upstash Redis for shared counters) keyed by `(embed_key, ip)` or `(user_id, ip)`.

| Endpoint | Limit (v1) | Reason |
|---|---|---|
| `POST /api/embed/upload-init` | 60/hour/embed_key, 10/hour/IP | Signed-URL minting; most abusable. |
| `POST /api/embed/quote` | 120/hour/embed_key, 30/hour/IP | Engine cost per call. |
| `POST /api/embed/checkout` | 30/hour/embed_key | Stripe Checkout Session creation. |
| `POST /api/auth/*` | 5/min/IP | Brute force / credential stuffing. |
| Dashboard read routes | 300/min/user | Prevent accidental self-DoS from buggy client. |
| Webhook endpoints | no limit (signature-gated) | Stripe retries legitimately. |

**Legit spike vs attack**: a viral product-page embed can easily exceed per-IP limits (one IP = one real user, but many users share NAT). We key primarily on `(embed_key, ip_prefix/24)` for IPv4 and `/48` for IPv6, and we burst to 5× for the first 60 s of a surge before tightening. Shops on the paid plan get notified via email if they hit 80% of their daily quota — not silent blocking.

**Shadow-ban mode**: once an embed_key trips an abuse heuristic (e.g. 1000 uploads from 3 IPs in 5 min with zero checkouts), we downgrade that key to 1 req/min and alert the shop, rather than returning 429. Makes it harder to tune around.

---

## 10. Logging & monitoring

### 10.1 What we log

- **Auth events**: sign-in success/failure, password reset, MFA challenge — via Supabase logs + mirrored into `audit_events` for shop-visible audit view.
- **Quote lifecycle**: created, analysed, priced, checkout-initiated, paid, fulfilled, cancelled. Include `quote_id`, `shop_id`, timestamps, IP prefix.
- **Stripe events**: every `webhook_events` row persisted. Processed-at and outcome logged.
- **Webhook failures**: full error + payload hash (not payload) to Sentry.
- **Admin actions**: impersonation start/end, shop suspension, force-refund — always.
- **Infrastructure**: Vercel + Fly access logs retained 30 days. Longer if regulator asks.

### 10.2 What we do NOT log

- **Mesh file content** — only the SHA-256 and byte size.
- **Full customer shipping address** — log country + postcode + first line only if we log at all; Stripe holds the authoritative copy.
- **Card data** — we never see it; there is nothing to redact.
- **Passwords** — ever. Not even hashed. Supabase handles this.
- **Full request bodies for `/api/embed/*`** beyond metadata — avoid dragging PII into app logs.
- **Session tokens, refresh tokens, webhook secrets** — Sentry + log drains run a pre-send scrubber matching regex for `sk_live_`, `eyJ`, `whsec_`, `rk_`, `sbp_`, and known env var values.

### 10.3 Sentry

- `beforeSend` hook redacts: `user.email` (keep domain only), `user.phone` (drop), `authorization` headers, `cookie` headers, any `stripe-signature` value.
- `tracesSampleRate: 0.05` in prod; 1.0 in preview.
- PII: set `sendDefaultPii: false`. Add `user.id` manually (Supabase UUID only, never email).

### 10.4 Alerting

- Sentry alert on: webhook signature failures >1/min, `service_role` usage from unexpected route, 5xx rate >1% for 5 min, auth failure spike.
- Supabase alert on: RLS policy change, role grant change, extension install.
- Stripe alert on: dispute opened, radar flag, unusual refund volume.

---

## 11. Compliance

### 11.1 GDPR (lawful basis: contract for shops, legitimate interest for end customers on shop's behalf)

- **We are a Data Processor** for end customers (the shop is the Controller). We are a **Controller** for the shop's own account data.
- **DPA**: a Data Processing Agreement is attached to our Terms of Service. Shops accept it at signup.
- **Sub-processors**: Supabase, Cloudflare (R2 + CDN), Vercel, Stripe, Fly.io, Sentry, Resend (email). Listed publicly at `/legal/subprocessors` with 30-day change notice.
- **Data location**: Supabase EU region (Frankfurt), R2 EU jurisdiction. Vercel edge is global but application data is in the Supabase EU region.
- **SAR flow** (customer wants their data): shop forwards the request to us via a dashboard button; we export `quotes` + `orders` + associated mesh signed URLs as a JSON+zip bundle within 30 days. Documented runbook.
- **Right to erasure**: customer-initiated via the shop. Soft-delete in `quotes` + object tombstone in R2 (lifecycle rule purges after 30 days). Hard-delete of backups after 90 days.
- **Retention policy**: mesh files 12 months after order fulfilment or 30 days after quote abandonment (whichever applies); order rows 7 years (UK tax requirement); audit logs 2 years.
- **Cookie consent**: the marketing site uses only essential + anonymised analytics (Plausible). No banner needed under UK GDPR's "strictly necessary" + anonymised-analytics interpretation, but we review this pre-launch.
- **Breach notification**: 72-hour notification to ICO + affected shops via email. Playbook in §12.

### 11.2 PCI DSS

- **Scope: SAQ-A**. Stripe hosts the card form; we redirect to Stripe Checkout. We do not receive, store, transmit, or process cardholder data.
- To remain in SAQ-A: (a) no card-collecting iframes, JS, or fields on our domains beyond the Stripe-hosted ones; (b) no Stripe.js Elements embedded in our pages (this would move us to SAQ-A-EP). v1 is pure Checkout redirect.
- Annual self-assessment + quarterly ASV scan if we ever host a Stripe Elements iframe. For now: SAQ-A only, annual attestation.

---

## 12. Incident response

Playbooks are short because our providers do most of the heavy lifting. Each playbook has an owner, SLA, and verify step.

### 12.1 Mesh bucket exposure (R2 creds leak, or misconfigured public ACL)

1. **Contain**: rotate R2 access keys immediately (Cloudflare dashboard). Redeploy Vercel + Fly with new keys.
2. **Scope**: pull R2 access logs for the exposure window; identify which object keys were accessed by non-whitelisted IPs / User-Agents.
3. **Re-key signed URLs**: rotate the R2 presign-key so all existing signed URLs are invalidated.
4. **Notify** affected shops within 72 h; customers via the shop.
5. **Postmortem** within 7 days; update this doc.

### 12.2 RLS policy breach (confirmed cross-tenant read)

1. **Contain**: revoke the offending policy or disable the affected endpoint. Deploy hotfix.
2. **Snapshot**: dump current DB state for forensics before any remediation writes.
3. **Scope**: query logs to identify which rows crossed tenant boundaries.
4. **Notify** affected shops; document exactly what was exposed.
5. **Add a regression test** before closing the incident — a failing test that proves the RLS policy blocks the exact query that leaked.

### 12.3 Stripe webhook secret leak

1. **Rotate** webhook signing secret in Stripe dashboard; update Vercel env; redeploy.
2. **Reconcile**: walk Stripe's `events.list` API for the suspected window and compare to `webhook_events`. Any missing events → reprocess. Any event we processed that isn't in Stripe → investigate for forgery (shouldn't exist; signature was valid at the time but secret was compromised).
3. **Audit** for fake `checkout.session.completed` that marked unpaid orders as paid; cross-check against `expected_amount_pence` invariant.

### 12.4 Embed key mass-scraping

Embed keys are public by design (they're in the `<script>` tag shop-owners paste onto their site). The risk isn't the key leaking — it's abuse.

1. **Detect**: rate-limit spike on a specific embed_key from unfamiliar IPs or referers.
2. **Contain**: auto-shadow-ban (§9) + email the shop owner.
3. **Rotate**: shop can rotate `embed_key` from dashboard. Old key is revoked immediately; shop updates their `<script>` src.
4. **Referer lock** (v1.1): paid shops can allowlist referer origins on which their widget is valid. Low-priority for v1 because the referer header is trivially spoofable, but it raises the bar.

---

## 13. Pre-launch security checklist

Run before alpha. Every item must be green or have a written exception.

**Infrastructure & secrets**
- [ ] All production secrets in Vercel/Fly; none in repo. `gitleaks` clean on `main`.
- [ ] `service_role` key grep clean on build artefacts.
- [ ] `.env.example` lists all required vars, no real values.
- [ ] Supabase, Stripe, R2, Fly, Vercel each have alerts configured to founder's phone.

**Database & RLS**
- [ ] Every tenant-scoped table has RLS enabled; CI check confirms.
- [ ] Every `SECURITY DEFINER` function listed in `db-schema.md` with justification.
- [ ] RLS regression tests: as user A, confirm user B's rows are invisible on every endpoint.
- [ ] `anon` role has no direct table grants, only `SECURITY DEFINER` RPC grants.

**Auth**
- [ ] Password policy + pwned-passwords + email confirmation on.
- [ ] Session TTL + refresh rotation configured.
- [ ] Rate limits on `/auth/*`.
- [ ] MFA available; required for super-admin.

**Embed & widget**
- [ ] CSP deployed on `/embed` with `frame-ancestors *` + strict `script-src`.
- [ ] CSP deployed on `/dashboard` with `frame-ancestors 'none'`.
- [ ] `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` set.
- [ ] postMessage handler validates schema and ignores host-originated messages.
- [ ] Widget fetches use `credentials: 'omit'`.

**File upload**
- [ ] Signed URL enforces `Content-Length` + `Content-Type`.
- [ ] Magic-byte validation for STL/OBJ/3MF implemented and unit-tested.
- [ ] Zip-bomb test: a 10 KB 3MF expanding to 10 GB is rejected.
- [ ] 10 M-triangle STL is rejected pre-analysis.
- [ ] `trimesh` runs in subprocess with RLIMIT_AS + 30 s timeout.
- [ ] Meshes served only via `meshes.quick3dquote.com`, signed URLs ≤24 h.

**Stripe**
- [ ] Webhook uses raw body + `constructEvent`.
- [ ] `webhook_events` idempotency test passes (duplicate delivery → no double-fulfilment).
- [ ] Checkout `amount_total` is validated against `quotes.expected_amount_pence` on `checkout.session.completed`.
- [ ] No client-submitted price field exists anywhere.

**Rate limiting & abuse**
- [ ] All `/api/embed/*` endpoints have Upstash-backed rate limits with tests.
- [ ] Shadow-ban path tested.
- [ ] Abuse alert routes to founder.

**Logging & PII**
- [ ] Sentry `beforeSend` scrubber tested with synthetic PII.
- [ ] Audit events append-only; UPDATE/DELETE grants revoked.
- [ ] Access logs retained; log drain has no raw PII.

**Dependencies**
- [ ] `npm audit` / `pnpm audit` — zero Critical/High.
- [ ] `pip-audit` on quote-engine — zero Critical/High.
- [ ] Dependabot / Renovate enabled on the repo.
- [ ] SBOM (CycloneDX) generated on every release.

**Compliance**
- [ ] DPA published; Terms + Privacy Policy reviewed by counsel.
- [ ] Sub-processor list public.
- [ ] Data deletion runbook tested end-to-end.
- [ ] PCI SAQ-A attestation filed.

**Incident readiness**
- [ ] On-call rota (even if it's just the founder): phone, email, PagerDuty.
- [ ] Runbooks in §12 walked through in a tabletop exercise.
- [ ] Key-rotation drill: rotate `service_role` in a staging env without downtime.

---

*End of document. Review cadence: quarterly, plus after any material architecture change. Security is a living surface — treat this doc as code.*

Document path: `C:/Users/Olly/Git/3d Printing Software/docs/security.md` — word count ~3450.
