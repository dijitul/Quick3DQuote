import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireShopSession } from '@/lib/auth';
import { handleUnknownError, jsonError } from '@/lib/api-error';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const patchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    process_id: z.string().uuid().optional(),
    price_per_cm3: z.number().positive().optional(),
    density_g_per_cm3: z.number().positive().optional(),
    colour_hex: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    active: z.boolean().optional(),
    sort_order: z.number().int().nonnegative().optional(),
  })
  .strict();

/** PATCH /api/v1/materials/:id. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError(400, 'validation_error', 'Invalid material id.', { requestId });
    }

    const { supabase } = await requireShopSession();
    const body = patchSchema.parse(await request.json());

    if (Object.keys(body).length === 0) {
      return jsonError(400, 'validation_error', 'No fields to update.', { requestId });
    }

    const { data, error } = await supabase
      .from('materials')
      .update(body)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) return jsonError(500, 'internal_error', error.message, { requestId });
    if (!data) return jsonError(404, 'material_not_found', 'Material not found.', { requestId });

    return NextResponse.json(data, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}

/**
 * DELETE /api/v1/materials/:id — soft-delete (active=false) if referenced by any
 * quote, hard-delete otherwise. Per api-design.md §material, deletes against a
 * material currently referenced by an open quote return 409 so the shop knows
 * why the row didn't vanish.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError(400, 'validation_error', 'Invalid material id.', { requestId });
    }

    const { supabase } = await requireShopSession();

    const { count, error: countError } = await supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('material_id', id);
    if (countError) return jsonError(500, 'internal_error', countError.message, { requestId });

    if ((count ?? 0) > 0) {
      // Referenced — soft-delete.
      const { data, error } = await supabase
        .from('materials')
        .update({ active: false })
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) return jsonError(500, 'internal_error', error.message, { requestId });
      if (!data)
        return jsonError(404, 'material_not_found', 'Material not found.', { requestId });
      return new NextResponse(null, { status: 204, headers: { 'X-Request-Id': requestId } });
    }

    const { error } = await supabase.from('materials').delete().eq('id', id);
    if (error) return jsonError(500, 'internal_error', error.message, { requestId });

    return new NextResponse(null, { status: 204, headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
