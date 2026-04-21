-- =============================================================================
-- 20260421120100_rls_policies.sql
-- -----------------------------------------------------------------------------
-- Row Level Security for every tenant-scoped table.
--
-- The cardinal rules (see db-schema.md §4, security.md §5):
--   * default-deny: RLS enabled on every public table, no blanket grants to
--     anon; every access pattern is an explicit policy or SECURITY DEFINER
--     RPC;
--   * service_role bypasses RLS entirely by Supabase convention — webhooks
--     and the retention job rely on that, so nothing below blocks it;
--   * the anon role never writes shop_id directly; all anon writes go
--     through SECURITY DEFINER functions defined in the follow-up migration.
--
-- This file runs BEFORE functions_triggers in timestamp order. To avoid a
-- circular dependency, we declare stub versions of the two helpers RLS
-- policies reference — current_shop_id() and is_valid_embed_key(text) — in
-- this file. The functions_triggers migration then redefines them with
-- `create or replace`, so the final deployed function body is the one in
-- functions_triggers.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Stub helpers. These are superseded by the definitive versions in the
-- functions_triggers migration (run next). Kept here so that `create policy`
-- below resolves.
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


-- -----------------------------------------------------------------------------
-- Revoke blanket table grants from anon. Anon's only privileges should be
-- via named SECURITY DEFINER functions. authenticated retains normal
-- table grants because RLS gates reads/writes appropriately.
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage  on schema public to anon, authenticated;


-- =============================================================================
-- profiles
-- A user can read and update only their own row.
-- =============================================================================
alter table public.profiles enable row level security;

create policy profiles_self_read on public.profiles
    for select
    to authenticated
    using (id = auth.uid());

create policy profiles_self_update on public.profiles
    for update
    to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

-- Inserts are handled by the handle_new_user() trigger (SECURITY DEFINER),
-- so no INSERT policy is needed or wanted.


-- =============================================================================
-- shops
--   * shop members can SELECT their own shop;
--   * only shop owners can UPDATE;
--   * no INSERT or DELETE policy — shop creation is a privileged server
--     operation (signup API route) that uses service_role.
-- =============================================================================
alter table public.shops enable row level security;

create policy shops_member_select on public.shops
    for select
    to authenticated
    using (
        exists (
            select 1 from public.shop_members sm
            where sm.shop_id = shops.id
              and sm.profile_id = auth.uid()
        )
    );

create policy shops_owner_update on public.shops
    for update
    to authenticated
    using (
        exists (
            select 1 from public.shop_members sm
            where sm.shop_id = shops.id
              and sm.profile_id = auth.uid()
              and sm.role = 'owner'
        )
    )
    with check (
        exists (
            select 1 from public.shop_members sm
            where sm.shop_id = shops.id
              and sm.profile_id = auth.uid()
              and sm.role = 'owner'
        )
    );


-- =============================================================================
-- shop_members
-- Members of a shop can read their peers (v1: only ever themselves).
-- All writes go through server-side service_role paths (invitation accept,
-- role change) — no policies defined for INSERT/UPDATE/DELETE.
-- =============================================================================
alter table public.shop_members enable row level security;

create policy shop_members_member_select on public.shop_members
    for select
    to authenticated
    using (shop_id = public.current_shop_id());


-- =============================================================================
-- processes
--   * authenticated shop members: full CRUD within their own shop;
--   * anon with a valid embed_key: read-only. This is the pattern called
--     out in the brief: policies USE is_valid_embed_key() against a
--     request-scoped GUC carrying the key the API layer received from the
--     widget (X-Embed-Key / JWT claim).
--
-- Why a GUC and not a policy parameter: RLS policies can't take arguments,
-- so the key has to reach Postgres via something the policy can SELECT
-- inside its USING clause. We use `current_setting('request.embed_key',
-- true)` — the Next.js API sets this via Supabase's signing flow (JWT
-- claim embed_key) or via `select set_config('request.embed_key', $1,
-- true)` on a per-request transaction. Both end up in the same GUC.
-- =============================================================================
alter table public.processes enable row level security;

