-- =============================================================================
-- 20260421120000_init_schema.sql
-- -----------------------------------------------------------------------------
-- Quick3DQuote — initial schema migration.
--
-- Creates all core tenant tables, constraints, and indexes exactly as defined
-- in docs/db-schema.md. No RLS policies, no triggers, no seed data — those
-- live in their own migrations so failures are easier to bisect.
--
-- Conventions (see db-schema.md §0):
--   * uuid primary keys via gen_random_uuid() (pgcrypto).
--   * timestamptz everywhere; always default now() for audit columns.
--   * snake_case identifiers; named constraints for deterministic diffs.
--   * text + CHECK over native enums (ALTER TYPE is fiddly in migrations).
--   * numeric(12,2) for money; never float.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions. pgcrypto gives us gen_random_uuid(); citext gives us a case-
-- insensitive email column type. Both ship with Supabase.
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;
create extension if not exists citext;


-- -----------------------------------------------------------------------------
-- profiles
-- One-to-one mirror of auth.users. The public-schema row is what the
-- application and RLS policies reference; auth.users is effectively
-- read-only from our side.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
    id          uuid        primary key
                            references auth.users(id) on delete cascade,
    full_name   text,
    avatar_url  text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table  public.profiles        is 'Per-user profile. PK = auth.users.id.';
comment on column public.profiles.id     is 'Mirrors auth.users.id; cascade on user delete.';


-- -----------------------------------------------------------------------------
-- shops
-- The tenant. Every tenant-scoped table has shop_id referencing this.
-- embed_key is public (appears in the customer <script>) and rotatable.
-- -----------------------------------------------------------------------------
create table if not exists public.shops (
    id                      uuid        primary key default gen_random_uuid(),
    brand_name              text        not null
                            constraint shops_brand_name_length_ck
                            check (length(brand_name) between 1 and 120),
    brand_logo_url          text,
    brand_accent            text        not null default '#6366F1'
                            constraint shops_brand_accent_hex_ck
                            check (brand_accent ~ '^#[0-9A-Fa-f]{6}$'),
    embed_key               text        not null
                            constraint shops_embed_key_uk unique
                            constraint shops_embed_key_length_ck
                            check (length(embed_key) between 24 and 64),
    timezone                text        not null default 'Europe/London',
    country                 char(2)     not null default 'GB',
    plan                    text        not null default 'starter'
                            constraint shops_plan_ck
                            check (plan in ('starter','pro','scale')),
    subscription_status     text        not null default 'incomplete'
                            constraint shops_subscription_status_ck
                            check (subscription_status in (
                                'incomplete','trialing','active','past_due',
                                'canceled','unpaid','paused'
                            )),
    stripe_customer_id      text        constraint shops_stripe_customer_uk unique,
    stripe_subscription_id  text        constraint shops_stripe_subscription_uk unique,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    deleted_at              timestamptz
);

comment on column public.shops.embed_key is
    'Public token embedded in the widget <script>. Read-only from anon role.';
comment on column public.shops.brand_accent is
    'Default #6366F1 (Indigo) per CLAUDE.md §11 decision lock.';


-- -----------------------------------------------------------------------------
-- shop_members
-- Links a profile to a shop with a role. v1 enforces a single shop per
-- profile via unique(profile_id); drop that constraint in v1.1 to support
-- multi-shop membership without a schema rewrite.
-- -----------------------------------------------------------------------------
create table if not exists public.shop_members (
    id          uuid        primary key default gen_random_uuid(),
    shop_id     uuid        not null
                            references public.shops(id) on delete cascade,
    profile_id  uuid        not null
                            references public.profiles(id) on delete cascade,
    role        text        not null default 'owner'
                            constraint shop_members_role_ck
                            check (role in ('owner','admin','member')),
    created_at  timestamptz not null default now(),
    constraint shop_members_shop_profile_uk unique (shop_id, profile_id),
    -- v1-only: one shop per profile. Drop this to enable multi-shop users.
    constraint shop_members_profile_uk unique (profile_id)
);

create index if not exists idx_shop_members_shop_id
    on public.shop_members(shop_id);


