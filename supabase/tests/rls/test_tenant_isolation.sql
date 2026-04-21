-- =============================================================================
-- test_tenant_isolation.sql
-- -----------------------------------------------------------------------------
-- RLS regression tests for Quick3DQuote.
--
-- Runs as a plain psql script (no pgTAP dependency) so it works on any
-- `supabase start` instance without extra install steps. Every test
-- RAISEs on failure so a non-zero psql exit code means something regressed.
-- A final summary line prints at the end on success.
--
-- Strategy:
--   * Create a second shop "Shop B" alongside the seeded "Demo Print Co".
--   * Run a sequence of SET ROLE / SET LOCAL request.* scenarios, each
--     wrapped in a subtransaction so one failure doesn't poison the rest.
--   * ASSERT visible row counts match expectations.
--
-- Usage (from supabase/ root):
--     psql "$SUPABASE_DB_URL" -f tests/rls/test_tenant_isolation.sql
--
-- Expects seed.sql to have run (supabase db reset). If not, re-run:
--     supabase db reset
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Assertion helper. Fails loudly if the actual value doesn't match expected.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.assert_eq(
    p_label    text,
    p_actual   bigint,
    p_expected bigint
) returns void
language plpgsql
as $$
begin
    if p_actual is distinct from p_expected then
        raise exception '[FAIL] %: expected %, got %',
            p_label, p_expected, p_actual;
    else
        raise notice '[ OK ] %: %', p_label, p_actual;
    end if;
end
$$;


-- ---------------------------------------------------------------------------
-- Fixture: create "Shop B" + owner user + one material.
-- Running as postgres (service_role equivalent) so RLS doesn't stop us.
-- ---------------------------------------------------------------------------
begin;

-- Second user.
insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
) values (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated',
    'shopb@quick3dquote.test',
    crypt('shopb-password-123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Shop B Owner'),
    now(), now(), '', '', '', ''
) on conflict (id) do nothing;

-- Second shop.
insert into public.shops (
    id, brand_name, embed_key, brand_accent, country,
    plan, subscription_status
) values (
    '22222222-2222-2222-2222-222222222222',
    'Shop B Ltd',
    'shopb_embed_key_abcdefghij',           -- 26 chars, within check constraint
    '#00AA88',
    'GB',
    'starter',
    'active'
) on conflict (id) do nothing;

-- Membership.
insert into public.shop_members (shop_id, profile_id, role)
values (
    '22222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000002',
    'owner'
) on conflict (shop_id, profile_id) do nothing;

-- Shop B material (the trigger has already seeded its FDM + SLA processes).
insert into public.materials (
    shop_id, process_id, name, price_per_cm3, density_g_per_cm3,
    colour_hex, sort_order
)
select '22222222-2222-2222-2222-222222222222',
       p.id,
       'Shop B Secret PLA',
       0.1500, 1.240, '#112233', 10
from public.processes p
where p.shop_id = '22222222-2222-2222-2222-222222222222'
  and p.type    = 'fdm'
on conflict do nothing;

-- Seed a quote for Shop A so the cross-tenant tests have something real to
-- not see. service_role bypasses RLS here.
insert into public.quotes (
    id, shop_id, session_token, status, mesh_filename
) values (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',  -- 43 chars
    'draft',
    'shop-a-quote.stl'
) on conflict (id) do nothing;

insert into public.quotes (
    id, shop_id, session_token, status, mesh_filename
) values (
    '44444444-4444-4444-4444-444444444444',
    '22222222-2222-2222-2222-222222222222',
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'draft',
    'shop-b-quote.stl'
) on conflict (id) do nothing;

commit;


-- =============================================================================
-- TEST 1 — Shop A user cannot read Shop B's quotes.
-- =============================================================================
\echo
\echo '=== Test 1: Shop A cannot read Shop B quotes ==='

