import '@testing-library/jest-dom/vitest';

// Stub Next.js env defaults so `@/lib/env` parses in tests.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://stub.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'stub-anon-key-long-enough-to-pass';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_EMBED_URL ??= 'http://localhost:3001';
