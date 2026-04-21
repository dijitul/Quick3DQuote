# Quick3DQuote — Supabase

This folder is the source of truth for our database: schema,
Row Level Security, helpers, and local-dev seed data. The Supabase CLI
reads `config.toml` to stand up Postgres + Studio + Auth in Docker,
then applies every file under `migrations/` in timestamp order, then
runs `seed.sql`.

```
supabase/
├── config.toml                              # CLI config (ports, auth, storage)
├── migrations/
│   ├── 20260421120000_init_schema.sql       # Tables, constraints, indexes
│   ├── 20260421120100_rls_policies.sql      # RLS, grants, stub helpers
│   ├── 20260421120200_functions_triggers.sql # SECURITY DEFINER helpers + triggers
│   └── 20260421120300_storage_buckets.sql   # `logos` bucket + policies
├── seed.sql                                 # One demo shop, 2 procs, 4 materials
├── tests/rls/
│   ├── test_tenant_isolation.sql            # psql-based RLS tests
│   └── README.md                            # How to run the tests
└── README.md                                # This file
```

## Prerequisites

- Docker Desktop (or any working Docker daemon).
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) v1.170 or later.
- `psql` — bundled with Postgres or installable via
  `winget install PostgreSQL.PostgreSQL` on Windows.

## First-run checklist

```bash
# From the repo root (not this folder).
supabase start      # Pull images + start Postgres, Auth, Studio, Storage, Realtime.
supabase db reset   # Apply migrations + run seed.sql.
```

Once it's up:

| Service | URL |
|---|---|
| Studio (GUI) | http://127.0.0.1:54323 |
| REST API | http://127.0.0.1:54321 |
| Postgres (direct) | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Inbucket (dev email) | http://127.0.0.1:54324 |

The seed creates a login you can use in the dashboard:

- Email: `demo@quick3dquote.test`
- Password: `demo-password-123`
- Shop embed_key: `demo_embed_key_1234567890`

## Day-to-day commands

### Apply migrations without wiping data

```bash
supabase migration up
```

### Re-apply everything from scratch (wipes all data)

```bash
supabase db reset    # runs migrations + seed.sql
```

### Generate TypeScript types from the schema

```bash
supabase gen types typescript --local > packages/supabase-types/src/database.ts
```

### Run the RLS tests

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -f supabase/tests/rls/test_tenant_isolation.sql
```

See `tests/rls/README.md` for a Windows Powershell variant.

### Push to cloud (production)

```bash
# Once, to link this folder to the hosted project:
supabase link --project-ref <project-ref>

# On every release:
supabase db push
```

`supabase db push` never drops or modifies data — it only applies the
migration files the cloud project hasn't seen yet.

## Migration naming

`YYYYMMDDHHMMSS_snake_case_description.sql`. The Supabase CLI enforces
this exactly. The timestamp is UTC so collaborators don't race each
other. Create a new one with:

```bash
supabase migration new add_quotes_refund_column
```

Timestamps MUST be monotonically increasing vs what's already in
`migrations/`. The CLI picks "now" for you, so this is automatic
unless you hand-write the filename.

## Rolling forward only

**We don't write down migrations.** If a migration has a bug:

1. Write a new migration that fixes it.
2. Reference the commit that introduced the bug in a comment block at
   the top of the new file.
3. Never edit an already-deployed migration file. Editing breaks the
   cloud's migration tracking and requires a manual `migrations` table
   fixup on the Supabase side — which is painful and error-prone.

The `db-schema.md` §6 spec calls this out explicitly; we follow it.

## RLS golden rules

(Excerpted from `docs/security.md` §5 — re-read that before touching
policies.)

1. **Every tenant-scoped table has RLS on.** A missing `ENABLE ROW
   LEVEL SECURITY` is the single most dangerous oversight in a
   Supabase project.
2. **Default deny.** If no policy matches, the row is invisible. Don't
   rely on implicit grants.
3. **Never drop + recreate a policy in two separate transactions in
   production.** Between the DROP and CREATE, the table has RLS on but
   no policy → everything is denied. Do both in one migration file.
4. **Anon has zero table grants.** All anon access flows through
   SECURITY DEFINER RPCs (`create_quote_from_widget`,
   `list_materials_for_embed`, `shop_public_by_embed_key`) or through
   tightly-scoped policies that check `is_valid_embed_key()`.
5. **service_role bypasses RLS by design.** Only the Stripe webhook
   handler and the retention cron job should hold the service_role
   key. Everything else uses the anon or user JWT.

## How the anon embed flow works (the single most surprising thing)

The widget is anonymous — no real Supabase user session. Two things
tell RLS who it is and what it can see:

- **A request-scoped GUC `request.embed_key`** (or the JWT claim
  `embed_key`, whichever the API sets). Policies on `materials` and
  `processes` call `is_valid_embed_key(...)` against it to resolve the
  shop the request is "for".
- **A signed JWT carrying `quote_id` + `session_token`** that the
  Next.js embed API issues on quote creation. Policies on `quotes`
  check those claims against the row's own `session_token` column.
  The widget presents the JWT on subsequent fetches (GET quote, PATCH
  quote, POST checkout).

See `docs/db-schema.md` §4.5 for the full reasoning.

## Related docs

- `docs/db-schema.md` — schema reference (spec for this folder)
- `docs/security.md` — threat model, RLS + service_role rules
- `docs/api-design.md` — HTTP surface that consumes this schema
- `CLAUDE.md` — project memory (read first)

## Troubleshooting

**`supabase start` hangs on "Pulling images".** Docker Hub rate limit.
Run `docker login` once and retry.

**`permission denied for table xyz` after a migration.** Check the
`grant ... to authenticated` / `to anon` clauses at the bottom of
`20260421120100_rls_policies.sql`. RLS visibility and SQL grants are
independent layers — you need both.

**An RLS test fails after a schema change.** First run `supabase db
reset` to re-seed; it's a good bet one of your new columns broke the
seed's assumptions.

**Seed.sql silently skipped on `supabase db reset`.** Check the CLI
output for an error — `ON CONFLICT DO NOTHING` at the top-level of a
failing statement can make the rest of the file look fine while the
key insert never happened.
