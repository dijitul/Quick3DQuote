import { z } from 'zod';

/**
 * Zod-validated environment variables.
 *
 * Design note: we **don't throw** at module load even when required vars are
 * missing. Build-time "Collecting page data" instantiates every route handler
 * with whatever env happens to exist, so throwing here breaks deploys that
 * just haven't been configured yet (a CI sanity build, the very first push to
 * Vercel before secrets are added, etc.).
 *
 * Instead, vars that are truly required for an operation are validated where
 * they're consumed: `createSupabaseServerClient()` will throw a clear error
 * if `NEXT_PUBLIC_SUPABASE_URL` is empty, etc. That gives a useful runtime
 * error on the first request after deploy without blocking the build.
 */
const schema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Public URLs (the embed host sits on its own subdomain per CLAUDE.md §11.2)
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_EMBED_URL: z.string().url().default('http://localhost:3001'),

  // Supabase — required at runtime for auth-touching routes; permissive here.
  NEXT_PUBLIC_SUPABASE_URL: z.string().default(''),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),

  // Stripe — optional, only required by billing + webhook routes.
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_ID_STARTER: z.string().default(''),
  STRIPE_PRICE_ID_PRO: z.string().default(''),
  STRIPE_PRICE_ID_SCALE: z.string().default(''),
  STRIPE_CLIENT_ID: z.string().default(''),

  // Cloudflare R2 — only required by upload/download routes.
  R2_ACCOUNT_ID: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_BUCKET_MESHES: z.string().default('q3dq-meshes'),
  R2_PUBLIC_BASE_URL: z.string().default(''),

  // Quote engine (internal service) — only required by pricing routes.
  QUOTE_ENGINE_URL: z.string().default(''),
  QUOTE_ENGINE_INTERNAL_KEY: z.string().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success && typeof window === 'undefined' && process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line no-console
  console.warn(
    '[@q3dq/web] Environment variables failed validation:',
    parsed.error.flatten().fieldErrors,
  );
}

export const env = (parsed.success ? parsed.data : schema.parse({})) as z.infer<typeof schema>;
export type Env = typeof env;

/** Throws if a required env var is missing. Call from the code path that needs it. */
export function requireEnv<K extends keyof Env>(key: K): Exclude<Env[K], ''> {
  const value = env[key];
  if (!value || value === '') {
    throw new Error(
      `Missing required environment variable: ${String(key)}. ` +
        `Set it in Vercel project settings (or .env.local for dev) and redeploy.`,
    );
  }
  return value as Exclude<Env[K], ''>;
}