-- -----------------------------------------------------------------------------
-- processes
-- FDM / SLA / SLS / MJF configs per shop. A shop can have multiple of the
-- same type (e.g. two FDM printers with different throughput).
-- -----------------------------------------------------------------------------
create table if not exists public.processes (
    id                         uuid          primary key default gen_random_uuid(),
    shop_id                    uuid          not null
                               references public.shops(id) on delete cascade,
    type                       text          not null
                               constraint processes_type_ck
                               check (type in ('fdm','sla','sls','mjf')),
    name                       text          not null
                               constraint processes_name_length_ck
                               check (length(name) between 1 and 80),
    hourly_rate                numeric(10,2) not null
                               constraint processes_hourly_rate_ck
                               check (hourly_rate >= 0),
    setup_fee                  numeric(10,2) not null default 0
                               constraint processes_setup_fee_ck
                               check (setup_fee >= 0),
    min_order                  numeric(10,2) not null default 0
                               constraint processes_min_order_ck
                               check (min_order >= 0),
    markup_pct                 numeric(5,2)  not null default 0
                               constraint processes_markup_pct_ck
                               check (markup_pct >= 0 and markup_pct <= 500),
    turnaround_days            int           not null default 5
                               constraint processes_turnaround_ck
                               check (turnaround_days between 0 and 90),
    throughput_cm3_per_hour    numeric(8,2)  not null
                               constraint processes_throughput_ck
                               check (throughput_cm3_per_hour > 0),
    active                     boolean       not null default true,
    created_at                 timestamptz   not null default now(),
    updated_at                 timestamptz   not null default now()
);

-- Partial index — only active processes are queried in the widget path.
create index if not exists idx_processes_shop_active
    on public.processes(shop_id)
    where active;


-- -----------------------------------------------------------------------------
-- materials
-- Price list per process per shop. Process must belong to the same shop —
-- enforced at trigger-level because PostgreSQL lacks cross-column FKs.
-- -----------------------------------------------------------------------------
create table if not exists public.materials (
    id                 uuid          primary key default gen_random_uuid(),
    shop_id            uuid          not null
                       references public.shops(id) on delete cascade,
    process_id         uuid          not null
                       references public.processes(id) on delete restrict,
    name               text          not null
                       constraint materials_name_length_ck
                       check (length(name) between 1 and 80),
    price_per_cm3      numeric(10,4) not null
                       constraint materials_price_ck
                       check (price_per_cm3 >= 0),
    density_g_per_cm3  numeric(6,3)  not null
                       constraint materials_density_ck
                       check (density_g_per_cm3 > 0),
    colour_hex         text          not null
                       constraint materials_colour_hex_ck
                       check (colour_hex ~ '^#[0-9A-Fa-f]{6}$'),
    active             boolean       not null default true,
    sort_order         int           not null default 100,
    created_at         timestamptz   not null default now(),
    updated_at         timestamptz   not null default now()
);

create index if not exists idx_materials_shop_active
    on public.materials(shop_id, sort_order)
    where active;

create index if not exists idx_materials_process_id
    on public.materials(process_id);


-- -----------------------------------------------------------------------------
-- quotes
-- The hot table. Every widget upload creates one. `session_token` is the
-- anonymous-customer capability used by RLS (see rls_policies migration).
-- -----------------------------------------------------------------------------
create table if not exists public.quotes (
    id                          uuid          primary key default gen_random_uuid(),
    shop_id                     uuid          not null
                                references public.shops(id) on delete cascade,
    process_id                  uuid
                                references public.processes(id) on delete set null,
    material_id                 uuid
                                references public.materials(id) on delete set null,
    status                      text          not null default 'draft'
                                constraint quotes_status_ck
                                check (status in (
                                    'draft','priced','checkout_started',
                                    'paid','failed','expired','cancelled'
                                )),
    -- 32 random bytes encoded base64url without padding = 43 chars.
    session_token               text          not null
                                constraint quotes_session_token_uk unique
                                constraint quotes_session_token_length_ck
                                check (length(session_token) = 43),
    mesh_r2_key                 text,
    mesh_filename               text,
    mesh_volume_cm3             numeric(14,4)
                                constraint quotes_mesh_volume_ck
                                check (mesh_volume_cm3 is null or mesh_volume_cm3 > 0),
    mesh_bbox_x                 numeric(10,3),
    mesh_bbox_y                 numeric(10,3),
    mesh_bbox_z                 numeric(10,3),
    mesh_surface_area_cm2       numeric(14,3),
    quantity                    int           not null default 1
                                constraint quotes_quantity_ck
                                check (quantity between 1 and 10000),
    unit_price                  numeric(12,2),
    subtotal                    numeric(12,2),
    total                       numeric(12,2),
    currency                    char(3)       not null default 'GBP'
                                constraint quotes_currency_ck
                                check (currency ~ '^[A-Z]{3}$'),
    customer_email              citext,
    customer_phone              text,
    customer_name               text,
    stripe_checkout_session_id  text          constraint quotes_stripe_session_uk unique,
    stripe_payment_intent_id    text,
    paid_at                     timestamptz,
    expires_at                  timestamptz   not null default (now() + interval '7 days'),
    ip_hash                     text,
    user_agent                  text,
    created_at                  timestamptz   not null default now(),
    updated_at                  timestamptz   not null default now(),

    constraint quotes_paid_requires_intent_ck
        check (status <> 'paid' or stripe_payment_intent_id is not null),
    constraint quotes_priced_requires_total_ck
        check (status not in ('priced','checkout_started','paid') or total is not null)
);

