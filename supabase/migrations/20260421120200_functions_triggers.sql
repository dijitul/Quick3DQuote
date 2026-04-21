-- =============================================================================
-- 20260421120200_functions_triggers.sql
-- -----------------------------------------------------------------------------
-- Helper functions, triggers, and SECURITY DEFINER RPCs.
--
-- This migration is intentionally *before* rls_policies in timestamp order
-- so that policies can reference these helpers during their own creation.
-- Wait — the filename order here places this AFTER rls_policies. That's
-- deliberate: the RLS file only references helpers we create in THIS file
-- (is_valid_embed_key, current_shop_id) if we front-load them. We solve
-- that by redefining the helpers RLS depends on inline in rls_policies.sql
-- and treating this file as the authoritative, final definition that the
-- application layer calls directly. `create or replace` makes that safe.
--
-- Trust boundary note: every SECURITY DEFINER function below:
--   * pins `search_path = public` (prevents schema-hijack attacks),
--   * revokes execute from PUBLIC, then grants only to the role that needs it,
--   * never concatenates user text into dynamic SQL,
--   * is listed in docs/security.md §5.2 with its justification.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- set_updated_at()
-- Generic BEFORE UPDATE trigger that stamps updated_at. Attached to every
-- table that has an updated_at column.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end
$$;

comment on function public.set_updated_at() is
    'Generic trigger that stamps updated_at on every row update.';

-- Attach to every table with an updated_at column.
do $$
declare
    r record;
begin
    for r in
        select table_schema, table_name
        from information_schema.columns
        where table_schema = 'public'
          and column_name = 'updated_at'
          and table_name in (
              'profiles','shops','processes','materials',
              'quotes','orders'
          )
    loop
        execute format(
            'drop trigger if exists trg_%I_set_updated_at on %I.%I;',
            r.table_name, r.table_schema, r.table_name
        );
        execute format(
            'create trigger trg_%I_set_updated_at
                 before update on %I.%I
                 for each row execute function public.set_updated_at();',
            r.table_name, r.table_schema, r.table_name
        );
    end loop;
end
$$;


-- -----------------------------------------------------------------------------
-- handle_new_user()
-- Trigger on auth.users that creates the matching public.profiles row.
-- SECURITY DEFINER because the triggering session is the signup flow, which
-- does not yet have public-schema INSERT privileges.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, full_name, avatar_url)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
        new.raw_user_meta_data ->> 'avatar_url'
    )
    on conflict (id) do nothing;
    return new;
end
$$;

comment on function public.handle_new_user() is
    'Auto-provision a public.profiles row for every new auth.users row.';

-- auth.users trigger lives in the auth schema; only the postgres role can
-- attach to it. supabase db reset runs as postgres so this is fine locally
-- and in `supabase db push` against production.
drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();


-- -----------------------------------------------------------------------------
-- generate_embed_key()
-- Returns a URL-safe random string suitable for shops.embed_key. Uses 24
-- random bytes which encode to 32 base64url characters — comfortably inside
-- the 24–64 check constraint and with ~192 bits of entropy.
-- -----------------------------------------------------------------------------
create or replace function public.generate_embed_key()
returns text
language plpgsql
as $$
declare
    v_bytes bytea := gen_random_bytes(24);
    v_b64   text  := encode(v_bytes, 'base64');
begin
    -- base64 -> base64url: replace +/ with -_ and strip trailing = padding.
    return replace(replace(rtrim(v_b64, '='), '+', '-'), '/', '_');
end
$$;

comment on function public.generate_embed_key() is
    'URL-safe 32-char embed_key generator. ~192 bits entropy.';


-- -----------------------------------------------------------------------------
-- current_shop_id()
-- Resolves the caller's shop_id via shop_members. Cached per-statement by
-- the planner because the function is STABLE.
--
-- SECURITY DEFINER is fine here — no input, only leaks the caller's own
-- membership, and we need it to run regardless of the caller's direct
-- grants on shop_members.
-- -----------------------------------------------------------------------------
create or replace function public.current_shop_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select sm.shop_id
    from public.shop_members sm
    where sm.profile_id = auth.uid()
    limit 1
$$;

revoke all on function public.current_shop_id() from public;
grant execute on function public.current_shop_id() to authenticated;

comment on function public.current_shop_id() is
    'Returns shop_id for the authenticated caller; used by RLS policies.';


