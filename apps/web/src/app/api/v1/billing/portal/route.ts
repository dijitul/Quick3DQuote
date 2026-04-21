import { NextResponse } from 'next/server';

import { requireShopSession } from '@/lib/auth';
import { handleUnknownError, jsonError } from '@/lib/api-error';
import { env } from '@/lib/env';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

/**
 * POST /api/v1/billing/portal — returns a Stripe Customer Portal URL for the
 * shop's platform subscription. The portal handles cancellation, invoice
 * download, and card updates — we never render that UI ourselves.
 */
export async function POST() {
  const requestId = crypto.randomUUID();
  try {
    const { shop } = await requireShopSession();
    if (!shop) return jsonError(404, 'shop_not_found', 'No shop for this user.', { requestId });
    if (!shop.stripe_customer_id) {
      return jsonError(
        404,
        'no_stripe_customer',
        'Start a subscription before managing billing.',
        { requestId },
      );
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: shop.stripe_customer_id,
      return_url: `${env.NEXT_PUBLIC_APP_URL}/billing`,
    });

    return NextResponse.json(
      { portal_url: session.url },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
