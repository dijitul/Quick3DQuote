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
    hourly_rate: z.number().nonnegative().optional(),
    setup_fee: z.number().nonnegative().optional(),
    min_order: z.number().nonnegative().optional(),
    markup_pct: z.number().min(0).max(500).optional(),
    turnaround_days: z.number().int().min(1).max(60).optional(),
    throughput_cm3_per_hour: z.number().positive().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError(400, 'validation_error', 'Invalid process id.', { requestId });
    }

    const { supabase } = await requireShopSession();
    const body = patchSchema.parse(await request.json());

    if (Object.keys(body).length === 0) {
      return jsonError(400, 'validation_error', 'No fields to update.', { requestId });
    }

    const { data, error } = await supabase
      .from('processes')
      .update(body)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) return jsonError(500, 'internal_error', error.message, { requestId });
    if (!data) return jsonError(404, 'process_not_found', 'Process not found.', { requestId });

    return NextResponse.json(data, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError(400, 'validation_error', 'Invalid process id.', { requestId });
    }

    const { supabase } = await requireShopSession();

    // Processes are always soft-deleted — materials have a FK to processes,
    // and we never want to orphan them.
    const { data, error } = await supabase
      .from('processes')
      .update({ active: false })
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) return jsonError(500, 'internal_error', error.message, { requestId });
    if (!data) return jsonError(404, 'process_not_found', 'Process not found.', { requestId });

    return new NextResponse(null, { status: 204, headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
