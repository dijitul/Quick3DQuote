import { NextResponse } from 'next/server';

import { requireShopSession } from '@/lib/auth';
import { handleUnknownError, jsonError } from '@/lib/api-error';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * POST /api/v1/billing/connect — kicks off Stripe Connect (Standard account)
 * OAuth. We hand the shop owner the authorise URL; Stripe redirects back to
 * `/api/v1/billing/connect/callback` with a `code` we exchange for an
 * `account_id`, which is what drives customer-side destination charges.
 */
export async function POST() {
  const requestId = crypto.randomUUID();
  try {
    const { shop } = await requireShopSession();
    if (!shop) return jsonError(404, 'shop_not_found', 'No shop for this user.', { requestId });
    if (!env.STRIPE_CLIENT_ID) {
      return jsonError(500, 'config_error', 'STRIPE_CLIENT_ID is not set.', { requestId });
    }

    const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/v1/billing/connect/callback`;
    const state = Buffer.from(JSON.stringify({ shop_id: shop.id }), 'utf8').toString('base64url');

    const url = new URL('https://connect.stripe.com/oauth/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', env.STRIPE_CLIENT_ID);
    url.searchParams.set('scope', 'read_write');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('stripe_user[country]', shop.country ?? 'GB');

    return NextResponse.json({ url: url.toString() }, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
