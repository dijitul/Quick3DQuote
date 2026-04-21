import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/server/supabase';
import {
  buildSessionToken,
  errorResponse,
  setSessionCookie,
} from '@/lib/server/session';

/**
 * POST /api/v1/embed/session
 *
 * Bootstrap a widget session. PUBLIC endpoint — no prior cookie required.
 * Returns branding + the active materials/processes the widget needs to
 * render, and sets the session cookie for subsequent WIDGET calls.
 *
 * Multi-tenancy: we resolve the shop strictly from `embed_key`. The shop
 * must have an active subscription (docs/api-design.md §3.1); otherwise
 * 403 subscription_inactive.
 */

const BodySchema = z
  .object({
    embed_key: z.string().min(16).max(64),
    referrer: z.string().max(2048).nullable(),
  })
  .strict();

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse(400, 'validation_error', 'Invalid session request.', err);
  }

  // TODO: rate-limit by IP + embed_key (upstash). Not in MVP scope here;
  // the limiter lives in a shared package (see docs/api-design.md §5).

  const supabase = supabaseAdmin();

  // 1. Find the shop by embed_key.
  const { data: shop, error: shopErr } = await supabase
    .from('shops')
    .select(
      'id, name, accent_colour, logo_url, max_file_bytes, supported_formats, subscription_status',
    )
    .eq('embed_key', body.embed_key)
    .maybeSingle();

  if (shopErr) {
    return errorResponse(500, 'internal_error', 'Lookup failed.');
  }
  if (!shop) {
    return errorResponse(404, 'shop_not_found', 'This shop key is not recognised.');
  }
  if (shop.subscription_status !== 'active' && shop.subscription_status !== 'trialing') {
    return errorResponse(
      403,
      'subscription_inactive',
      'This quoter is paused while the shop sorts their billing.',
    );
  }

  // 2. Load public materials + processes.
  const { data: materials } = await supabase
    .from('materials')
    .select('id, name, process_id, colour_hex, price_pence_per_cm3')
    .eq('shop_id', shop.id)
    .eq('is_active', true)
    .order('name', { ascending: true });

  const { data: processes } = await supabase
    .from('processes')
    .select('id, name, kind, turnaround_days')
    .eq('shop_id', shop.id)
    .eq('is_active', true);

  const processKindById = new Map(
    (processes ?? []).map((p) => [p.id as string, p.kind as 'FDM' | 'SLA' | 'OTHER']),
  );

  // 3. Create session row.
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);

  const { error: insertErr } = await supabase.from('embed_sessions').insert({
    id: sessionId,
    shop_id: shop.id,
    session_hash: crypto
      .createHash('sha256')
      .update(sessionId)
      .digest('hex'),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    referrer: body.referrer ?? null,
  });
  if (insertErr) {
    return errorResponse(500, 'internal_error', 'Could not create session.');
  }

  const token = buildSessionToken(sessionId);

  const responseBody = {
    session_token: token,
    expires_at: expiresAt.toISOString(),
    shop: {
      id: shop.id,
      name: shop.name,
      accent_colour: shop.accent_colour ?? '#6366F1',
      logo_url: shop.logo_url ?? null,
      currency: 'GBP' as const,
      supported_formats: (shop.supported_formats ?? ['stl', 'obj', '3mf']) as Array<
        'stl' | 'obj' | '3mf'
      >,
      max_file_bytes: shop.max_file_bytes ?? 100 * 1024 * 1024,
      materials: (materials ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        process_id: m.process_id,
        process_kind: processKindById.get(m.process_id) ?? 'OTHER',
        colour_hex: m.colour_hex,
        price_pence_per_cm3: m.price_pence_per_cm3,
      })),
      processes: (processes ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        turnaround_days: p.turnaround_days,
      })),
    },
  };

  const res = NextResponse.json(responseBody, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
  setSessionCookie(res, token);
  return res;
}
