import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';

/**
 * Server-side Supabase client used inside React Server Components,
 * route handlers, and server actions. Carries the shop user's cookie
 * so RLS fires under their identity.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options as CookieOptions);
            });
          } catch {
            // `setAll` is called from a Server Component — that path cannot
            // write cookies but is still safe because middleware refreshes the
            // session on every request.
          }
        },
      },
    },
  );
}

/**
 * Service-role client — bypasses RLS. ONLY use for:
 *  - Stripe webhook handlers
 *  - Cross-tenant admin actions
 *  - Server-internal paths where we have already validated the tenant context
 */
export function createSupabaseServiceClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  }

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        /* no-op: service role is stateless */
      },
    },
  });
}
