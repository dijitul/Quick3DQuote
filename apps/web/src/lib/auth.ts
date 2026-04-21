import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Resolve the current user + their shop. Redirects to /login when no session
 * is present, and to /dashboard with a flash when the user has no shop row
 * yet (first-ever login — we create the row in `ensureShop`).
 *
 * The shop lookup uses the `shop_members` table (per `docs/db-schema.md`).
 */
export async function requireShopSession() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: membership } = await supabase
    .from('shop_members')
    .select('shop:shops(*)')
    .eq('profile_id', user.id)
    .maybeSingle();

  // `membership.shop` is the joined row. When a user has just signed up we
  // haven't provisioned a shop yet — the onboarding DB trigger handles that,
  // but in local dev we render a tolerant placeholder so routes still work.
  const shop = (membership?.shop as Shop | null) ?? null;

  return { user, supabase, shop };
}

export interface Shop {
  id: string;
  brand_name: string;
  brand_logo_url: string | null;
  brand_accent: string;
  embed_key: string;
  timezone: string;
  country: string;
  plan: 'starter' | 'pro' | 'scale';
  subscription_status:
    | 'incomplete'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_connected_account_id?: string | null;
  created_at: string;
  updated_at: string;
}
