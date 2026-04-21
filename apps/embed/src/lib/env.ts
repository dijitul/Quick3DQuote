import { z } from 'zod';

/**
 * Environment variables used by the embed app.
 *
 * Server-only values are never marked `NEXT_PUBLIC_*`. Any attempt to
 * reference them from a client component will fail at build time — good.
 *
 * See docs/security.md §1.1 (critical assets) for why this matters: a
 * leaked service_role or R2 secret is a tenant-isolation collapse.
 */

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Supabase (service role is used by the embed API routes because embed
  // customers are unauthenticated; we scope every query by session_token).
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // Cloudflare R2 (S3-compatible API).
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),

  // Quote-engine (Fly.io, HMAC-authed server-to-server).
  QUOTE_ENGINE_URL: z.string().url(),
  QUOTE_ENGINE_INTERNAL_KEY: z.string().min(16),

  // Stripe — we use the platform key to CREATE checkout sessions on a
  // shop's connected account (via `stripe_account` param). See CLAUDE.md §11.3.
  STRIPE_SECRET_KEY: z.string().min(10),
  STRIPE_WEBHOOK_SECRET: z.string().min(10).optional(),

  // Session cookie secret (HMAC for the opaque session_token).
  SESSION_SIGNING_SECRET: z.string().min(32),

  // Public origin of this app — used to build iframe URLs and success URLs.
  NEXT_PUBLIC_EMBED_ORIGIN: z.string().url().default('http://localhost:3001'),
});

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_EMBED_ORIGIN: z.string().url().default('http://localhost:3001'),
});

function parseServerEnv() {
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // In dev we surface the missing vars; in prod we refuse to boot.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid or missing env vars:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Lazy server-env accessor. Throws if called from a client bundle because
 * Next.js strips non-NEXT_PUBLIC values there.
 */
export const serverEnv = new Proxy({} as z.infer<typeof ServerEnvSchema>, {
  get(_target, key: string) {
    const env = parseServerEnv();
    return env[key as keyof typeof env];
  },
});

export const publicEnv = PublicEnvSchema.parse({
  NEXT_PUBLIC_EMBED_ORIGIN: process.env.NEXT_PUBLIC_EMBED_ORIGIN,
});
