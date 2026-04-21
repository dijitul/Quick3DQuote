import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireShopSession } from '@/lib/auth';
import { handleUnknownError, jsonError } from '@/lib/api-error';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    brand_name: z.string().min(1).max(120).optional(),
    brand_logo_url: z.string().url().nullable().optional(),
    brand_accent: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    timezone: z.string().min(1).max(64).optional(),
    country: z
      .string()
      .length(2)
      .transform((v) => v.toUpperCase())
      .optional(),
  })
  .strict();

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const { shop } = await requireShopSession();
    if (!shop) return jsonError(404, 'shop_not_found', 'No shop for this user.', { requestId });
    return NextResponse.json(shop, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const { supabase, shop } = await requireShopSession();
    if (!shop) return jsonError(404, 'shop_not_found', 'No shop for this user.', { requestId });

    const body = patchSchema.parse(await request.json());
    if (Object.keys(body).length === 0) {
      return jsonError(400, 'validation_error', 'No fields to update.', { requestId });
    }

    const { data, error } = await supabase
      .from('shops')
      .update(body)
      .eq('id', shop.id)
      .select('*')
      .single();

    if (error) return jsonError(500, 'internal_error', error.message, { requestId });
    return NextResponse.json(data, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
