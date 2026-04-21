import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';

/**
 * Server-only Supabase clients.
 *
 * Embed API routes use the service-role client because embed customers are
 * unauthenticated — there is no Supabase user JWT to enforce RLS with.
 * Tenant scoping is enforced in application code: every query joins through
 * `embed_sessions` → `shops`, and we scope by the session's `shop_id`.
 *
 * See docs/security.md §2.6: service-role usage is documented per call site.
 */

let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(serverEnv.SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-q3dq-origin': 'embed-app' } },
  });
  return _admin;
}
