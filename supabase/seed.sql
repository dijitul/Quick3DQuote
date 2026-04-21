-- =============================================================================
-- seed.sql
-- -----------------------------------------------------------------------------
-- Local-dev seed for Quick3DQuote. Runs automatically by `supabase db reset`.
--
-- SAFE TO RUN AGAINST PRODUCTION? NO.
-- It writes directly into auth.users and uses fixed UUIDs. It is guarded by
-- the Supabase CLI — `supabase db reset` only operates against the local
-- container. Never invoke this file via `supabase db push` or psql against
-- the production URL.
--
-- What this produces:
--   * one confirmed user:     demo@quick3dquote.test
--   * one shop:               "Demo Print Co" with a known embed_key
--   * TWO processes:          the init trigger auto-seeded defaults, but we
--                             overwrite them with the precise values from
--                             the brief (FDM throughput 12, hourly £15 etc).
--   * four materials:         PLA, PETG (FDM) + Standard Resin, Tough Resin
--                             (SLA) with colours from the brief.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Demo user.
--
-- Supabase's handle_new_user() trigger fires on auth.users insert and
-- creates the matching public.profiles row, so we don't insert into
-- profiles ourselves. We do set the user fields the trigger reads
-- (raw_user_meta_data.full_name) so the profile row isn't empty.
--
-- The auth.users columns below are the minimum set for a valid, confirmed
-- email user; email_confirmed_at = now() means we can log in without
-- clicking a magic link. aud + role match what Supabase creates for real
-- users. encrypted_password is a bcrypt hash of "demo-password-123".
-- ---------------------------------------------------------------------------
insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'demo@quick3dquote.test',
    crypt('demo-password-123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Demo Owner'),
    now(), now(), '', '', '', ''
)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- Shop. The seed_default_processes_for_shop trigger will fire here and
-- create two default processes with auto-generated ids — we then overwrite
-- the values below with the exact figures from the brief.
-- ---------------------------------------------------------------------------
insert into public.shops (
    id, brand_name, embed_key, brand_accent, country,
    plan, subscription_status
)
values (
    '11111111-1111-1111-1111-111111111111',
    'Demo Print Co',
    'demo_embed_key_1234567890',          -- exactly the string the brief asks for
    '#6366F1',                            -- indigo accent per CLAUDE.md §11
    'GB',
    'starter',
    'active'
)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- Membership.
-- ---------------------------------------------------------------------------
insert into public.shop_members (shop_id, profile_id, role)
values (
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000001',
    'owner'
)
on conflict (shop_id, profile_id) do nothing;


-- ---------------------------------------------------------------------------
-- Processes.
--
-- The trigger on shops has already inserted defaults. We update those rows
-- in place (rather than insert new ones with hard-coded ids) so the
-- trigger output is the canonical row — this means tests can query by
-- (shop_id, type) and get exactly one row per type.
--
-- Values come from the task brief:
--   FDM: throughput 12, hourly £15, setup £5, min order £10, markup 0.15 (=15%), turnaround 5 days
--   SLA: throughput 18, hourly £22, setup £8, min order £15, markup 0.20 (=20%), turnaround 7 days
-- ---------------------------------------------------------------------------
update public.processes
   set hourly_rate             = 15.00,
       setup_fee               = 5.00,
       min_order               = 10.00,
       markup_pct              = 15.00,
       turnaround_days         = 5,
       throughput_cm3_per_hour = 12.00,
       name                    = 'FDM Default'
 where shop_id = '11111111-1111-1111-1111-111111111111'
   and type    = 'fdm';

update public.processes
   set hourly_rate             = 22.00,
       setup_fee               = 8.00,
       min_order               = 15.00,
       markup_pct              = 20.00,
       turnaround_days         = 7,
       throughput_cm3_per_hour = 18.00,
       name                    = 'SLA Default'
 where shop_id = '11111111-1111-1111-1111-111111111111'
   and type    = 'sla';


-- ---------------------------------------------------------------------------
-- Materials. The process_id is resolved via a subquery so we never have
-- to hard-code generated uuids.
--
-- Colours are the exact hexes from the brief:
--   PLA            #FF6B35
--   PETG           #1C4E80
--   Standard Resin #2C2C2C
--   Tough Resin    #8E44AD
-- ---------------------------------------------------------------------------
with fdm as (
    select id from public.processes
     where shop_id = '11111111-1111-1111-1111-111111111111'
       and type    = 'fdm'
),
sla as (
    select id from public.processes
     where shop_id = '11111111-1111-1111-1111-111111111111'
       and type    = 'sla'
)
insert into public.materials
    (shop_id, process_id,
     name, price_per_cm3, density_g_per_cm3, colour_hex, sort_order)
select
    '11111111-1111-1111-1111-111111111111',
    (select id from fdm),
    'PLA',      0.0800, 1.240, '#FF6B35', 10
union all
select
    '11111111-1111-1111-1111-111111111111',
    (select id from fdm),
    'PETG',     0.1200, 1.270, '#1C4E80', 20
union all
select
    '11111111-1111-1111-1111-111111111111',
    (select id from sla),
    'Standard Resin', 0.4500, 1.100, '#2C2C2C', 10
union all
select
    '11111111-1111-1111-1111-111111111111',
    (select id from sla),
    'Tough Resin',    0.6000, 1.150, '#8E44AD', 20
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- Summary (for the `supabase db reset` log).
-- ---------------------------------------------------------------------------
do $$
declare
    n_shops     int;
    n_materials int;
    n_procs     int;
begin
    select count(*) into n_shops     from public.shops;
    select count(*) into n_procs     from public.processes;
    select count(*) into n_materials from public.materials;
    raise notice 'Quick3DQuote seed complete: % shop(s), % process(es), % material(s).',
        n_shops, n_procs, n_materials;
    raise notice 'Demo login: demo@quick3dquote.test / demo-password-123';
    raise notice 'Demo embed_key: demo_embed_key_1234567890';
end
$$;
