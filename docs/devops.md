# Quick3DQuote — DevOps & Deployment Plan

> Owner: Olly (`dijitul`). Scope: everything between a `git push` and a paying shop seeing a working widget. This doc is the operational source of truth; if reality drifts, update this first.

A reminder of the shape we're operating: a Next.js 15 app on Vercel (marketing + dashboard + embed + API routes), a Python FastAPI quote-engine on Fly.io, Supabase for Postgres/Auth, Cloudflare R2 for mesh storage, Stripe for money, GitHub (`dijitul/Quick3DQuote`) for source. UK-centric, so infra sits in London where possible. Target: under £50/mo infra at ten paying shops so we're profitable on customer one.

---

## 1. Environment matrix

We run **three** environments, not four. Staging is deliberately skipped for MVP — justified below.

| Env | Web (Vercel) | Engine (Fly) | Supabase | R2 bucket | Stripe | Purpose |
|---|---|---|---|---|---|---|
| **dev** (local) | `pnpm dev` on `localhost:3000` | `uvicorn` on `localhost:8000` or mocked via MSW | **local** via `supabase start` (Docker) OR shared `quick3dquote-dev` project | `meshes-dev` with `local/` prefix per dev | Stripe **test mode** + `stripe listen` for webhooks | Every-day engineering |
| **preview** (per-PR) | Auto preview on Vercel, URL like `quick3dquote-git-<branch>.vercel.app` | **Shared staging engine** at `quote-engine-staging.fly.dev` | Shared `quick3dquote-dev` project (Supabase Branching OFF for MVP) | `meshes-dev` with `preview/<pr>/` prefix | Stripe **test mode** (same keys as dev) | PR review, design QA, integration checks |
| **production** | `quick3dquote.com` on Vercel Pro | `quote-engine.fly.dev` + custom CNAME `engine.quick3dquote.com` | `quick3dquote-prod` Supabase project | `meshes-prod` | Stripe **live mode** | Real shops, real money |

### What's real vs mocked

- **Dev**: Stripe is test-mode; R2 is real (dev bucket, cheap). Supabase can be fully local via `supabase start` which spins up Postgres + GoTrue + Kong in Docker — preferred for offline work. When testing RLS changes without Docker, point at the shared dev project.
- **Preview**: Real Supabase (shared dev project), real R2 (dev bucket, PR-scoped prefix), real quote-engine (shared staging Fly app), Stripe test-mode. No production data touches preview.
- **Production**: everything real, everything scoped to its own project/bucket/app.

### Why we skip a dedicated staging env

For a one-engineer MVP with low traffic, a persistent staging environment duplicates cost (another Supabase project at £25/mo once we outgrow free, another Fly app, another R2 bucket) for marginal benefit. **Preview deployments on PR already give us a fresh, production-shaped environment per change** — the only thing they share is the dev Supabase project and dev R2 bucket, which is acceptable for a two-tier product where the blast radius of a bad merge is "a test shop sees weird data". We'll add real staging when we have more than one engineer or our first enterprise customer with a contractual uptime ask.

---

## 2. Env var catalogue

Every variable lives in exactly one of `Vercel`, `Fly`, or `local .env`. No env var is ever committed. Rotation owner for MVP is Olly; we'll formalise that in the runbook once we're >1 engineer.