-- Shop members CRUD.
create policy processes_shop_rw on public.processes
    for all
    to authenticated
    using (shop_id = public.current_shop_id())
    with check (shop_id = public.current_shop_id());

-- Anon read via embed_key. is_valid_embed_key() returns NULL when the
-- claim is missing/invalid/shop inactive, which fails the equality check
-- and the row is denied.
create policy processes_anon_embed_read on public.processes
    for select
    to anon
    using (
        active
        and shop_id = public.is_valid_embed_key(
            coalesce(
                current_setting('request.embed_key', true),
                current_setting('request.jwt.claim.embed_key', true)
            )
        )
    );


-- =============================================================================
-- materials — same shape as processes.
-- =============================================================================
alter table public.materials enable row level security;

create policy materials_shop_rw on public.materials
    for all
    to authenticated
    using (shop_id = public.current_shop_id())
    with check (shop_id = public.current_shop_id());

create policy materials_anon_embed_read on public.materials
    for select
    to anon
    using (
        active
        and shop_id = public.is_valid_embed_key(
            coalesce(
                current_setting('request.embed_key', true),
                current_setting('request.jwt.claim.embed_key', true)
            )
        )
    );


-- =============================================================================
-- quotes — the trickiest surface.
--
-- Three callers:
--   1. authenticated shop owner: full read + update; no insert (only the
--      widget or the SECURITY DEFINER RPC may insert new rows);
--   2. anon widget customer: INSERT via a JWT claim (session_token) that
--      matches a shops.embed_key; SELECT/UPDATE limited to rows whose
--      session_token matches the per-quote JWT claim;
--   3. service_role: bypasses RLS; webhook handler uses it to mark paid.
--
-- Pattern for anon access:
--   * On quote creation the Next.js embed API calls create_quote_from_widget()
--     which returns (quote_id, session_token). The API then signs a short-
--     lived JWT embedding `quote_id` and `session_token` as custom claims
--     and returns it as an HttpOnly cookie. PostgREST / Supabase Auth makes
--     those claims available to RLS via current_setting('request.jwt.claim.<k>').
--   * On subsequent widget calls (GET/PATCH quote, checkout create) the
--     same JWT is presented, the claims are readable from the policy, and
--     the row is matched.
-- =============================================================================
alter table public.quotes enable row level security;

-- --- authenticated shop owner ---
create policy quotes_shop_select on public.quotes
    for select
    to authenticated
    using (shop_id = public.current_shop_id());

create policy quotes_shop_update on public.quotes
    for update
    to authenticated
    using (shop_id = public.current_shop_id())
    with check (shop_id = public.current_shop_id());

-- No INSERT policy for authenticated: shops don't create quotes by hand.

-- --- anon widget INSERT ---
-- This allows anon to create a quotes row only when:
--   (a) the row's shop_id matches a shop identified by the JWT's
--       session_token claim (which the API maps to a shops.id at signing
--       time via a lookup against shops.embed_key);
--   (b) the status is the initial 'draft'.
-- In practice the embed API prefers the create_quote_from_widget RPC which
-- does the same thing with tighter guardrails. This policy exists to allow
-- future direct inserts (e.g. a client library) without reopening the
-- schema.
create policy quotes_anon_insert on public.quotes
    for insert
    to anon
    with check (
        status = 'draft'
        and shop_id = public.is_valid_embed_key(
            coalesce(
                current_setting('request.embed_key', true),
                current_setting('request.jwt.claim.embed_key', true)
            )
        )
    );

