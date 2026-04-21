import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireShopSession } from '@/lib/auth';
import { env } from '@/lib/env';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

const stateSchema = z.object({ shop_id: z.string().uuid() });

/**
 * Stripe Connect redirects the shop back here with `?code=...&state=...`.
 * We exchange the code for a connected account id and persist it on the shop.
 * Any error here redirects to /billing with an error query param — the shop
 * can retry from the UI.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/billing?connect_error=${encodeURIComponent(error)}`);
  }

  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  if (!code || !stateRaw) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/billing?connect_error=missing_params`);
  }

  try {
    const state = stateSchema.parse(
      JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8')),
    );

    const { supabase, shop } = await requireShopSession();
    if (!shop || shop.id !== state.shop_id) {
      return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/billing?connect_error=state_mismatch`);
    }

    const stripe = getStripe();
    const token = await stripe.oauth.token({ grant_type: 'authorization_code', code });
    const accountId = token.stripe_user_id;
    if (!accountId) {
      return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/billing?connect_error=no_account`);
    }

    await supabase
      .from('shops')
      .update({ stripe_connected_account_id: accountId })
      .eq('id', shop.id);

    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/billing?connected=1`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing/connect/callback] failed', err);
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/billing?connect_error=exchange_failed`);
  }
}
