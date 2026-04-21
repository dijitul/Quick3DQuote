import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireShopSession } from '@/lib/auth';
import { handleUnknownError, jsonError } from '@/lib/api-error';
import { env } from '@/lib/env';
import { getStripe, PLAN_PRICE_IDS, type PlanId } from '@/lib/stripe';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    plan: z.enum(['starter', 'pro', 'scale']).default('starter'),
  })
  .strict();

/**
 * POST /api/v1/billing/checkout — creates a Stripe Checkout session for the
 * shop's platform subscription (our £50/£99/£199 tiers). Returns `{ checkout_url }`.
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const { supabase, user, shop } = await requireShopSession();
    if (!shop) return jsonError(404, 'shop_not_found', 'No shop for this user.', { requestId });
    if (!env.STRIPE_SECRET_KEY) {
      return jsonError(500, 'config_error', 'Stripe is not configured.', { requestId });
    }

    const parsed = bodySchema.safeParse(
      request.headers.get('content-length') ? await request.json().catch(() => ({})) : {},
    );
    const body = parsed.success ? parsed.data : { plan: 'starter' as const };
    const plan: PlanId = body.plan;

    const priceId = PLAN_PRICE_IDS[plan]();
    if (!priceId) {
      return jsonError(500, 'config_error', `STRIPE_PRICE_ID_${plan.toUpperCase()} is not set.`, {
        requestId,
      });
    }

    const stripe = getStripe();

    // Reuse an existing customer id; otherwise create one and persist it so the
    // portal endpoint can find it later.
    let customerId = shop.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: shop.brand_name,
        metadata: { shop_id: shop.id },
      });
      customerId = customer.id;
      await supabase.from('shops').update({ stripe_customer_id: customerId }).eq('id', shop.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${env.NEXT_PUBLIC_APP_URL}/billing?status=success`,
      cancel_url: `${env.NEXT_PUBLIC_APP_URL}/billing?status=cancelled`,
      subscription_data: {
        metadata: { shop_id: shop.id, plan },
      },
      client_reference_id: shop.id,
      allow_promotion_codes: true,
    });

    if (!session.url) {
      return jsonError(502, 'stripe_error', 'Stripe did not return a URL.', { requestId });
    }

    return NextResponse.json(
      { checkout_url: session.url },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
