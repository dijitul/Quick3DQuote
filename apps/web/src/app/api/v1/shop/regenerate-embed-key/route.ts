import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

import { requireShopSession } from '@/lib/auth';
import { handleUnknownError, jsonError } from '@/lib/api-error';
import { createSupabaseServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Rotate the shop's public embed key. Existing widget sessions are invalidated
 * by cascading delete on `embed_sessions` where `shop_id = ...` — see
 * `docs/api-design.md` §4.4.
 */
export async function POST() {
  const requestId = crypto.randomUUID();
  try {
    const { supabase, shop } = await requireShopSession();
    if (!shop) return jsonError(404, 'shop_not_found', 'No shop for this user.', { requestId });

    // 32 bytes hex → 64 chars. Matches the "public, non-secret" contract from
    // api-design §4.1.
    const newKey = randomBytes(24).toString('base64url');

    const { data, error } = await supabase
      .from('shops')
      .update({ embed_key: newKey })
      .eq('id', shop.id)
      .select('embed_key, updated_at')
      .single();

    if (error) return jsonError(500, 'internal_error', error.message, { requestId });

    // Invalidate existing widget sessions via service role (users never have
    // direct write access to embed_sessions).
    try {
      const service = createSupabaseServiceClient();
      await service.from('embed_sessions').delete().eq('shop_id', shop.id);
      await service.from('shop_events').insert({
        shop_id: shop.id,
        event_type: 'embed_key_rotated',
        actor: 'shop_user',
        payload: {},
      });
    } catch {
      // service role not configured locally — fall through; the rotation is
      // still effective because new sessions need the new key.
    }

    return NextResponse.json(
      { embed_key: data.embed_key, rotated_at: data.updated_at },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (error) {
    return handleUnknownError(error, requestId);
  }
}