begin;
    -- Impersonate Shop A's user. `request.jwt.claim.sub` is what auth.uid()
    -- reads from.
    set local role authenticated;
    set local "request.jwt.claim.sub"  to '00000000-0000-0000-0000-000000000001';
    set local "request.jwt.claims"     to '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

    -- Shop A should see their own quote.
    select pg_temp.assert_eq(
        'shop A sees own quotes',
        (select count(*) from public.quotes where shop_id = '11111111-1111-1111-1111-111111111111')::bigint,
        1::bigint
    );

    -- Shop A should NOT see Shop B's quote.
    select pg_temp.assert_eq(
        'shop A sees zero Shop B quotes',
        (select count(*) from public.quotes where shop_id = '22222222-2222-2222-2222-222222222222')::bigint,
        0::bigint
    );

    -- Cross-tenant lookup by id also returns nothing.
    select pg_temp.assert_eq(
        'shop A lookup of Shop B quote id returns 0',
        (select count(*) from public.quotes where id = '44444444-4444-4444-4444-444444444444')::bigint,
        0::bigint
    );
rollback;


-- =============================================================================
-- TEST 2 — Anon WITHOUT embed_key cannot read materials.
-- =============================================================================
\echo
\echo '=== Test 2: Anon without embed_key sees no materials ==='

begin;
    set local role anon;
    -- Explicitly clear the GUC in case a previous test set it.
    set local "request.embed_key"               to '';
    set local "request.jwt.claim.embed_key"     to '';

    select pg_temp.assert_eq(
        'anon no-key sees zero materials',
        (select count(*) from public.materials)::bigint,
        0::bigint
    );

    select pg_temp.assert_eq(
        'anon no-key sees zero processes',
        (select count(*) from public.processes)::bigint,
        0::bigint
    );
rollback;


-- =============================================================================
-- TEST 3 — Anon WITH valid embed_key sees materials for that shop ONLY.
-- =============================================================================
\echo
\echo '=== Test 3: Anon with Shop A embed_key sees only Shop A materials ==='

begin;
    set local role anon;
    set local "request.embed_key" to 'demo_embed_key_1234567890';

    -- Shop A has 4 seeded materials (PLA, PETG, Standard Resin, Tough Resin).
    select pg_temp.assert_eq(
        'anon Shop-A-key sees Shop A materials',
        (select count(*) from public.materials where shop_id = '11111111-1111-1111-1111-111111111111')::bigint,
        4::bigint
    );

    -- Shop B materials must NOT be visible.
    select pg_temp.assert_eq(
        'anon Shop-A-key sees zero Shop B materials',
        (select count(*) from public.materials where shop_id = '22222222-2222-2222-2222-222222222222')::bigint,
        0::bigint
    );

    -- Unconditional count should equal Shop A's count.
    select pg_temp.assert_eq(
        'anon Shop-A-key total materials = 4',
        (select count(*) from public.materials)::bigint,
        4::bigint
    );
rollback;


-- =============================================================================
-- TEST 4 — Anon cannot read other shops' materials by presenting Shop B's key.
-- =============================================================================
\echo
\echo '=== Test 4: Shop B key sees only Shop B materials ==='

begin;
    set local role anon;
    set local "request.embed_key" to 'shopb_embed_key_abcdefghij';

    select pg_temp.assert_eq(
        'anon Shop-B-key sees Shop B materials only',
        (select count(*) from public.materials)::bigint,
        1::bigint
    );

    select pg_temp.assert_eq(
        'anon Shop-B-key sees zero Shop A materials',
        (select count(*) from public.materials where shop_id = '11111111-1111-1111-1111-111111111111')::bigint,
        0::bigint
    );
rollback;


-- =============================================================================
-- TEST 5 — Anon can INSERT a quote via the create_quote_from_widget RPC
--           and SELECT it, but cannot SELECT someone else's.
-- =============================================================================
\echo
\echo '=== Test 5: Anon insert+select own quote via session-token JWT ==='

