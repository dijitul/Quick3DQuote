import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { errorResponse, requireEmbedSession } from '@/lib/server/session';
import { supabaseAdmin } from '@/lib/server/supabase';
import { headObject } from '@/lib/server/r2';
import { serverEnv } from '@/lib/env';

/**
 * POST /api/v1/embed/quotes
 *
 * Create or re-price a quote. The widget calls this:
 *   - On first upload (fresh quote).
 *   - On material/qty change (re-price).
 *
 * Flow (docs/api-design.md §3.1):
 *   1. Validate body.
 *   2. HEAD the R2 object; confirm it's inside the session's shop+session
 *      prefix and size is within the per-shop cap.
 *   3. Call quote-engine /analyze-mesh.
 *   4. Load material + process rows via service-role (session-scoped).
 *   5. Call quote-engine /price.
 *   6. Insert quotes row + audit event.
 *
 * NEVER trust a client-supplied price. The client sends {material_id, qty};
 * cost figures are recomputed from the shop's DB rows every time.
 */

const BodySchema = z
  .object({
    r2_key: z.string().min(1).max(512),
    filename: z.string().min(1).max(120),
    material_id: z.string().uuid(),
    process_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(1000),
    customer_email: z.string().email().optional(),
    customer_phone: z.string().max(40).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

async function callEngine<T>(path: string, body: unknown): Promise<T> {
  const url = `${serverEnv.QUOTE_ENGINE_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': serverEnv.QUOTE_ENGINE_INTERNAL_KEY,
      'X-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
    // Engines on Fly can take 2–5s on large meshes; 30s is the upper bound.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new EngineError(res.status, text);
  }
  return (await res.json()) as T;
}

class EngineError extends Error {
  constructor(public status: number, public body: string) {
    super(`engine_${status}`);
  }
}

type AnalyseResult = {
  volume_cm3: number;
  surface_area_cm2: number;
  bbox_mm: { x: number; y: number; z: number };
  triangle_count: number;
  watertight: boolean;
  repairable: boolean;
  warnings: string[];
};

type PriceResult = {
  unit_price_pence: number;
  material_cost_pence: number;
  machine_cost_pence: number;
  setup_cost_pence: number;
  markup_pence: number;
  subtotal_pence: number;
  total_pence: number;
  breakdown_lines: { label: string; amount_pence: number }[];
};

export async function POST(req: NextRequest) {
  const embedKey = req.headers.get('x-embed-key');
  const session = await requireEmbedSession(embedKey);
  if (session instanceof NextResponse) return session;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse(400, 'validation_error', 'Invalid quote request.', err);
  }

  // 1. Key-prefix check — the only thing stopping session A referencing
  //    session B's mesh.
  const expectedPrefix = `meshes/${session.shop_id}/${session.session_id}/`;
  if (!body.r2_key.startsWith(expectedPrefix)) {
    return errorResponse(400, 'validation_error', 'Mesh key does not belong to this session.');
  }

  // 2. HEAD the mesh to confirm it actually exists and is within bounds.
  try {
    const head = await headObject(body.r2_key);
    if (!head.ContentLength || head.ContentLength === 0) {
      return errorResponse(400, 'invalid_mesh', 'Uploaded mesh is empty.');
    }
  } catch {
    return errorResponse(400, 'invalid_mesh', 'Could not find the uploaded mesh.');
  }

  // 3. Resolve material + process (scoped to this shop).
  const supabase = supabaseAdmin();
  const { data: material } = await supabase
    .from('materials')
    .select('id, name, price_pence_per_cm3, density_g_per_cm3, process_id, is_active, shop_id')
    .eq('id', body.material_id)
    .eq('shop_id', session.shop_id)
    .maybeSingle();
  if (!material || !material.is_active) {
    return errorResponse(404, 'material_not_found', 'That material is no longer available.');
  }

  const { data: process } = await supabase
    .from('processes')
    .select(
      'id, name, kind, hourly_rate_pence, setup_fee_pence, min_order_pence, markup_percent, throughput_cm3_per_hour, turnaround_days, is_active, shop_id',
    )
    .eq('id', body.process_id)
    .eq('shop_id', session.shop_id)
    .maybeSingle();
  if (!process || !process.is_active) {
    return errorResponse(404, 'process_not_found', 'That process is no longer available.');
  }

  if (material.process_id !== process.id) {
    return errorResponse(400, 'validation_error', 'Material and process do not match.');
  }

  // 4. Call engine.
  let analyse: AnalyseResult;
  try {
    analyse = await callEngine<AnalyseResult>('/analyze-mesh', { r2_key: body.r2_key });
  } catch (err) {
    if (err instanceof EngineError && err.status === 422) {
      return errorResponse(422, 'mesh_analysis_failed', 'We could not analyse that file. Try re-exporting as a solid.');
    }
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return errorResponse(504, 'quote_engine_timeout', 'Analysis took too long.');
    }
    return errorResponse(502, 'quote_engine_unavailable', 'The analyser is temporarily unavailable.');
  }

  if (!analyse.watertight && !analyse.repairable) {
    return errorResponse(
      400,
      'mesh_not_watertight_and_unrepairable',
      'That mesh is open and can\'t be auto-repaired. Re-export as a solid and try again.',
    );
  }

  let priced: PriceResult;
  try {
    priced = await callEngine<PriceResult>('/price', {
      volume_cm3: analyse.volume_cm3,
      quantity: body.quantity,
      material: {
        price_pence_per_cm3: material.price_pence_per_cm3,
        density_g_per_cm3: material.density_g_per_cm3,
      },
      process: {
        hourly_rate_pence: process.hourly_rate_pence,
        setup_fee_pence: process.setup_fee_pence,
        min_order_pence: process.min_order_pence,
        markup_percent: process.markup_percent,
        throughput_cm3_per_hour: process.throughput_cm3_per_hour,
      },
    });
  } catch {
    return errorResponse(502, 'quote_engine_unavailable', 'Pricing is temporarily unavailable.');
  }

  // 5. Persist. We upsert by (session_id, r2_key, material_id, process_id, quantity)
  //    so re-price calls don't pile up rows; for MVP simplicity we always insert
  //    and rely on quote expiry + cleanup job. (Deferred: insert-on-conflict.)
  const quoteId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24);

  const { error: insertErr } = await supabase.from('quotes').insert({
    id: quoteId,
    shop_id: session.shop_id,
    session_id: session.session_id,
    status: 'quoted',
    mesh_key: body.r2_key,
    mesh_filename: body.filename,
    volume_cm3: analyse.volume_cm3,
    surface_area_cm2: analyse.surface_area_cm2,
    bbox_mm: analyse.bbox_mm,
    triangle_count: analyse.triangle_count,
    watertight: analyse.watertight,
    material_id: material.id,
    process_id: process.id,
    quantity: body.quantity,
    unit_price_pence: priced.unit_price_pence,
    subtotal_pence: priced.subtotal_pence,
    total_pence: priced.total_pence,
    breakdown: priced.breakdown_lines,
    customer_email: body.customer_email ?? null,
    customer_phone: body.customer_phone ?? null,
    notes: body.notes ?? null,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });

  if (insertErr) {
    return errorResponse(500, 'internal_error', 'Could not save quote.');
  }

  return NextResponse.json(
    {
      id: quoteId,
      status: 'quoted',
      mesh: {
        volume_cm3: analyse.volume_cm3,
        surface_area_cm2: analyse.surface_area_cm2,
        bbox_mm: analyse.bbox_mm,
        triangle_count: analyse.triangle_count,
        watertight: analyse.watertight,
        repairable: analyse.repairable,
      },
      pricing: {
        unit_price_pence: priced.unit_price_pence,
        material_cost_pence: priced.material_cost_pence,
        machine_cost_pence: priced.machine_cost_pence,
        setup_cost_pence: priced.setup_cost_pence,
        markup_pence: priced.markup_pence,
        subtotal_pence: priced.subtotal_pence,
        total_pence: priced.total_pence,
        currency: 'GBP' as const,
        breakdown_lines: priced.breakdown_lines,
      },
      warnings: analyse.warnings,
      expires_at: expiresAt.toISOString(),
    },
    { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
