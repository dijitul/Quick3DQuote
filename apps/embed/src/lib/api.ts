import { z } from 'zod';

/**
 * Typed fetch client for the embed API (/api/v1/embed/*).
 *
 * Key rules:
 *   - Every response is Zod-parsed before we hand it to callers.
 *   - Mutating calls include an Idempotency-Key (crypto-random UUID).
 *   - 5xx and network errors retry up to 2 times with jittered backoff.
 *   - We NEVER trust prices returned from the server blindly — callers
 *     still render from the server response, but the server is also the
 *     source of truth on checkout.
 */

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    detail: z.unknown().optional(),
    request_id: z.string().optional(),
  }),
});

// ---------- Public schemas ----------

export const MaterialPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  process_id: z.string(),
  process_kind: z.enum(['FDM', 'SLA', 'OTHER']),
  colour_hex: z.string(),
  price_pence_per_cm3: z.number().int().nonnegative(),
});

export const ProcessPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['FDM', 'SLA', 'OTHER']),
  turnaround_days: z.number().int().positive(),
});

export const ShopBrandingSchema = z.object({
  id: z.string(),
  name: z.string(),
  accent_colour: z.string(),
  logo_url: z.string().nullable(),
  currency: z.literal('GBP'),
  supported_formats: z.array(z.enum(['stl', 'obj', '3mf'])),
  max_file_bytes: z.number().int().positive(),
  materials: z.array(MaterialPublicSchema),
  processes: z.array(ProcessPublicSchema),
});

export const SessionResponseSchema = z.object({
  session_token: z.string(),
  expires_at: z.string(),
  shop: ShopBrandingSchema,
});

export const UploadUrlResponseSchema = z.object({
  upload_url: z.string().url(),
  r2_key: z.string(),
  expires_at: z.string(),
  required_headers: z.record(z.string(), z.string()),
});

export const QuoteResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  mesh: z.object({
    volume_cm3: z.number(),
    surface_area_cm2: z.number(),
    bbox_mm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    triangle_count: z.number().int(),
    watertight: z.boolean(),
    repairable: z.boolean().optional(),
  }),
  pricing: z.object({
    unit_price_pence: z.number().int(),
    material_cost_pence: z.number().int(),
    machine_cost_pence: z.number().int(),
    setup_cost_pence: z.number().int(),
    markup_pence: z.number().int(),
    subtotal_pence: z.number().int(),
    total_pence: z.number().int(),
    currency: z.literal('GBP'),
    breakdown_lines: z.array(
      z.object({
        label: z.string(),
        amount_pence: z.number().int(),
      }),
    ),
  }),
  warnings: z.array(z.string()).optional(),
  expires_at: z.string(),
});

export const CheckoutResponseSchema = z.object({
  checkout_url: z.string().url(),
  expires_at: z.string(),
});

// ---------- Types ----------

export type ShopBranding = z.infer<typeof ShopBrandingSchema>;
export type MaterialPublic = z.infer<typeof MaterialPublicSchema>;
export type ProcessPublic = z.infer<typeof ProcessPublicSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type UploadUrlResponse = z.infer<typeof UploadUrlResponseSchema>;
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

// ---------- Transport ----------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    const parsed = ErrorSchema.safeParse(body);
    if (parsed.success) {
      return new ApiError(
        parsed.data.error.code,
        res.status,
        parsed.data.error.message,
        parsed.data.error.detail,
      );
    }
  } catch {
    // Fall through to generic error.
  }
  return new ApiError('internal_error', res.status, res.statusText || 'Request failed');
}

type RequestOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  retry?: number;
  embedKey?: string | null;
  signal?: AbortSignal;
};

async function request<T>(
  path: string,
  schema: z.ZodSchema<T>,
  opts: RequestOpts = {},
): Promise<T> {
  const { method = 'GET', body, retry = 2, embedKey, signal } = opts;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (embedKey) headers['X-Embed-Key'] = embedKey;
  if (method !== 'GET') headers['Idempotency-Key'] = randomIdempotencyKey();

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retry) {
    try {
      const res = await fetch(path, {
        method,
        credentials: 'include', // embed session cookie
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });

      if (res.ok) {
        const json = await res.json();
        return schema.parse(json);
      }

      const err = await parseError(res);

      // 4xx is terminal — no retries.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw err;
      }

      lastError = err;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        throw e;
      }
      lastError = e;
    }

    // Jittered exponential backoff: 300ms, 900ms.
    const delay = 300 * Math.pow(3, attempt) + Math.floor(Math.random() * 150);
    attempt += 1;
    if (attempt <= retry) await sleep(delay);
  }

  throw lastError ?? new ApiError('internal_error', 0, 'Request failed');
}

// ---------- Public API ----------

export const api = {
  createSession(embedKey: string, referrer: string | null) {
    return request('/api/v1/embed/session', SessionResponseSchema, {
      method: 'POST',
      body: { embed_key: embedKey, referrer },
    });
  },

  getUploadUrl(
    embedKey: string,
    payload: { filename: string; content_type: string; size_bytes: number },
  ) {
    return request('/api/v1/embed/upload-url', UploadUrlResponseSchema, {
      method: 'POST',
      body: payload,
      embedKey,
    });
  },

  createQuote(
    embedKey: string,
    payload: {
      r2_key: string;
      filename: string;
      material_id: string;
      process_id: string;
      quantity: number;
    },
  ) {
    return request('/api/v1/embed/quotes', QuoteResponseSchema, {
      method: 'POST',
      body: payload,
      embedKey,
    });
  },

  getQuote(embedKey: string, id: string) {
    return request(`/api/v1/embed/quotes/${encodeURIComponent(id)}`, QuoteResponseSchema, {
      method: 'GET',
      embedKey,
    });
  },

  createCheckout(
    embedKey: string,
    quoteId: string,
    payload: {
      success_url: string;
      cancel_url: string;
      customer_email: string;
      customer_phone?: string | null;
      customer_name?: string | null;
      notes?: string | null;
    },
  ) {
    return request(
      `/api/v1/embed/quotes/${encodeURIComponent(quoteId)}/checkout`,
      CheckoutResponseSchema,
      { method: 'POST', body: payload, embedKey },
    );
  },
};

// ---------- XHR upload helper (progress-capable PUT to R2) ----------

/**
 * Upload a file directly to R2 via the presigned URL. We use XHR (not fetch)
 * because fetch doesn't surface upload progress events in any browser that
 * ships to real users in 2026.
 */
export function putToPresignedUrl(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    for (const [k, v] of Object.entries(headers)) {
      // Some browsers refuse to set Content-Length — we skip it silently.
      if (k.toLowerCase() === 'content-length') continue;
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError('upload_failed', xhr.status, `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError('upload_failed', 0, 'Network error'));
    xhr.onabort = () => reject(new ApiError('upload_aborted', 0, 'Upload aborted'));
    if (signal) {
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}
