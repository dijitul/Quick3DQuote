import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import {
  errorResponse,
  requireEmbedSession,
} from '@/lib/server/session';
import { supabaseAdmin } from '@/lib/server/supabase';
import { presignUpload } from '@/lib/server/r2';

/**
 * POST /api/v1/embed/upload-url
 *
 * Mint a presigned R2 PUT URL. The key is shaped `meshes/{shop_id}/{session_id}/{uuid}-{sanitised}`
 * so a session can only ever read/write under its own shop+session prefix.
 *
 * See docs/security.md §3 for the hardening list this route enforces:
 *   - Filename regex (no path traversal, no spaces).
 *   - Extension allowlist.
 *   - Size ≤ shop.max_file_bytes.
 *   - 10-minute TTL on the URL.
 */

const FILENAME_RE = /^[A-Za-z0-9._-]{1,120}$/;

const BodySchema = z
  .object({
    filename: z.string().min(1).max(120),
    content_type: z.string().min(1).max(120),
    size_bytes: z.number().int().positive(),
  })
  .strict();

function sanitiseFilename(raw: string): string | null {
  // Collapse common path-traversal tricks before regex.
  const base = raw.split(/[\\/]/).pop() ?? '';
  if (!FILENAME_RE.test(base)) return null;
  return base;
}

export async function POST(req: NextRequest) {
  const embedKey = req.headers.get('x-embed-key');
  const session = await requireEmbedSession(embedKey);
  if (session instanceof NextResponse) return session;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse(400, 'validation_error', 'Invalid upload request.', err);
  }

  const safe = sanitiseFilename(body.filename);
  if (!safe) {
    return errorResponse(400, 'unsupported_format', 'Filename contains invalid characters.');
  }

  const ext = safe.split('.').pop()?.toLowerCase() ?? '';
  if (!['stl', 'obj', '3mf'].includes(ext)) {
    return errorResponse(400, 'unsupported_format', 'We support STL, OBJ, and 3MF files.');
  }

  // Pull the shop's per-tenant cap. Default 100MB.
  const { data: shop } = await supabaseAdmin()
    .from('shops')
    .select('max_file_bytes, supported_formats')
    .eq('id', session.shop_id)
    .maybeSingle();

  const maxBytes = shop?.max_file_bytes ?? 100 * 1024 * 1024;
  if (body.size_bytes > maxBytes) {
    return errorResponse(400, 'file_too_large', `Max file size is ${Math.floor(maxBytes / 1024 / 1024)}MB.`);
  }

  const supported = (shop?.supported_formats as string[] | null) ?? ['stl', 'obj', '3mf'];
  if (!supported.includes(ext)) {
    return errorResponse(400, 'unsupported_format', 'This shop does not accept that file type.');
  }

  const uuid = crypto.randomUUID();
  const key = `meshes/${session.shop_id}/${session.session_id}/${uuid}-${safe}`;
  const expiresInSeconds = 600;

  const uploadUrl = await presignUpload({
    key,
    contentType: body.content_type,
    contentLength: body.size_bytes,
    expiresInSeconds,
  });

  return NextResponse.json(
    {
      upload_url: uploadUrl,
      r2_key: key,
      expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      required_headers: {
        'Content-Type': body.content_type,
        'Content-Length': String(body.size_bytes),
      },
    },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