| Name | Home | Who owns rotation | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Vercel (all envs), local | Olly | Canonical web origin, e.g. `https://quick3dquote.com`. Used in OAuth redirects and embed script src. |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel (all envs), local | Supabase project-scoped; rotated only if project is re-created | Supabase REST endpoint. Public — shipped to browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel (all envs), local | Supabase | Anon key for client-side calls. Public. RLS is what actually protects data. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server envs), Fly, local `.env` (never committed) | Olly; rotate on compromise or quarterly | Full-access server key. Used by Next.js API routes and the quote-engine for admin operations. **Never** exposed to browser. |
| `SUPABASE_URL` | Fly, local `.env` | Supabase | Same as `NEXT_PUBLIC_SUPABASE_URL` but named without the `NEXT_PUBLIC_` prefix for the Python side. |
| `STRIPE_SECRET_KEY` | Vercel (server), local | Olly; rotate immediately on suspected leak | Server-side Stripe calls (create Checkout session, subs, refunds). `sk_test_...` or `sk_live_...`. |
| `STRIPE_PUBLISHABLE_KEY` | Vercel (all envs) as `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe, per account | Browser-side Stripe.js init. Public. |
| `STRIPE_WEBHOOK_SECRET` | Vercel (server) | Olly; Stripe generates per endpoint — rotate on endpoint recreation | Verifies webhook signatures. Different value for test vs live endpoints. |
| `R2_ACCOUNT_ID` | Vercel (server), Fly, local | Cloudflare account-scoped; never rotates | Cloudflare account ID. Not secret but scoped. |
| `R2_ACCESS_KEY_ID` | Vercel (server), Fly, local | Olly; rotate quarterly | R2 S3-compatible API access key. |
| `R2_SECRET_ACCESS_KEY` | Vercel (server), Fly, local | Olly; rotate quarterly | Paired secret for above. |
| `R2_BUCKET_MESHES` | Vercel (all envs), Fly, local | Fixed per env (`meshes-prod` / `meshes-dev`) | Bucket name. |
| `R2_PUBLIC_ENDPOINT` | Vercel, Fly, local | Fixed | `https://<accountid>.r2.cloudflarestorage.com` |
| `QUOTE_ENGINE_URL` | Vercel (server) | Fixed per env | URL of the FastAPI service. Prod: `https://engine.quick3dquote.com`. Preview/dev: `https://quote-engine-staging.fly.dev`. |
| `QUOTE_ENGINE_INTERNAL_KEY` | Vercel (server), Fly | Olly; rotate quarterly or on leak | Shared secret header the web sends and the engine verifies. Poor-man's mTLS for MVP. |
| `SENTRY_DSN` | Vercel (all envs — different DSN per env), Fly, local (optional) | Sentry per-project; rotate only on compromise | Error reporting. Separate DSN for TS project and Python project. |
| `SENTRY_ENVIRONMENT` | Vercel, Fly | Olly | Tags events with `production` / `preview` / `development`. |
| `LOG_LEVEL` | Fly, local | — | `info` in prod, `debug` in dev. |
| `PORT` | Fly (Fly injects), local | — | The engine binds to this. Default 8000. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Vercel (server) | Upstash | Rate-limit store for embed endpoints. Optional for MVP; we can start with in-memory. |

### `.env.example` (drop in at repo root)

```bash
# ─────────────────────────────────────────────────────
# Quick3DQuote — local dev environment
# Copy to `.env` and fill in. Never commit `.env`.
# ─────────────────────────────────────────────────────

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Supabase (from `supabase start` output, or your dev project)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...local-anon-jwt...
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...local-service-role-jwt...

# Stripe (test mode — dashboard → Developers → API keys)
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # from `stripe listen` output

# Cloudflare R2 (create an API token scoped to meshes-dev)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_MESHES=meshes-dev
R2_PUBLIC_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com

# Quote engine (local python or mocked)
QUOTE_ENGINE_URL=http://localhost:8000
QUOTE_ENGINE_INTERNAL_KEY=dev-shared-secret-change-me

# Observability (optional in dev)
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
LOG_LEVEL=debug
```

---

## 3. Vercel config

One Vercel project: `quick3dquote` (Pro plan — needed for per-env env vars, team roles, and log retention).

- **Framework preset**: Next.js (auto-detected).
- **Root directory**: `apps/web` (pnpm monorepo). Set in Vercel project settings → General.
- **Install command**: `pnpm install --frozen-lockfile` (Vercel auto-detects pnpm from `packageManager` in root `package.json`).
- **Build command**: `pnpm turbo run build --filter=web...` (Turborepo builds web and any workspace deps).
- **Output directory**: `.next` (default).
- **Node version**: 20.x (LTS through 2026).
- **Region**: **London — `lhr1`** (Function region). UK shops + Supabase EU region = co-located latency. Set via `vercel.json` or project settings.
- **Preview deployments**: ON for all branches; only PRs against `main` auto-comment the URL.
- **Production branch**: `main`.
- **Environment variable scoping**: Vercel supports Development / Preview / Production scopes — use them religiously. Prod secrets only on Production scope.
- **Vercel Analytics**: ON (Web Analytics — included in Pro). Gives us page-view + Core Web Vitals without a separate tool. Speed Insights ON too (negligible cost).

