import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';

import { env } from '@/lib/env';
import { getStripe } from '@/lib/stripe';
import { createSupabaseServiceClient } from '@/lib/supabase/server';

// CRITICAL: Stripe signature verification requires the **raw** request body.
// We disable any runtime that might reshape it.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/webhooks/stripe
 *
 * Handles both platform-level events (subscription/customer) and customer-side
 * checkout completion for embed orders. Idempotency is enforced by inserting
 * into `webhook_events` with `ON CONFLICT (event_id) DO NOTHING`; duplicate
 * deliveries are 200-ed without re-processing.
 */
export async function POST(request: NextRequest) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: { code: 'config_error', message: 'Stripe is not configured.' } },
      { status: 500 },
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json(
      { error: { code: 'bad_signature', message: 'Missing Stripe-Signature header.' } },
      { status: 400 },
    );
  }

  const rawBody = await request.text();

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhooks/stripe] signature verification failed', err);
    return NextResponse.json(
      { error: { code: 'bad_signature', message: 'Signature verification failed.' } },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();

  // Idempotency — if we've seen this event, ack and exit.
  const { error: insertError } = await service.from('webhook_events').insert({
    event_id: event.id,
    type: event.type,
    payload: event as unknown as Record<string, unknown>,
    received_at: new Date().toISOString(),
  });
  if (insertError && insertError.code !== '23505') {
    // 23505 = unique_violation → already processed; any other error is real.
    // eslint-disable-next-line no-console
    console.error('[webhooks/stripe] failed to record event', insertError);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to record event.' } },
      { status: 500 },
    );
  }
  if (insertError?.code === '23505') {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionEvent(service, event.data.object as Stripe.Subscription);
        break;

      case 'checkout.session.completed':
        await handleCheckoutCompleted(service, event.data.object as Stripe.Checkout.Session);
        break;

      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(
          service,
          event.data.object as Stripe.PaymentIntent,
        );
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(service, event.data.object as Stripe.Invoice);
        break;

      default:
        // No-op for unhandled events; we still record them for auditing.
        break;
    }

    await service
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('event_id', event.id);

    return NextResponse.json({ received: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhooks/stripe] handler failed', err);
    // Do NOT mark processed — Stripe will retry and we'll pick it up again.
    return NextResponse.json(
      { error: { code: 'handler_error', message: 'Handler failed.' } },
      { status: 500 },
    );
  }
}

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

async function handleSubscriptionEvent(service: ServiceClient, sub: Stripe.Subscription) {
  const shopId = typeof sub.metadata?.shop_id === 'string' ? sub.metadata.shop_id : null;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return;

  const update: Record<string, unknown> = {
    subscription_status: sub.status,
    stripe_subscription_id: sub.id,
  };
  const planFromMetadata = sub.metadata?.plan;
  if (planFromMetadata === 'starter' || planFromMetadata === 'pro' || planFromMetadata === 'scale') {
    update.plan = planFromMetadata;
  }

  const query = service.from('shops').update(update);
  if (shopId) {
    await query.eq('id', shopId);
  } else {
    await query.eq('stripe_customer_id', customerId);
  }
}

async function handleCheckoutCompleted(service: ServiceClient, session: Stripe.Checkout.Session) {
  // Two shapes:
  //  - mode=subscription: our platform plan — reconciled above via customer.subscription.*
  //  - mode=payment: embed customer paying the shop for a quote
  if (session.mode === 'payment' && session.client_reference_id) {
    const quoteId = session.client_reference_id;
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    await service
      .from('quotes')
      .update({
        status: 'paid',
        stripe_payment_intent_id: paymentIntentId,
        paid_at: new Date().toISOString(),
      })
      .eq('id', quoteId);

    // Create the related order row if it doesn't already exist.
    const { data: existing } = await service
      .from('orders')
      .select('id')
      .eq('quote_id', quoteId)
      .maybeSingle();
    if (!existing) {
      await service.from('orders').insert({ quote_id: quoteId, status: 'in_production' });
    }

    const { data: quote } = await service
      .from('quotes')
      .select('shop_id')
      .eq('id', quoteId)
      .maybeSingle();
    if (quote?.shop_id) {
      await service.from('quote_events').insert({
        quote_id: quoteId,
        shop_id: quote.shop_id,
        event_type: 'paid',
        actor: 'system',
        payload: { stripe_payment_intent_id: paymentIntentId },
      });
    }
  }
}

async function handlePaymentIntentSucceeded(service: ServiceClient, pi: Stripe.PaymentIntent) {
  // Backfill the payment intent id on quotes if the checkout.session event
  // raced ahead and left it null.
  if (!pi.id) return;
  await service
    .from('quotes')
    .update({ stripe_payment_intent_id: pi.id })
    .is('stripe_payment_intent_id', null)
    .eq('stripe_checkout_session_id', pi.metadata?.checkout_session_id ?? '__none__');
}

async function handleInvoicePaymentFailed(service: ServiceClient, invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  await service
    .from('shops')
    .update({ subscription_status: 'past_due' })
    .eq('stripe_customer_id', customerId);
}
