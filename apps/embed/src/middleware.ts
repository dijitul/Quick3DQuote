import { NextResponse, type NextRequest } from 'next/server';

/**
 * Embed middleware.
 *
 * Two jobs:
 *   1. Make sure no X-Frame-Options header slips through on widget routes.
 *      Some layers (Vercel, CDNs, a future lazy refactor) might helpfully
 *      add `X-Frame-Options: DENY` which would break the product entirely.
 *      We strip it here and assert frame-ancestors via CSP instead.
 *   2. Enforce the widget CSP on the routes it applies to. next.config.mjs
 *      already sets it via `async headers()`, but we double up here for
 *      any path rewrites or preview/dev scenarios where static headers
 *      don't run (API routes under edge dev, preview-mode etc.).
 *
 * We only touch widget routes: / and /success. The /embed.js route is
 * intentionally excluded — it's a JavaScript file, not a framed document,
 * and has its own cross-origin headers set in next.config.mjs.
 */

const WIDGET_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.r2.cloudflarestorage.com https://api.stripe.com https://*.supabase.co",
  "worker-src 'self' blob:",
  "frame-src https://js.stripe.com https://checkout.stripe.com",
  'frame-ancestors *',
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "object-src 'none'",
].join('; ');

function isWidgetRoute(pathname: string): boolean {
  if (pathname.startsWith('/api')) return false;
  if (pathname.startsWith('/_next')) return false;
  if (pathname === '/embed.js' || pathname.startsWith('/embed.js/')) return false;
  return true;
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  if (isWidgetRoute(pathname)) {
    // Strip any XFO set upstream — it is incompatible with frame-ancestors.
    res.headers.delete('X-Frame-Options');
    res.headers.set('Content-Security-Policy', WIDGET_CSP);
  }

  return res;
}

export const config = {
  // Run on everything except static assets and the /embed.js route (which
  // has its own headers). We exclude _next/static and favicons to keep the
  // edge hop cheap.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|embed\\.js).*)',
  ],
};
