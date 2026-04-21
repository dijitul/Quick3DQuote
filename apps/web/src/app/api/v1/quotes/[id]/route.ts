import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireShopSession } from '@/lib/auth';
import { handleUnknownError, jsonError } from '@/lib/api-error';
import { createSupabaseServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Per `docs/db-schema.md` §2.6 quote.status is constrained to
 *   draft | priced | checkout_started | paid | failed | expired | cancelled
 * The dashboard UI also emits `in_production` and `shipped` — those live on
 * `orders.status`. The PATCH below fans out accordingly:
 *
 *  - `paid` / `cancelled` → `quotes.status`
 *  - `in_production` / `shipped` → `orders.status` on the related order row
 *  - `tracking_number` → `orders.tracking_number`
 */
const patchSchema = z
  .object({
    status: z
      .enum(['paid', 'in_production', 'shipped', 'cancelled'])
      .optional(),
    tracking_number: z.string().max(80).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Provide at least one field to update.',
  });

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError(400, 'validation_error', 'Invalid quote id.', { requestId });
    }

    const { supabase } = await requireShopSession();
    const { data, error } = await supabase
      .from('quotes')
      .select(
        `*,
         material:materials(name, colour_hex, price_per_cm3),
         process:processes(type, name, turnaround_days),
         order:orders(id, status, tracking_number, carrier, shipped_at)`,
      )
      .eq('id', id)
      .maybeSingle();

    if (error) return jsonError(500, 'internal_error', error.message, { requestId });
    if (!data) return jsonError(404, 'quote_not_found', 'Quote not found.', { requestId });

    return NextResponse.json(data, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError(400, 'validation_error', 'Invalid quote id.', { requestId });
    }

    const { supabase, shop } = await requireShopSession();
    if (!shop)
      return jsonError(409, 'shop_missing', 'No shop attached to this user.', { requestId });

    const body = patchSchema.parse(await request.json());

    // Load the quote (through RLS so cross-tenant reads fail here, not later).
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, shop_id, status')
      .eq('id', id)
      .maybeSingle();
    if (quoteError) return jsonError(500, 'internal_error', quoteError.message, { requestId });
    if (!quote) return jsonError(404, 'quote_not_found', 'Quote not found.', { requestId });

    // Service client bypasses RLS; we've already proven tenancy above. We need it
    // because `orders` may not be exposed under shop-user RLS in every install.
    const service = createSupabaseServiceClient();

    // 1. Quote-level status transitions.
    if (body.status === 'paid' || body.status === 'cancelled') {
      const { error } = await service
        .from('quotes')
        .update({ status: body.status })
        .eq('id', quote.id);
      if (error) return jsonError(500, 'internal_error', error.message, { requestId });

      await service.from('quote_events').insert({
        quote_id: quote.id,
        shop_id: shop.id,
        event_type: 'status_changed',
        actor: 'shop_user',
        payload: { to: body.status },
      });
    }

    // 2. Order-level status transitions (ensure order row exists first).
    if (body.status === 'in_production' || body.status === 'shipped') {
      const { data: existing } = await service
        .from('orders')
        .select('id')
        .eq('quote_id', quote.id)
        .maybeSingle();

      const now = new Date().toISOString();
      const update: Record<string, unknown> = { status: body.status };
      if (body.status === 'shipped') update.shipped_at = now;

      if (existing) {
        const { error } = await service.from('orders').update(update).eq('id', existing.id);
        if (error) return jsonError(500, 'internal_error', error.message, { requestId });
      } else {
        const { error } = await service
          .from('orders')
          .insert({ quote_id: quote.id, ...update });
        if (error) return jsonError(500, 'internal_error', error.message, { requestId });
      }

      await service.from('quote_events').insert({
        quote_id: quote.id,
        shop_id: shop.id,
        event_type: 'status_changed',
        actor: 'shop_user',
        payload: { to: body.status },
      });
    }

    // 3. Tracking number — always goes on orders.
    if (body.tracking_number !== undefined) {
      const { data: existing } = await service
        .from('orders')
        .select('id')
        .eq('quote_id', quote.id)
        .maybeSingle();

      if (existing) {
        const { error } = await service
          .from('orders')
          .update({ tracking_number: body.tracking_number })
          .eq('id', existing.id);
        if (error) return jsonError(500, 'internal_error', error.message, { requestId });
      } else {
        const { error } = await service
          .from('orders')
          .insert({ quote_id: quote.id, tracking_number: body.tracking_number });
        if (error) return jsonError(500, 'internal_error', error.message, { requestId });
      }

      await service.from('quote_events').insert({
        quote_id: quote.id,
        shop_id: shop.id,
        event_type: 'tracking_added',
        actor: 'shop_user',
        payload: { tracking_number: body.tracking_number },
      });
    }

    return NextResponse.json({ ok: true }, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