-- -----------------------------------------------------------------------------
-- is_valid_embed_key(text)
-- SECURITY DEFINER helper used by anon-role RLS policies on materials and
-- processes. Returns the shop_id if the key is valid (active or trialing
-- shop, not soft-deleted) else NULL. Takes the key as its only input.
-- -----------------------------------------------------------------------------
create or replace function public.is_valid_embed_key(p_key text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select s.id
    from public.shops s
    where s.embed_key = p_key
      and s.deleted_at is null
      and s.subscription_status in ('active','trialing','past_due')
    limit 1
$$;

revoke all on function public.is_valid_embed_key(text) from public;
grant execute on function public.is_valid_embed_key(text) to anon, authenticated;

comment on function public.is_valid_embed_key(text) is
    'Resolves embed_key -> shop_id if the shop is active. Used by anon RLS.';


-- -----------------------------------------------------------------------------
-- quote_status_transition_allowed(from_status, to_status)
-- CHECK helper used by application code (and optionally by a trigger) to
-- validate quote status transitions. Kept as a pure SQL function so it's
-- inlinable in CHECKs and plpgsql triggers alike.
-- -----------------------------------------------------------------------------
create or replace function public.quote_status_transition_allowed(
    p_from text,
    p_to   text
) returns boolean
language sql
immutable
as $$
    select case
        when p_from = p_to                                                 then true
        when p_from = 'draft'            and p_to in ('priced','cancelled','expired') then true
        when p_from = 'priced'           and p_to in ('checkout_started','cancelled','expired','draft') then true
        when p_from = 'checkout_started' and p_to in ('paid','failed','cancelled','expired') then true
        when p_from = 'failed'           and p_to in ('checkout_started','cancelled','expired') then true
        when p_from = 'paid'             and p_to in ('cancelled')         then true  -- refunded path
        else false
    end
$$;

comment on function public.quote_status_transition_allowed(text, text) is
    'State-machine guard for quotes.status. Kept optional: apply via trigger '
    'or application-level check as required.';


-- -----------------------------------------------------------------------------
-- assert_material_process_same_shop()
-- Trigger: ensures a material and its process belong to the same shop.
-- Postgres has no cross-column FK, so we enforce this imperatively.
-- -----------------------------------------------------------------------------
create or replace function public.assert_material_process_same_shop()
returns trigger
language plpgsql
as $$
begin
    if not exists (
        select 1 from public.processes p
        where p.id = new.process_id
          and p.shop_id = new.shop_id
    ) then
        raise exception
            'material.process_id % does not belong to material.shop_id %',
            new.process_id, new.shop_id
            using errcode = '23514';  -- check_violation
    end if;
    return new;
end
$$;

drop trigger if exists trg_materials_same_shop on public.materials;
create trigger trg_materials_same_shop
    before insert or update on public.materials
    for each row execute function public.assert_material_process_same_shop();


-- -----------------------------------------------------------------------------
-- quote_events immutability
-- Append-only audit log. Raising an exception on UPDATE and DELETE makes
-- it structurally impossible to rewrite history.
-- -----------------------------------------------------------------------------
create or replace function public.quote_events_immutable()
returns trigger
language plpgsql
as $$
begin
    raise exception 'quote_events rows are immutable'
        using errcode = '42501';  -- insufficient_privilege
end
$$;

drop trigger if exists trg_quote_events_no_update_delete on public.quote_events;
create trigger trg_quote_events_no_update_delete
    before update or delete on public.quote_events
    for each row execute function public.quote_events_immutable();


-- -----------------------------------------------------------------------------
-- seed_default_processes_for_shop()
-- Trigger: when a new shop is inserted, auto-create one FDM and one SLA
-- process row with sensible defaults. This lets the widget boot
-- immediately after shop signup without the shop having to configure
-- anything — they'll then tune values from the dashboard.
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_processes_for_shop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.processes (
        shop_id, type, name,
        hourly_rate, setup_fee, min_order,
        markup_pct, turnaround_days, throughput_cm3_per_hour
    )
    values
        -- FDM default: matches CLAUDE.md §5 throughput of 12 cm3/hr.
        (new.id, 'fdm', 'FDM Default',
         15.00, 5.00, 10.00,
         15.00, 5, 12.00),
        -- SLA default: matches CLAUDE.md §5 throughput of 18 cm3/hr.
        (new.id, 'sla', 'SLA Default',
         22.00, 8.00, 15.00,
         20.00, 7, 18.00);
    return new;
end
$$;

drop trigger if exists trg_shops_seed_processes on public.shops;
create trigger trg_shops_seed_processes
    after insert on public.shops
    for each row execute function public.seed_default_processes_for_shop();


-- -----------------------------------------------------------------------------
-- create_quote_from_widget(p_embed_key, p_filename, p_user_agent, p_ip_hash)
-- The anon-role entry point for quote creation. Bypasses RLS because
-- SECURITY DEFINER, but is tightly constrained:
--   * only writes to quotes + quote_events;
--   * shop_id is derived server-side from the embed_key — never accepted
--     from the caller;
--   * returns a fresh session_token the widget must present on subsequent
--     calls (via the request.quote_session GUC — see RLS policies).
-- -----------------------------------------------------------------------------
create or replace function public.create_quote_from_widget(
    p_embed_key  text,
    p_filename   text,
    p_user_agent text,
    p_ip_hash    text
)
returns table (quote_id uuid, session_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_shop_id uuid;
    v_token   text;
    v_id      uuid;
begin
    v_shop_id := public.is_valid_embed_key(p_embed_key);
    if v_shop_id is null then
        raise exception 'invalid embed key' using errcode = '42501';
    end if;

    -- 32 bytes -> 43 base64url chars (matches quotes_session_token_length_ck).
    v_token := replace(
                   replace(
                       rtrim(encode(gen_random_bytes(32), 'base64'), '='),
                       '+', '-'),
                   '/', '_');

    insert into public.quotes (
        shop_id, session_token, mesh_filename,
        user_agent, ip_hash, status
    )
    values (
        v_shop_id, v_token, p_filename,
        left(p_user_agent, 500), p_ip_hash, 'draft'
    )
    returning id into v_id;

    insert into public.quote_events (quote_id, event_type, actor, payload)
    values (v_id, 'created', 'customer',
            jsonb_build_object('ip_hash', p_ip_hash));

    return query select v_id, v_token;
end
$$;

revoke all on function public.create_quote_from_widget(text,text,text,text) from public;
grant execute on function public.create_quote_from_widget(text,text,text,text) to anon, authenticated;

comment on function public.create_quote_from_widget(text,text,text,text) is
    'Anon entry point: validates embed_key, inserts a new quote, returns '
    'its id plus a session_token used by later RLS-gated widget calls.';


-- -----------------------------------------------------------------------------
-- list_materials_for_embed(p_embed_key)
-- Read-only whitelisted projection of materials + process type for the
-- widget. Bypasses the materials RLS gate but is itself gated by
-- is_valid_embed_key.
-- -----------------------------------------------------------------------------
create or replace function public.list_materials_for_embed(p_embed_key text)
returns table (
    id                 uuid,
    process_id         uuid,
    process_type       text,
    process_name       text,
    name               text,
    price_per_cm3      numeric,
    density_g_per_cm3  numeric,
    colour_hex         text,
    sort_order         int
)
language sql
stable
security definer
set search_path = public
as $$
    select m.id, m.process_id, pr.type, pr.name,
           m.name, m.price_per_cm3, m.density_g_per_cm3,
           m.colour_hex, m.sort_order
    from public.materials m
    join public.processes pr on pr.id = m.process_id
    join public.shops     s  on s.id  = m.shop_id
    where s.embed_key = p_embed_key
      and s.deleted_at is null
      and s.subscription_status in ('active','trialing','past_due')
      and m.active
      and pr.active
    order by m.sort_order, m.name
$$;

revoke all on function public.list_materials_for_embed(text) from public;
grant execute on function public.list_materials_for_embed(text) to anon, authenticated;

comment on function public.list_materials_for_embed(text) is
    'Widget materials list, gated by embed_key validity. Read-only.';


-- -----------------------------------------------------------------------------
-- shop_public_by_embed_key(p_embed_key)
-- Public projection of a shop's brand fields for the widget boot call.
-- -----------------------------------------------------------------------------
create or replace function public.shop_public_by_embed_key(p_embed_key text)
returns table (
    id             uuid,
    brand_name     text,
    brand_logo_url text,
    brand_accent   text,
    country        char(2),
    currency       char(3)
)
language sql
stable
security definer
set search_path = public
as $$
    select s.id, s.brand_name, s.brand_logo_url, s.brand_accent,
           s.country, 'GBP'::char(3)
    from public.shops s
    where s.embed_key = p_embed_key
      and s.deleted_at is null
      and s.subscription_status in ('active','trialing','past_due')
$$;

revoke all on function public.shop_public_by_embed_key(text) from public;
grant execute on function public.shop_public_by_embed_key(text) to anon, authenticated;

comment on function public.shop_public_by_embed_key(text) is
    'Widget boot: returns branding fields for a shop identified by embed_key.';


-- -----------------------------------------------------------------------------
-- End of functions + triggers.
-- -----------------------------------------------------------------------------
