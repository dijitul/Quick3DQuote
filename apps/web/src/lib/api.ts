import { z } from 'zod';

/**
 * Standard error-body shape from every `/api/v1/*` route.
 * Matches `docs/api-design.md` §6.
 */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    detail: z.unknown().optional(),
    request_id: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export class ApiFetchError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly detail?: unknown;

  constructor(payload: ApiError, status: number) {
    super(payload.error.message);
    this.status = status;
    this.code = payload.error.code;
    this.requestId = payload.error.request_id;
    this.detail = payload.error.detail;
  }
}

/**
 * Typed internal fetch wrapper. Parses successful responses with a Zod schema
 * and normalises errors to `ApiFetchError`. Use from client components only —
 * server code should talk to Supabase / the engine directly.
 */
export async function apiFetch<TSchema extends z.ZodTypeAny>(
  input: string,
  init: RequestInit | undefined,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    credentials: 'include',
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiFetchError(parsed.data, response.status);
    }
    throw new ApiFetchError(
      {
        error: {
          code: 'internal_error',
          message: 'Unexpected server response.',
          request_id: response.headers.get('x-request-id') ?? 'unknown',
        },
      },
      response.status,
    );
  }

  return schema.parse(body);
}

/**
 * Server-side helper for calling the Python quote-engine. Signs the request
 * with the shared secret header from `docs/api-design.md` §2.3.
 */
export async function quoteEngineFetch<T>(
  path: string,
  body: unknown,
  init?: { signal?: AbortSignal; requestId?: string },
): Promise<T> {
  const url = process.env.QUOTE_ENGINE_URL;
  const secret = process.env.QUOTE_ENGINE_INTERNAL_KEY;
  if (!url || !secret) throw new Error('Quote engine is not configured.');

  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': secret,
      'X-Request-Id': init?.requestId ?? crypto.randomUUID(),
    },
    body: JSON.stringify(body),
    signal: init?.signal,
  });

  if (!response.ok) {
    throw new Error(`Quote engine responded ${response.status}`);
  }

  return (await response.json()) as T;
}