### `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["lhr1"],
  "github": { "silent": true },
  "headers": [
    {
      "source": "/embed.js",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400" },
        { "key": "Access-Control-Allow-Origin", "value": "*" }
      ]
    },
    {
      "source": "/embed",
      "headers": [
        { "key": "Content-Security-Policy", "value": "frame-ancestors *" },
        { "key": "X-Frame-Options", "value": "ALLOWALL" }
      ]
    }
  ]
}
```

### Custom domain strategy — one domain, no `embed.` subdomain

Proposal: `quick3dquote.com` is the single origin for marketing, dashboard, embed host, and API routes. **We do not create `embed.quick3dquote.com`.**

Reasoning — the embed snippet on a customer site injects an iframe pointing at `https://quick3dquote.com/embed?key=SHOP_KEY`. Inside that iframe, the widget fetches `/api/embed/quote` on the same origin — no CORS preflight, no cookie partitioning headaches, one TLS cert, one Vercel project, one CSP. A separate subdomain would give us cleaner cookie isolation between dashboard sessions and embed sessions, but the embed is **unauthenticated** from the customer POV (it uses the shop's public `embed_key`), so there's no session cookie to isolate. Only win of a subdomain would be the ability to set a strict CSP on the embed without loosening the dashboard's — we can achieve that with per-route headers in `vercel.json` as above. **Keep it single-origin until we have a concrete reason to split.**

DNS (all on Cloudflare — see §12): apex `quick3dquote.com` and `www` both CNAME-flatten to Vercel's `cname.vercel-dns.com`.

---

## 4. Fly.io config — quote-engine

Python 3.11 + FastAPI + trimesh + numpy + pillow. Single region (LHR). Always-on (min 1) so we don't eat a cold-start on the first quote of the day. MVP sizing: **512 MB** RAM on shared-cpu-1x (~$4.70/mo). Justification below.

### `services/quote-engine/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System deps for trimesh / numpy / pillow (mesh IO, image libs).
# libgl1 + libglib2.0-0 are needed by some trimesh backends even headless.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      libgl1 \
      libglib2.0-0 \
      curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

ENV PORT=8000
EXPOSE 8000

# Single worker is fine on 512MB; each request is short-lived CPU-bound work
# and trimesh already releases the GIL around numpy.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

`requirements.txt`:

```
fastapi==0.115.*
uvicorn[standard]==0.32.*
trimesh==4.5.*
numpy==2.1.*
pillow==11.*
pydantic==2.9.*
httpx==0.27.*
sentry-sdk[fastapi]==2.*
```

### `services/quote-engine/fly.toml`

```toml
app = "quote-engine"
primary_region = "lhr"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8000"
  LOG_LEVEL = "info"
  SENTRY_ENVIRONMENT = "production"

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = "off"     # keep warm; cold-start on a 200MB mesh upload is painful
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

  [http_service.concurrency]
    type = "requests"
    hard_limit = 20
    soft_limit = 15

[[http_service.checks]]
  interval = "15s"
  timeout = "5s"
  grace_period = "10s"
  method = "GET"
  path = "/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1

[metrics]
  port = 9091
  path = "/metrics"
```

**Why 512 MB not 1 GB?** A trimesh load of a 100 MB STL (our stated cap) peaks around 250–350 MB RAM depending on facet density — 512 MB gives us ~50% headroom with one worker. If we hit OOM in anger we bump to 1 GB (the next Fly tier up) for a few extra pounds a month. Cheaper to start small and alert on OOM than over-provision.