-- --- anon widget SELECT ---
-- Only the exact quote row whose id + session_token both match the JWT
-- claims. Neither alone is enough: id is public-ish (could be guessed
-- from a shared link) and session_token is 32 random bytes (unguessable),
-- so in practice the token carries the authentication while the id pins
-- the target.
create policy quotes_anon_read_own on public.quotes
    for select
    to anon
    using (
        id::text = current_setting('request.jwt.claim.quote_id', true)
        and session_token = current_setting('request.jwt.claim.session_token', true)
        and status not in ('cancelled','expired')
        and expires_at > now()
    );

-- --- anon widget UPDATE ---
-- The widget needs to set material_id, process_id, quantity, customer_email,
-- etc. as the customer fills out the form. We lock this down so anon can
-- never flip status to 'paid' or set paid_at — only service_role (Stripe
-- webhook) does that.
create policy quotes_anon_update_own on public.quotes
    for update
    to anon
    using (
        id::text = current_setting('request.jwt.claim.quote_id', true)
        and session_token = current_setting('request.jwt.claim.session_token', true)
        and status in ('draft','priced')
        and expires_at > now()
    )
    with check (
        id::text = current_setting('request.jwt.claim.quote_id', true)
        and session_token = current_setting('request.jwt.claim.session_token', true)
        -- Anon can only land the row in these non-terminal states.
        and status in ('draft','priced','checkout_started')
        -- paid_at + stripe_payment_intent_id may only be set by service_role.
        and paid_at is null
        and stripe_payment_intent_id is null
    );


-- =============================================================================
-- orders
-- Owned by whichever shop owns the parent quote. service_role may insert
-- rows when processing the Stripe checkout.session.completed event.
-- =============================================================================
alter table public.orders enable row level security;

create policy orders_shop_select on public.orders
    for select
    to authenticated
    using (
        exists (
            select 1 from public.quotes q
            where q.id = orders.quote_id
              and q.shop_id = public.current_shop_id()
        )
    );

create policy orders_shop_update on public.orders
    for update
    to authenticated
    using (
        exists (
            select 1 from public.quotes q
            where q.id = orders.quote_id
              and q.shop_id = public.current_shop_id()
        )
    )
    with check (
        exists (
            select 1 from public.quotes q
            where q.id = orders.quote_id
              and q.shop_id = public.current_shop_id()
        )
    );

-- No INSERT / DELETE policies: service_role handles those.


-- =============================================================================
-- quote_events
-- Shop owners can read events for their own quotes. No policies for
-- INSERT/UPDATE/DELETE — only SECURITY DEFINER functions and service_role
-- write here. The immutability trigger blocks UPDATE/DELETE at a lower
-- layer anyway.
-- =============================================================================
alter table public.quote_events enable row level security;

create policy quote_events_shop_select on public.quote_events
    for select
    to authenticated
    using (
        exists (
            select 1 from public.quotes q
            where q.id = quote_events.quote_id
              and q.shop_id = public.current_shop_id()
        )
    );


-- =============================================================================
-- webhook_events
-- RLS-on with NO policies = default-deny for everyone. Only service_role
-- ever touches this table, and service_role bypasses RLS.
-- =============================================================================
alter table public.webhook_events enable row level security;


-- -----------------------------------------------------------------------------
-- Grant table privileges to authenticated. RLS policies above decide which
-- rows are visible; these grants decide which operations are *possible*.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.profiles        to authenticated;
grant select, update                 on public.shops           to authenticated;
grant select                         on public.shop_members    to authenticated;
grant select, insert, update, delete on public.processes       to authenticated;
grant select, insert, update, delete on public.materials       to authenticated;
grant select, update                 on public.quotes          to authenticated;
grant select, update                 on public.orders          to authenticated;
grant select                         on public.quote_events    to authenticated;

-- Anon: SELECT only on materials/processes (gated by the policies above),
-- INSERT+SELECT+UPDATE on quotes (also gated). No other privileges.
grant select                         on public.processes       to anon;
grant select                         on public.materials       to anon;
grant select, insert, update         on public.quotes          to anon;


-- -----------------------------------------------------------------------------
-- End of RLS policies.
-- -----------------------------------------------------------------------------