begin;
    set local role anon;

    -- Use the SECURITY DEFINER RPC which validates the embed_key.
    select quote_id, session_token
      from public.create_quote_from_widget(
          'demo_embed_key_1234567890',
          'widget-upload.stl',
          'Mozilla/5.0 (test)',
          'hash-of-test-ip'
      )
      \gset

    -- Set the JWT claims the policy reads.
    set local "request.jwt.claim.quote_id"      to :'quote_id';
    set local "request.jwt.claim.session_token" to :'session_token';

    -- Own quote is visible.
    select pg_temp.assert_eq(
        'anon sees own newly inserted quote',
        (select count(*) from public.quotes where id = :'quote_id'::uuid)::bigint,
        1::bigint
    );

    -- Shop A's other quote (33...) is NOT visible even though it belongs
    -- to the same shop — anon is scoped by session_token, not shop_id.
    select pg_temp.assert_eq(
        'anon cannot see a different quote in the same shop',
        (select count(*) from public.quotes where id = '33333333-3333-3333-3333-333333333333')::bigint,
        0::bigint
    );

    -- Shop B's quote must definitely not be visible.
    select pg_temp.assert_eq(
        'anon cannot see Shop B quote',
        (select count(*) from public.quotes where id = '44444444-4444-4444-4444-444444444444')::bigint,
        0::bigint
    );

    -- Attempting to flip status to 'paid' via UPDATE must be rejected by
    -- the WITH CHECK in the anon_update_own policy (paid_at is null AND
    -- stripe_payment_intent_id is null AND status in draft/priced/checkout_started).
    -- We verify here by counting the rows that *would* update. With RLS the
    -- UPDATE is rewritten to include the policy predicate, so 0 rows match
    -- once status='paid' is the target.
    select pg_temp.assert_eq(
        'anon update with invalid transition is scoped out',
        (
            with attempted as (
                update public.quotes
                   set status = 'paid'
                 where id = :'quote_id'::uuid
                 returning 1
            )
            select count(*) from attempted
        )::bigint,
        0::bigint
    );
rollback;


-- =============================================================================
-- TEST 6 — service_role can do anything.
-- =============================================================================
\echo
\echo '=== Test 6: service_role bypasses RLS ==='

begin;
    set local role service_role;
    -- No GUCs set; service_role should see everything unconditionally.

    -- Both shops' quotes visible.
    select pg_temp.assert_eq(
        'service_role sees all seeded quotes',
        (select count(*) from public.quotes)::bigint,
        2::bigint
    );

    -- Both shops' materials visible.
    select pg_temp.assert_eq(
        'service_role sees all materials',
        (select count(*) from public.materials)::bigint,
        5::bigint   -- 4 from Shop A + 1 from Shop B
    );

    -- webhook_events is readable by service_role only (RLS has no
    -- policies, but service_role bypasses RLS). Insert one and count.
    insert into public.webhook_events (event_id, type, payload)
    values ('evt_rls_test_' || gen_random_uuid()::text, 'test.ping', '{}'::jsonb);

    select pg_temp.assert_eq(
        'service_role sees at least one webhook event',
        (select case when count(*) >= 1 then 1 else 0 end
         from public.webhook_events)::bigint,
        1::bigint
    );
rollback;


-- =============================================================================
-- TEST 7 — anon cannot read webhook_events, profiles, shop_members.
-- =============================================================================
\echo
\echo '=== Test 7: Anon fully denied on privileged tables ==='

begin;
    set local role anon;

    select pg_temp.assert_eq(
        'anon sees zero webhook_events',
        (select count(*) from public.webhook_events)::bigint,
        0::bigint
    );

    select pg_temp.assert_eq(
        'anon sees zero shop_members',
        (select count(*) from public.shop_members)::bigint,
        0::bigint
    );

    select pg_temp.assert_eq(
        'anon sees zero profiles',
        (select count(*) from public.profiles)::bigint,
        0::bigint
    );
rollback;


-- =============================================================================
-- Cleanup: drop Shop B fixture so db-reset stays idempotent when tests are
-- rerun within one session. (db reset rebuilds from scratch anyway, but this
-- keeps the test file itself re-runnable against a single instance.)
-- =============================================================================
begin;
delete from public.quotes   where shop_id = '22222222-2222-2222-2222-222222222222';
delete from public.materials where shop_id = '22222222-2222-2222-2222-222222222222';
delete from public.processes where shop_id = '22222222-2222-2222-2222-222222222222';
delete from public.shop_members where shop_id = '22222222-2222-2222-2222-222222222222';
delete from public.shops    where id = '22222222-2222-2222-2222-222222222222';
delete from auth.users where id = '00000000-0000-0000-0000-000000000002';
delete from public.quotes where id = '33333333-3333-3333-3333-333333333333';
commit;

\echo
\echo '======================================================================='
\echo '  RLS TENANT ISOLATION TESTS PASSED'
\echo '======================================================================='