**Autoscale**: min 1, max 3. A single shared-cpu machine comfortably handles tens of quotes per minute (each ~2 s CPU). Fly scales on concurrency thresholds; we don't need scale-to-zero because warm-start on trimesh is ~3 s and users will drop off.

**Networking — public with shared secret for MVP.** The engine is exposed on `quote-engine.fly.dev` and protected by an `X-Internal-Key` header check that verifies `QUOTE_ENGINE_INTERNAL_KEY`. This is fine for MVP: the secret lives in Vercel env vars, and we rate-limit anyway. Post-MVP, move to **Flycast** (Fly's private IPv6 + WireGuard) so only our Vercel egress or a peered network can reach the engine. That's a one-day migration — not worth blocking launch on.

### Staging Fly app

A second Fly app `quote-engine-staging` with identical config but `min_machines_running = 0` and `auto_stop_machines = "stop"` — it's free when idle and warms up in a few seconds when a preview PR pings it. Deployed from the same Dockerfile on any merge to `main` (before prod) OR on a manual `flyctl deploy -a quote-engine-staging`.

---

## 5. Supabase setup

**One project per env**, no shortcuts:

- `quick3dquote-prod` (EU-West-2 London region)
- `quick3dquote-dev` (EU-West-2; shared by all preview deployments and the shared-dev path)

### Repo layout

```
supabase/
  config.toml
  migrations/
    20260401000000_init.sql
    20260402120000_add_materials_table.sql
    ...
  seed.sql
```

### Linking and day-to-day flow

```bash
# first-time only (per dev machine, per project)
supabase login
supabase link --project-ref <prod-ref>   # or <dev-ref>

# local dev stack (Docker)
supabase start

# author a migration
supabase migration new add_quote_status_enum
# edit the generated SQL file under supabase/migrations/

# apply locally
supabase db reset       # wipes local, reruns all migrations + seed
```

### Seed script (`supabase/seed.sql`)

Contains: one test shop, two test materials (PLA / Grey Resin), a demo process config, a dev-only super-admin user. Only runs in local and on `supabase db reset`.

### Branch previews — **skipped for MVP**

Supabase Branching clones schema + data for every git branch. It's lovely but costs per branch, and it's still GA-flagged as of writing. For an MVP with no destructive schema changes expected weekly, the shared dev project is enough. Revisit the moment we've got two engineers or the moment a preview PR ever *needs* isolated data.

---

## 6. Cloudflare R2 setup

### Buckets

| Bucket | Env | Visibility |
|---|---|---|
| `meshes-prod` | production | **Private**. No public URL, signed URLs only. |
| `meshes-dev` | dev + preview | **Private**. Same pattern. |

### Key layout (inside each bucket)

```
{shop_id}/{quote_id}/{uuid}-{original_filename}
```

Preview PRs add a prefix: `preview/pr-123/{shop_id}/...`. Local dev: `local/{dev_user}/...`.

### CORS config (applied via `wrangler r2 bucket cors put meshes-dev --file cors.json`)

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://*.vercel.app",
      "https://quick3dquote.com"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`PUT` is needed because the widget PUTs the file directly at the presigned URL, bypassing our API — zero egress bandwidth on Vercel, zero ingress cost on R2.

### Lifecycle rules

Two rules on each bucket:

1. **Auto-delete unpaid-quote meshes after 30 days.** Prefix: none; rely on a Postgres nightly cron that moves expired mesh keys into a `meshes-to-delete` table and a worker actually issues `DeleteObject`. Rationale: R2 lifecycle rules are prefix-based only; we want business-logic-driven deletion (don't delete files for *paid* orders). So lifecycle rule is a belt: **delete any object older than 90 days in `unpaid/` prefix** as a safety net.
2. **Abort incomplete multipart uploads after 1 day.** Standard hygiene.

### Versioning

R2 supports object versioning — enable on `meshes-prod` only. Keeps us safe against an "oops wrong key overwrite" bug in our own code. Costs trivial extra storage.

---

## 7. CI/CD

GitHub Actions owns CI and the engine deploy. Vercel handles web deploys via its GitHub App — no action needed from us beyond "connect the repo".

### Workflows

```
.github/workflows/
  ci.yml             # on PR and push to main
  deploy-engine.yml  # on push to main affecting services/quote-engine/**
```

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  web:
    name: Web (Next.js)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm turbo run lint --filter=web...

      - name: Typecheck
        run: pnpm turbo run typecheck --filter=web...

      - name: Unit tests
        run: pnpm turbo run test --filter=web...

      - name: Build
        env:
          # Build-time vars only — anything secret stays out of the build.
          NEXT_PUBLIC_APP_URL: https://quick3dquote.com
          NEXT_PUBLIC_SUPABASE_URL: https://ci-placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-placeholder
          NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk_test_ci_placeholder
        run: pnpm turbo run build --filter=web...

  engine:
    name: Engine (FastAPI)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: services/quote-engine
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip
          cache-dependency-path: services/quote-engine/requirements.txt

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install ruff mypy pytest pytest-cov

      - name: Lint (ruff)
        run: ruff check .

      - name: Typecheck (mypy)
        run: mypy app

      - name: Tests (pytest)
        run: pytest -q --cov=app --cov-report=term-missing

  db:
    name: DB (migrations + RLS policy tests)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    services:
      postgres:
        image: supabase/postgres:15.6.1.115
        env:
          POSTGRES_PASSWORD: postgres
        ports: ['5432:5432']
        options: >-
          --health-cmd="pg_isready -U postgres"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=10
    steps:
      - uses: actions/checkout@v4

      - name: Install Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Apply migrations
        env:
          PGPASSWORD: postgres
        run: |
          for f in supabase/migrations/*.sql; do
            echo ">> applying $f"
            psql -h localhost -U postgres -f "$f"
          done

      - name: RLS policy tests (pgTAP)
        env:
          PGPASSWORD: postgres
        run: psql -h localhost -U postgres -f supabase/tests/rls.sql
```

### `.github/workflows/deploy-engine.yml`

```yaml
name: Deploy engine

on:
  push:
    branches: [main]
    paths:
      - 'services/quote-engine/**'
      - '.github/workflows/deploy-engine.yml'

jobs:
  deploy:
    runs-on: ubuntu-latest
    concurrency: deploy-engine-prod
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only --config services/quote-engine/fly.toml
        working-directory: services/quote-engine
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### Vercel deploys

Connected via the Vercel GitHub App. Every PR gets a preview; `main` deploys to production. Required GitHub status checks on `main`: `Web`, `Engine`, `DB`, plus Vercel's own `Vercel — Preview`.

---

## 8. Migrations & DB deploys

**Recommendation: semi-manual, from a trusted local machine, with a dry-run step.** Not `supabase db push` in CI.

### Why not CI auto-apply?

The blast radius of a bad migration on Postgres (locked table, dropped column, mis-ordered enum change) is higher than the inconvenience of a manual `supabase db push`. With a one-engineer team the cognitive safety of "I watched that run" outweighs the theoretical win of automation. We do lint migrations in CI (the `db` job above), which catches syntax errors and RLS regressions.

### The safe flow

```text
1. Author migration locally
   supabase migration new <short_name>
   # write SQL, apply locally with supabase db reset

2. Open PR — CI runs migration against a fresh Postgres and runs RLS tests.

3. After PR merges, from local with prod link:
   supabase link --project-ref <prod-ref>
   supabase db diff             # shows planned changes
   supabase db push --dry-run   # prints what it WOULD do
   # pause, read it, compare against the migration file

4. Smoke-test on dev project first:
   supabase link --project-ref <dev-ref>
   supabase db push
   # run the web app pointed at dev, exercise affected routes

5. Apply to prod:
   supabase link --project-ref <prod-ref>
   supabase db push

6. Record in #deploys (Slack later; for now a line in CLAUDE.md changelog).
```

Destructive migrations (DROP COLUMN, rename) get an extra step: deploy code that no longer references the column, wait a release, *then* drop. Expand-contract pattern. Documented in a runbook.

---

## 9. Monitoring & alerting

Keep the stack thin and aligned with where stuff already runs.

- **Sentry** — two projects: `quick3dquote-web` (JS/TS, browser + Next server) and `quick3dquote-engine` (Python). Both use the free Developer tier initially (5k events/mo each) — enough for pre-launch. Upgrade to Team ($26/mo total) once traffic warrants. Release tags tied to git SHA so we can bisect regressions.
- **Vercel Analytics + Speed Insights** — included on Pro. Real user page-view + Core Web Vitals. No extra tool needed.
- **Fly.io logs** — `flyctl logs -a quote-engine` for live; metrics exported to Grafana Cloud free tier via Fly's built-in Prometheus endpoint. Dashboard: request rate, p50/p95 latency, memory usage, CPU steal.
- **Supabase** — built-in dashboard has query perf + connection count. Enable `pg_stat_statements`. Alerts on connection limit approaching are worth setting up once we cross ~20 concurrent users.
- **Uptime** — **Better Uptime** (now called Better Stack) free plan: three HTTP monitors, 3-min check interval.
  - `https://quick3dquote.com/api/health` (Next.js route, returns 200 + build SHA)
  - `https://engine.quick3dquote.com/health` (FastAPI route)
  - `https://quick3dquote.com/` (marketing page — catches full-stack outages)
- **Alert routing** — email to `olly@dijitul.com` for every paging alert; all non-paging logs stay in their platform. When we add a second engineer, route to a shared Slack webhook (Better Uptime + Sentry both have native Slack integrations; free to add).

### What's a page vs a notification

| Severity | Trigger | Channel |
|---|---|---|
| **Page** | Uptime monitor fails 2 consecutive checks OR Stripe webhook 5xx rate >10% over 5m | Email + (later) SMS via Better Uptime |
| **Notify** | Sentry: new issue seen in prod | Email |
| **Ignore (log only)** | Preview environment errors | Sentry env filter |

---

## 10. Cost model

Monthly, GBP, realistic — not "free tier forever" optimism.

| Line item | 0 shops (pre-launch) | 10 shops | 100 shops | Notes |
|---|---|---|---|---|
| Vercel Pro | £16 (~$20) | £16 | £16 | Flat. Bandwidth included is generous at our scale. |
| Fly.io — quote-engine prod | £4 (~$5) | £4 | ~£12 | 1× shared-cpu-1x 512MB at 100 shops bumps to 1GB or 2 machines. |
| Fly.io — quote-engine staging | £0 | £0 | £0 | Scales to zero. |
| Supabase | £0 (free) | £0 (free, tight) | £20 (~$25 Pro) | Free tier: 500MB DB, 50k MAU. At 100 shops with customer signups we hit storage/MAU limits. |
| Cloudflare R2 storage | £0 (well under free 10GB) | ~£0.50 | ~£5 | 100 shops × 50MB avg active meshes × retention ≈ 250GB @ £0.012/GB. Egress is **zero**. |
| Cloudflare DNS | £0 | £0 | £0 | Free. |
| Sentry | £0 (Dev) | £0 (Dev) | £20 (~$26 Team) | 5k events/mo free — enough up to ~10 shops. |
| Better Uptime | £0 | £0 | £0 | Free tier covers three monitors. |
| Stripe fees | n/a | n/a | n/a | **Passed through to shops** (their payout, their fees). We pay Stripe only on our own £50/mo sub billing — ~1.5% + 20p = ~£1/shop/mo. |
| Domain | £1 | £1 | £1 | £10–12/yr for `.com`. |
| **Total infra** | **~£21** | **~£22** | **~£74** | |
| **Revenue (£50/shop)** | £0 | £500 | £5,000 | |
| **Gross margin** | -£21 | ~£478 | ~£4,926 | |

**Target met**: under £50/mo at ten shops. First paying shop covers infra 20× over.

### Stripe: pass-through or absorb?

v1 architecture has payments going **direct to the shop's Stripe account** (no Stripe Connect platform fee), so customer payment fees are the shop's problem. We only pay Stripe fees on our own £50/mo subscription billing — a predictable ~£1/shop/mo. When we add Stripe Connect in v1.1 and take a platform cut we'll revisit; for now, clean and simple.

---

## 11. Backups & DR

Pragmatic targets for MVP: **RPO 24 hours, RTO 4 hours.** A shop losing a day of quotes is recoverable; losing a week is not.

| Asset | Backup mechanism | Retention | Restore test cadence |
|---|---|---|---|
| Supabase Postgres | Daily PITR on Pro plan (7-day window) | 7 days rolling | Manual restore drill every **quarter** — clone prod to a scratch project, verify schema + row counts. |
| R2 `meshes-prod` | Object versioning ON (30-day default retention) | 30 days | Spot-check monthly: list a random object's versions, download a prior version. |
| App source | GitHub (`dijitul/Quick3DQuote`) | Forever | Clone from scratch on a fresh machine, quarterly. |
| Env vars / secrets | 1Password vault (personal for now; team vault when we hire) | Forever | Just… don't lose the master password. |
| Stripe data | Stripe itself is the source of truth; no local copy | n/a | n/a |

### Restore drill — what "every quarter" means

Calendar reminder in Olly's calendar. Steps:

1. Create a scratch Supabase project.
2. Run `supabase db dump --project-ref <prod>` → `.sql` file.
3. Apply to scratch project.
4. Sanity SQL: `select count(*) from shops; select count(*) from quotes;` vs prod.
5. Spot restore of one random mesh from R2 version history.
6. Write date + result in a `docs/runbooks/restore-drill-log.md`.

If we can't do steps 1–6 in under 4 hours, we miss RTO — that's the point of the drill.

---

## 12. Domain & DNS

- Registrar: wherever the domain was bought; transfer to Cloudflare Registrar when it's up for renewal (at-cost pricing, no BS).
- DNS: **Cloudflare DNS** (free), proxy disabled for Vercel (Vercel handles TLS directly — orange-cloud breaks it). Proxy enabled only for any static pages we might self-host later.

### Records

| Name | Type | Value | Proxy |
|---|---|---|---|
| `quick3dquote.com` | A / AAAA | Vercel's anycast IPs (`76.76.21.21` etc.) | DNS only |
| `www` | CNAME | `cname.vercel-dns.com` | DNS only |
| `engine` | CNAME | `quote-engine.fly.dev` | DNS only (Fly handles TLS via ACME) |
| `_acme-challenge.engine` | CNAME / TXT | As Fly instructs during cert issuance | DNS only |

### `embed.quick3dquote.com` — **NO, for now**

Covered in §3. Summary of the trade-off for completeness here:

- **Same-origin (recommended)**: one domain, one cert, one CSP, no CORS dance. Cookies partition automatically because the embed is in a cross-origin iframe on the customer's site — but the embed widget doesn't need cookies anyway (it's keyed by the shop's public `embed_key`). Simplest possible.
- **Separate `embed.` subdomain**: cleaner blast-radius story if we ever ship something on the dashboard that shouldn't run on the embed surface. Cost: an extra DNS record and a second Vercel rewrite target. Real benefit only materialises if we diverge embed and dashboard tech (e.g. embed becomes a static bundle on Cloudflare Pages).

**Decision: single origin for v1, revisit when we have ≥1 reason.** Documented so future-us doesn't wonder.

---

## 13. Local dev setup

Goal: **one command** to get a working local stack.

### `package.json` (root) scripts

```json
{
  "scripts": {
    "dev": "turbo run dev --parallel",
    "dev:web": "pnpm --filter web dev",
    "dev:engine": "cd services/quote-engine && uvicorn app.main:app --reload --port 8000",
    "dev:db": "supabase start",
    "dev:db:stop": "supabase stop",
    "dev:stripe": "stripe listen --forward-to localhost:3000/api/webhooks/stripe"
  }
}
```

Turborepo `dev` task fans out to `web` and `engine` workspaces — both run in parallel with live reload.

### The happy path

```bash
# terminal 1 — Supabase (Docker)
pnpm dev:db

# terminal 2 — the app + engine together
pnpm dev

# terminal 3 — Stripe webhook forwarder
pnpm dev:stripe
# Paste the printed `whsec_...` into your `.env` as STRIPE_WEBHOOK_SECRET.
```

Local Supabase exposes itself at `127.0.0.1:54321`; Studio at `127.0.0.1:54323`.

### Frontend-only work (no Python stack)

Set `QUOTE_ENGINE_URL=http://localhost:3000/api/__mock__/engine` and enable MSW (Mock Service Worker) in the web app — it'll return canned volumes/pricing so a designer or frontend-only dev doesn't need Python installed. MSW setup lives in `apps/web/mocks/engine.ts`.

### Why not Docker Compose for everything?

Tempting. But Next.js dev-mode hot-reload in a container has historically been flaky on Windows host filesystems (Olly's on Windows per the working-directory path). Native `pnpm dev` + Supabase-in-Docker is the least-bad mix. If we add a second dev on Mac/Linux, revisit.

---

## 14. Runbook stubs — write these day one

These live at `docs/runbooks/*.md`. Each one is the same shape: **symptoms → diagnosis steps → remediation → follow-up**. MVP list:

1. **`engine-500s.md`** — quote-engine is returning 5xx. Check Fly logs, check memory (OOM?), check trimesh version, roll back with `flyctl releases` + `flyctl rollback`.
2. **`stripe-webhook-failures.md`** — "webhook signature verification failed" errors. Check `STRIPE_WEBHOOK_SECRET` matches the endpoint in Stripe Dashboard → Developers → Webhooks. Common cause: rotated endpoint, forgot to update Vercel env var. Replay missed events from Stripe dashboard.
3. **`r2-quota.md`** — mesh upload starts 403ing or we hit an R2 quota warning. Check Cloudflare dashboard storage graph, identify the heaviest shop, run the stale-mesh cleanup job manually, bump lifecycle aggressiveness if needed.
4. **`supabase-connection-limit.md`** — Next.js API routes start failing with "remaining connection slots are reserved". Check Supabase dashboard → Database → Pooler. Solutions: make sure all server routes use the **pooled** connection string (`...?pgbouncer=true`), not the direct one; audit any long-running queries in `pg_stat_activity`; upgrade to Pro if consistently pegged.
5. **`restore-from-backup.md`** — the "we lost data" runbook. PITR on Supabase Pro, object version restore on R2, step-by-step with actual commands. Referenced by the quarterly drill in §11.
6. **`rotate-secret.md`** — generic playbook for rotating any of the secrets in §2. Which tool to rotate in, which env vars to update, which services to redeploy.
7. **`deploy-rollback.md`** — web rollback via Vercel UI ("Promote a previous deployment"); engine rollback via `flyctl rollback -a quote-engine`. When and when not to use each.
8. **`on-call-basics.md`** — what to do when Better Uptime pages at 3am. Triage order: is it our fault or the platform's (Vercel/Fly/Supabase status pages), what's the user-visible impact, what's the rollback, who to tell.

---

### Appendix: what we explicitly haven't built

- No WAF beyond Cloudflare's default bot rules — acceptable at MVP scale.
- No IaC tool (Terraform/Pulumi) — managing four SaaS accounts via their UIs is faster than Terraform drift-management at this size. Revisit when we have >1 env that needs reproducing.
- No blue-green at the engine layer — Fly's rolling deploy with health checks on `/health` gets us zero-downtime. Canary comes when our request volume makes it safe to A/B on.
- No load tests committed — we'll write a `k6` script when we have our first enterprise-y shop asking about capacity.

This plan is deliberately the smallest thing that's **credible** for a paying-customer SaaS. Every shortcut above has a named reason; every shortcut has a "revisit when" condition. Update this document the day any of those conditions trip.

---

File: `C:/Users/Olly/Git/3d Printing Software/docs/devops.md` — word count: 4,844 (inclusive of code/config blocks).
