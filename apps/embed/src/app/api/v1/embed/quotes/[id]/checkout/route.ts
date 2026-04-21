import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import Stripe from 'stripe';
import { errorResponse, requireEmbedSession } from '@/lib/server/session';
import { supabaseAdmin } from '@/lib/server/supabase';
import { serverEnv } from '@/lib/env';

/**
 * POST /api/v1/embed/quotes/:id/checkout
 *
 * Create a Stripe Checkout session **on the shop's connected Stripe
 * account** (CLAUDE.md §11.3 — direct-to-shop for v1). The shop's Stripe
 * account id is stored on the `shops.stripe_account_id` column after they
 * connect via OAuth in the dashboard.
 *
 * We compute the Stripe line items from the DB row, not from the request
 * body. The total_pence is the authoritative number; we show it to the
 * customer but NEVER accept it as an input (docs/security.md §2.2).
 */

const BodySchema = z
  .object({
    success_url: z.string().url(),
    cancel_url: z.string().url(),
    customer_email: z.string().email(),
    customer_phone: z.string().max(40).nullable().optional(),
    customer_name: z.string().max(120).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

// Lazy — keeps module init cheap if we ever edge-run a neighbour.
let _stripe: Stripe | null = null;
function stripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(serverEnv.STRIPE_SECRET_KEY, { apiVersion: '2024-09-30.acacia' });
  }
  return _stripe;
}

/**
 * Redirect URLs must match one of the shop's pre-approved origins
 * (docs/api-design.md §3.1 — `allowed_redirect_origins`). For dev we allow
 * the configured NEXT_PUBLIC_EMBED_ORIGIN by default.
 */
function isAllowedUrl(url: string, allowed: string[]): boolean {
  try {
    const u = new URL(url);
    return allowed.some((a) => {
      try {
        return new URL(a).origin === u.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const embedKey = req.headers.get('x-embed-key');
  const session = await requireEmbedSession(embedKey);
  if (session instanceof NextResponse) return session;

  const { id } = await ctx.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse(400, 'validation_error', 'Invalid checkout request.', err);
  }

  const supabase = supabaseAdmin();

  // 1. Load quote — must belong to this session's shop, not paid, not expired.
  const { data: quote } = await supabase
    .from('quotes')
    .select(
      'id, status, shop_id, material_id, total_pence, mesh_filename, expires_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (!quote || quote.shop_id !== session.shop_id) {
    return errorResponse(404, 'quote_not_found', 'We could not find that order.');
  }
  if (quote.status === 'paid') {
    return errorResponse(409, 'quote_already_paid', 'This order has already been paid.');
  }
  if (new Date(quote.expires_at).getTime() < Date.now()) {
    return errorResponse(409, 'quote_expired', 'This quote has expired. Please restart.');
  }

  // 2. Load shop — need the connected account id + redirect allowlist.
  const { data: shop } = await supabase
    .from('shops')
    .select(
      'id, name, stripe_account_id, allowed_redirect_origins, logo_url, currency',
    )
    .eq('id', session.shop_id)
    .maybeSingle();

  if (!shop || !shop.stripe_account_id) {
    return errorResponse(502, 'stripe_error', 'This shop has not connected a payment method.');
  }

  const allowedOrigins = [
    serverEnv.NEXT_PUBLIC_EMBED_ORIGIN,
    ...((shop.allowed_redirect_origins as string[] | null) ?? []),
  ];

  if (!isAllowedUrl(body.success_url, allowedOrigins)) {
    return errorResponse(400, 'invalid_redirect_url', 'Success URL is not allowed.');
  }
  if (!isAllowedUrl(body.cancel_url, allowedOrigins)) {
    return errorResponse(400, 'invalid_redirect_url', 'Cancel URL is not allowed.');
  }

  // 3. Persist contact details on the quote before redirect.
  await supabase
    .from('quotes')
    .update({
      customer_email: body.customer_email,
      customer_phone: body.customer_phone ?? null,
      customer_name: body.customer_name ?? null,
      notes: body.notes ?? null,
    })
    .eq('id', quote.id);

  // 4. Create the Stripe Checkout Session ON the shop's connected account.
  //    For v1 we use direct charges: stripe_account param puts the session
  //    on that account, the shop is the seller of record.
  try {
    const checkout = await stripe().checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        client_reference_id: quote.id,
        customer_email: body.customer_email,
        success_url: body.success_url,
        cancel_url: body.cancel_url,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: ((shop.currency as string) ?? 'gbp').toLowerCase(),
              unit_amount: quote.total_pence,
              product_data: {
                name: `3D print: ${quote.mesh_filename}`,
                description: `Order from ${shop.name}`,
                metadata: { quote_id: quote.id },
              },
            },
          },
        ],
        metadata: {
          quote_id: quote.id,
          shop_id: shop.id,
        },
      },
      { stripeAccount: shop.stripe_account_id },
    );

    if (!checkout.url) {
      return errorResponse(502, 'stripe_error', 'Could not start checkout.');
    }

    return NextResponse.json(
      {
        checkout_url: checkout.url,
        expires_at: new Date((checkout.expires_at ?? 0) * 1000).toISOString(),
      },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[q3dq:checkout] stripe error', err);
    return errorResponse(502, 'stripe_error', 'Payment provider unavailable.');
  }
}
