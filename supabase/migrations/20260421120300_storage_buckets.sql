-- =============================================================================
-- 20260421120300_storage_buckets.sql
-- -----------------------------------------------------------------------------
-- Supabase Storage buckets.
--
-- Primary mesh storage lives in Cloudflare R2 (see CLAUDE.md §2 + security.md
-- §1.1) — we pick R2 for zero egress on 5–200MB STL files. Supabase Storage
-- is kept for a single small-object use case: shop branding logos. Those are
-- PNG/JPG under ~500 KB, benefit from Supabase's CDN + image-transformation
-- endpoint, and live close to the row they describe (shops.brand_logo_url).
--
-- Bucket: `logos`
--   * public = true so the widget can fetch the logo without an auth token
--     (the logo is shown on arbitrary third-party sites — no sensitivity);
--   * size limit 2 MB enforced by policy + by the upload API route;
--   * MIME allowlist: PNG/JPG only. SVG is rejected per security.md §6.3
--     (SVG is an XSS vector).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'logos',
    'logos',
    true,
    2 * 1024 * 1024,                       -- 2 MB
    array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;


-- -----------------------------------------------------------------------------
-- Storage RLS. Path convention: `logos/{shop_id}/{filename}`. That scheme
-- keeps the shop_id as the first path segment, which storage.foldername()
-- exposes as [1] and we use in the policy.
--
-- Note: storage RLS is enforced via `storage.objects` which already has RLS
-- enabled by default in Supabase.
-- -----------------------------------------------------------------------------

-- Public SELECT for logos: anyone can GET a logo file (the bucket is public
-- anyway, but this makes the policy explicit for migrations that might
-- audit it later).
drop policy if exists logos_public_read on storage.objects;
create policy logos_public_read on storage.objects
    for select
    to anon, authenticated
    using (bucket_id = 'logos');


-- Shop owners may INSERT / UPDATE / DELETE only under their own shop_id
-- folder. storage.foldername(name) returns the `/`-split array of path
-- components.
drop policy if exists logos_shop_insert on storage.objects;
create policy logos_shop_insert on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'logos'
        and (storage.foldername(name))[1] = public.current_shop_id()::text
    );

drop policy if exists logos_shop_update on storage.objects;
create policy logos_shop_update on storage.objects
    for update
    to authenticated
    using (
        bucket_id = 'logos'
        and (storage.foldername(name))[1] = public.current_shop_id()::text
    )
    with check (
        bucket_id = 'logos'
        and (storage.foldername(name))[1] = public.current_shop_id()::text
    );

drop policy if exists logos_shop_delete on storage.objects;
create policy logos_shop_delete on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'logos'
        and (storage.foldername(name))[1] = public.current_shop_id()::text
    );


-- -----------------------------------------------------------------------------
-- End of storage bucket configuration.
-- -----------------------------------------------------------------------------