comment on column public.quotes.session_token is
    'Ephemeral secret issued to widget on quote creation. Anon role reads/updates '
    'rows by session_token match via request.quote_session GUC.';

-- Dashboard: list quotes for a shop, newest first.
create index if not exists idx_quotes_shop_created
    on public.quotes(shop_id, created_at desc);

-- Dashboard: filter by status.
create index if not exists idx_quotes_shop_status_created
    on public.quotes(shop_id, status, created_at desc);

-- Support lookups by customer email.
create index if not exists idx_quotes_customer_email
    on public.quotes(customer_email)
    where customer_email is not null;

-- Usage metering: paid quotes per shop per month.
create index if not exists idx_quotes_shop_paid_at
    on public.quotes(shop_id, paid_at desc)
    where paid_at is not null;

-- Expiry sweeper: cron job nukes draft/priced/checkout_started past expires_at.
create index if not exists idx_quotes_expires_open
    on public.quotes(expires_at)
    where status in ('draft','priced','checkout_started');


-- -----------------------------------------------------------------------------
-- orders
-- Post-payment lifecycle. One order per paid quote.
-- -----------------------------------------------------------------------------
create table if not exists public.orders (
    id               uuid        primary key default gen_random_uuid(),
    quote_id         uuid        not null
                     constraint orders_quote_uk unique
                     references public.quotes(id) on delete restrict,
    status           text        not null default 'in_production'
                     constraint orders_status_ck
                     check (status in (
                        'in_production','ready_to_ship','shipped',
                        'delivered','cancelled','refunded'
                     )),
    tracking_number  text,
    carrier          text,
    shipped_at       timestamptz,
    delivered_at     timestamptz,
    notes            text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists idx_orders_status on public.orders(status);


-- -----------------------------------------------------------------------------
-- quote_events
-- Append-only audit log. Immutability is enforced by trigger in the
-- functions_triggers migration.
-- -----------------------------------------------------------------------------
create table if not exists public.quote_events (
    id           uuid        primary key default gen_random_uuid(),
    quote_id     uuid        not null
                 references public.quotes(id) on delete cascade,
    event_type   text        not null
                 constraint quote_events_type_ck
                 check (event_type in (
                    'created','priced','checkout_started','paid','failed',
                    'shop_viewed','shop_status_changed','refund_requested',
                    'refunded','expired','mesh_downloaded','customer_erasure',
                    'tracking_added'
                 )),
    actor        text        not null default 'system'
                 constraint quote_events_actor_ck
                 check (actor in ('system','shop','customer','stripe','admin')),
    payload      jsonb       not null default '{}'::jsonb,
    created_at   timestamptz not null default now()
);

create index if not exists idx_quote_events_quote_created
    on public.quote_events(quote_id, created_at desc);


-- -----------------------------------------------------------------------------
-- webhook_events
-- Stripe idempotency store. Primary key is Stripe's own event id.
-- -----------------------------------------------------------------------------
create table if not exists public.webhook_events (
    event_id      text        primary key,
    type          text        not null,
    payload       jsonb       not null,
    received_at   timestamptz not null default now(),
    processed_at  timestamptz,
    error         text
);

create index if not exists idx_webhook_events_unprocessed
    on public.webhook_events(received_at)
    where processed_at is null;


-- -----------------------------------------------------------------------------
-- End of init schema. RLS, triggers and the storage bucket land in the
-- follow-up migrations to keep this file strictly about structure.
-- -----------------------------------------------------------------------------
