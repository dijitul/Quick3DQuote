import { z } from 'zod';

/**
 * Zod-validated environment variables.
 * Any code that imports `env` will throw at module load if the process is
 * mis-configured, which is what we want.
 */
const serverSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Public URLs (the embed host sits on its own subdomain per CLAUDE.md §11.2)
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_EMBED_URL: z.string().url().default('http://localhost:3001'),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_ID_STARTER: z.string().min(1).optional(),
  STRIPE_PRICE_ID_PRO: z.string().min(1).optional(),
  STRIPE_PRICE_ID_SCALE: z.string().min(1).optional(),
  STRIPE_CLIENT_ID: z.string().min(1).optional(),

  // Cloudflare R2
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_MESHES: z.string().min(1).default('q3dq-meshes'),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),

  // Quote engine (internal service)
  QUOTE_ENGINE_URL: z.string().url().optional(),
  QUOTE_ENGINE_INTERNAL_KEY: z.string().min(1).optional(),
});

// On the browser `process.env` is populated only with NEXT_PUBLIC_* keys, so
// we parse permissively client-side to avoid unnecessary build-time failures.
const parsed =
  typeof window === 'undefined'
    ? serverSchema.safeParse(process.env)
    : serverSchema.partial().safeParse(process.env);

if (!parsed.success && typeof window === 'undefined') {
  // eslint-disable-next-line no-console
  console.error(
    '[@q3dq/web] Invalid environment variables:',
    parsed.error.flatten().fieldErrors,
  );
  throw new Error('Invalid environment variables — see logs above.');
}

export const env = (parsed.success ? parsed.data : {}) as z.infer<typeof serverSchema>;
export type Env = typeof env;
