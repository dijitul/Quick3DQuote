import 'server-only';
import { cookies } from 'next/headers';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env';
import { supabaseAdmin } from './supabase';

/**
 * Embed session helpers.
 *
 * The session_token is a signed opaque string:
 *
 *   {session_id}.{hmac(session_id, SESSION_SIGNING_SECRET)}
 *
 * The session_id is a random 128-bit value. Both `session_id` and
 * `shop_id` are looked up from `embed_sessions` on every request.
 *
 * Cookies are SameSite=None + Secure (per docs/api-design.md §2.2) because
 * the iframe is cross-site to the host page; the cookie must flow on the
 * same-origin requests the iframe makes back to our API.
 */

const COOKIE_NAME = 'q3dq_embed_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days absolute cap

export type EmbedSession = {
  session_id: string;
  shop_id: string;
};

function sign(sessionId: string): string {
  return crypto
    .createHmac('sha256', serverEnv.SESSION_SIGNING_SECRET)
    .update(sessionId)
    .digest('hex');
}

function verify(token: string): string | null {
  const idx = token.indexOf('.');
  if (idx < 0) return null;
  const sessionId = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = sign(sessionId);
  // timing-safe compare
  const a = Buffer.from(mac, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? sessionId : null;
}

export function buildSessionToken(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function setSessionCookie(res: NextResponse, token: string): void {
  const isProd = serverEnv.NODE_ENV === 'production';
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    // SameSite=None is required so the cookie flows on requests from an
    // iframe embedded cross-site. Must pair with Secure in prod.
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Resolve the embed session from cookies + header X-Embed-Key. Returns
 * null if invalid/expired; callers should respond 401 invalid_session.
 */
export async function readEmbedSession(
  embedKey: string | null,
): Promise<EmbedSession | null> {
  if (!embedKey) return null;
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const sessionId = verify(token);
  if (!sessionId) return null;

  const { data, error } = await supabaseAdmin()
    .from('embed_sessions')
    .select('id, shop_id, expires_at, shop:shops(embed_key)')
    .eq('id', sessionId)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;

  // Cross-check: the embed_key on the request must belong to the session's shop.
  const shop = data.shop as { embed_key: string } | null;
  if (!shop || shop.embed_key !== embedKey) return null;

  return { session_id: data.id, shop_id: data.shop_id };
}

/**
 * Helper for routes that absolutely require a session.
 * Returns the session or a pre-baked 401 response.
 */
export async function requireEmbedSession(
  embedKey: string | null,
): Promise<EmbedSession | NextResponse> {
  const session = await readEmbedSession(embedKey);
  if (!session) {
    return errorResponse(401, 'invalid_session', 'Your session has expired. Please refresh.');
  }
  return session;
}

// ---- Error helper shared by every route ----

export function errorResponse(
  status: number,
  code: string,
  message: string,
  detail?: unknown,
): NextResponse {
  const requestId = crypto.randomUUID();
  return NextResponse.json(
    { error: { code, message, detail, request_id: requestId } },
    {
      status,
      headers: {
        'X-Request-Id': requestId,
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
