import { createBrowserClient } from '@supabase/ssr';

import { env } from '@/lib/env';

/** Client-side Supabase instance — safe to call from `"use client"` components. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
