import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireShopSession } from '@/lib/auth';
import { handleUnknownError, jsonError } from '@/lib/api-error';

export const runtime = 'nodejs';

const createSchema = z
  .object({
    type: z.enum(['FDM', 'SLA', 'SLS', 'MJF']),
    name: z.string().min(1).max(80).optional(),
    hourly_rate: z.number().nonnegative(),
    setup_fee: z.number().nonnegative(),
    min_order: z.number().nonnegative(),
    markup_pct: z.number().min(0).max(500),
    turnaround_days: z.number().int().min(1).max(60),
    throughput_cm3_per_hour: z.number().positive(),
    active: z.boolean().default(true),
  })
  .strict();

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const { supabase } = await requireShopSession();
    const { data, error } = await supabase
      .from('processes')
      .select('*')
      .order('type', { ascending: true });
    if (error) return jsonError(500, 'internal_error', error.message, { requestId });
    return NextResponse.json({ items: data ?? [] }, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const { supabase, shop } = await requireShopSession();
    if (!shop)
      return jsonError(409, 'shop_missing', 'No shop attached to this user.', { requestId });

    const body = createSchema.parse(await request.json());
    const { data, error } = await supabase
      .from('processes')
      .insert({ ...body, shop_id: shop.id })
      .select('*')
      .single();

    if (error) return jsonError(500, 'internal_error', error.message, { requestId });
    return NextResponse.json(data, { status: 201, headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
