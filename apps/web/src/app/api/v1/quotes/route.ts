import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireShopSession } from '@/lib/auth';
import { handleUnknownError, jsonError } from '@/lib/api-error';

export const runtime = 'nodejs';

const listQuerySchema = z.object({
  status: z
    .enum(['draft', 'priced', 'checkout_started', 'paid', 'failed', 'expired', 'cancelled'])
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

interface Cursor {
  created_at: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    const shape = z
      .object({ created_at: z.string(), id: z.string().uuid() })
      .safeParse(parsed);
    return shape.success ? shape.data : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/v1/quotes — cursor-paginated list of quotes for the authenticated
 * shop. Status filter is exact-match. Results are ordered (created_at desc, id desc)
 * and the cursor encodes the last seen `(created_at, id)` tuple per api-design.md §8.
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const { supabase } = await requireShopSession();

    const url = new URL(request.url);
    const parsed = listQuerySchema.parse({
      status: url.searchParams.get('status') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });

    let query = supabase
      .from('quotes')
      .select(
        `id, status, customer_email, customer_name, quantity, total, currency,
         created_at, mesh_filename,
         material:materials(name, colour_hex),
         process:processes(type, name)`,
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(parsed.limit + 1);

    if (parsed.status) query = query.eq('status', parsed.status);

    if (parsed.cursor) {
      const cursor = decodeCursor(parsed.cursor);
      if (!cursor) {
        return jsonError(400, 'validation_error', 'Invalid cursor.', { requestId });
      }
      // Supabase's `.or()` isn't strong enough for a tuple comparison, but
      // "created_at < X OR (created_at = X AND id < Y)" keeps pagination stable.
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) return jsonError(500, 'internal_error', error.message, { requestId });

    const rows = data ?? [];
    const hasMore = rows.length > parsed.limit;
    const items = hasMore ? rows.slice(0, parsed.limit) : rows;

    const last = items.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeCursor({ created_at: String(last.created_at), id: String(last.id) })
        : null;

    return NextResponse.json(
      { items, next_cursor: nextCursor },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
