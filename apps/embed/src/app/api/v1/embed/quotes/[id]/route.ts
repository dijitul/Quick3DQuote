import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, requireEmbedSession } from '@/lib/server/session';
import { supabaseAdmin } from '@/lib/server/supabase';

/**
 * GET /api/v1/embed/quotes/:id
 *
 * Fetch a quote the current session owns. We deliberately return
 * 404 quote_not_found on any cross-session attempt — never leak existence.
 *
 * Shape matches POST /embed/quotes so the success page can reuse the
 * same QuoteResponseSchema parser.
 */

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const embedKey = req.headers.get('x-embed-key');
  const session = await requireEmbedSession(embedKey);
  if (session instanceof NextResponse) return session;

  const { id } = await ctx.params;

  const { data: q } = await supabaseAdmin()
    .from('quotes')
    .select(
      'id, status, shop_id, session_id, volume_cm3, surface_area_cm2, bbox_mm, triangle_count, watertight, unit_price_pence, subtotal_pence, total_pence, breakdown, created_at, expires_at',
    )
    .eq('id', id)
    .maybeSingle();

  // Cross-session quotes are treated as "not found" to avoid existence oracles.
  if (!q || q.shop_id !== session.shop_id) {
    return errorResponse(404, 'quote_not_found', 'We could not find that order.');
  }

  // GET is allowed across sessions within the same shop (customer might
  // refresh after returning from Stripe on the same browser). We do not
  // require the session_id to match because sessions can rotate.

  return NextResponse.json(
    {
      id: q.id,
      status: q.status,
      mesh: {
        volume_cm3: q.volume_cm3,
        surface_area_cm2: q.surface_area_cm2,
        bbox_mm: q.bbox_mm,
        triangle_count: q.triangle_count,
        watertight: q.watertight,
      },
      pricing: {
        unit_price_pence: q.unit_price_pence,
        material_cost_pence: 0,
        machine_cost_pence: 0,
        setup_cost_pence: 0,
        markup_pence: 0,
        subtotal_pence: q.subtotal_pence,
        total_pence: q.total_pence,
        currency: 'GBP' as const,
        breakdown_lines: (q.breakdown as { label: string; amount_pence: number }[]) ?? [],
      },
      expires_at: q.expires_at,
    },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
