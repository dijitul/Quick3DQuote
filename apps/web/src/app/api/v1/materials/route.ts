import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireShopSession } from '@/lib/auth';
import { handleUnknownError, jsonError } from '@/lib/api-error';

export const runtime = 'nodejs';

const createSchema = z
  .object({
    name: z.string().min(1).max(80),
    process_id: z.string().uuid(),
    price_per_cm3: z.number().positive(),
    density_g_per_cm3: z.number().positive(),
    colour_hex: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .default('#1E1E1E'),
    active: z.boolean().default(true),
    sort_order: z.number().int().nonnegative().default(100),
  })
  .strict();

/** GET /api/v1/materials — list the caller's materials (RLS scopes to shop). */
export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const { supabase } = await requireShopSession();
    const { data, error } = await supabase
      .from('materials')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) return jsonError(500, 'internal_error', error.message, { requestId });
    return NextResponse.json({ items: data ?? [] }, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}

/** POST /api/v1/materials — create a material row. */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const { supabase, shop } = await requireShopSession();
    if (!shop) return jsonError(409, 'shop_missing', 'No shop attached to this user.', { requestId });

    const body = createSchema.parse(await request.json());

    // Verify the process belongs to the same shop (RLS already guarantees it, but
    // make a friendlier error if the caller passed a foreign id).
    const { data: process, error: processError } = await supabase
      .from('processes')
      .select('id')
      .eq('id', body.process_id)
      .maybeSingle();
    if (processError || !process) {
      return jsonError(400, 'validation_error', 'Process not found for this shop.', {
        requestId,
      });
    }

    const { data, error } = await supabase
      .from('materials')
      .insert({ ...body, shop_id: shop.id })
      .select('*')
      .single();

    if (error) return jsonError(500, 'internal_error', error.message, { requestId });
    return NextResponse.json(data, { status: 201, headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
