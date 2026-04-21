import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/**
 * Uniform API error helpers. Keep response bodies in the shape defined in
 * `docs/api-design.md` §6.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    detail?: unknown;
    request_id: string;
  };
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  opts?: { detail?: unknown; requestId?: string },
) {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      detail: opts?.detail,
      request_id: opts?.requestId ?? crypto.randomUUID(),
    },
  };
  return NextResponse.json(body, { status });
}

export function handleZodError(error: ZodError, requestId?: string) {
  return jsonError(400, 'validation_error', 'One or more fields are invalid.', {
    detail: error.flatten(),
    requestId,
  });
}

export function handleUnknownError(error: unknown, requestId?: string) {
  if (error instanceof ZodError) return handleZodError(error, requestId);
  // eslint-disable-next-line no-console
  console.error('[api] unhandled error', error);
  return jsonError(500, 'internal_error', 'Something went wrong.', { requestId });
}

export function unauthorised(requestId?: string) {
  return jsonError(401, 'unauthorized', 'Authentication required.', { requestId });
}
