# RLS Tenant-Isolation Tests

These tests verify that Row Level Security policies in
`supabase/migrations/20260421120100_rls_policies.sql` correctly isolate
data between shops, keep unauthenticated callers blind to shop data,
and grant the `service_role` its intended bypass.

They are plain SQL (no pgTAP dependency) so they run on any local
`supabase start` instance without extra install steps. Each test section
either `RAISE NOTICE`s an `[ OK ]` line or `RAISE EXCEPTION`s on failure;
a non-zero `psql` exit code means something regressed.

## What we cover

| # | Test |
|---|---|
| 1 | Shop A user cannot read Shop B's quotes |
| 2 | Anon with no embed_key cannot read materials or processes |
| 3 | Anon with valid embed_key reads materials for that shop only |
| 4 | Anon with Shop B's embed_key sees only Shop B materials |
| 5 | Anon can INSERT a quote (via RPC) and SELECT it via session JWT; cannot see anyone else's; cannot flip status to 'paid' |
| 6 | service_role bypasses RLS on every tenant table |
| 7 | Anon fully denied on webhook_events, profiles, shop_members |

## Running locally

From the repo root:

```bash
# 1. Start Supabase (first run pulls images).
supabase start

# 2. Apply migrations + run the seed.
supabase db reset

# 3. Run the tests. SUPABASE_DB_URL is printed by `supabase start`.
#    Typical local value:
#       postgresql://postgres:postgres@127.0.0.1:54322/postgres
psql "$SUPABASE_DB_URL" -f supabase/tests/rls/test_tenant_isolation.sql
```

You'll see a stream of `[ OK ]` lines for each assertion. On the first
failure, psql stops and prints `[FAIL]` with the assertion label — the
exit code will be non-zero so CI picks it up.

### Shortcut (Powershell / Windows)

```powershell
supabase start
supabase db reset
$env:PGPASSWORD = 'postgres'
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres `
     -f supabase/tests/rls/test_tenant_isolation.sql
```

## How the tests set role + claims

RLS policies read three things to identify the caller:

1. The Postgres role — `anon`, `authenticated`, or `service_role` — set
   via `SET LOCAL ROLE`.
2. `auth.uid()` — PostgREST populates this from `request.jwt.claim.sub`;
   the tests set that GUC directly.
3. Per-request GUCs: `request.embed_key`, `request.jwt.claim.quote_id`,
   `request.jwt.claim.session_token`. The Next.js API sets these in
   real traffic by signing a JWT with those claims; tests set them
   directly.

All GUCs are `SET LOCAL` so they vanish at `ROLLBACK` — one test can't
leak state into another.

## When to run

- Before merging any PR that touches `20260421120100_rls_policies.sql`.
- As a CI step on every push — recommended pipeline:
  `supabase start && supabase db reset && psql ... -f ...`.
- Manually after a Supabase version bump (RLS internals occasionally
  shift).

## Adding a new test

Follow the existing pattern:

```sql
\echo
\echo '=== Test N: <what this verifies> ==='

begin;
    set local role <role>;
    set local "request.jwt.claim.sub" to '...';
    set local "request.embed_key"     to '...';

    select pg_temp.assert_eq(
        '<label shown in log>',
        (select count(*) from ... where ...)::bigint,
        <expected>::bigint
    );
rollback;
```

Wrapping each test in `BEGIN ... ROLLBACK` keeps fixture state
untouched between scenarios. The `pg_temp.assert_eq` helper is created
at the top of the file and lives only for the duration of the session.

## Related

- `supabase/migrations/20260421120100_rls_policies.sql` — policies being tested
- `supabase/migrations/20260421120200_functions_triggers.sql` — SECURITY DEFINER helpers
- `docs/security.md` §5 — multi-tenant isolation design
- `docs/db-schema.md` §4 — RLS reference
