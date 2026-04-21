// @ts-check

/**
 * Embed-app Next.js config.
 *
 * Served at embed.quick3dquote.com. The whole point of this app is to be
 * iframed by arbitrary third-party shop sites, so we explicitly:
 *   - allow framing from any origin (CSP `frame-ancestors *`, no X-Frame-Options)
 *   - let /embed.js be cross-origin loadable (CORP: cross-origin)
 *   - keep everything else locked down with nosniff / referrer policy
 *
 * See docs/security.md §10.3 for the full CSP rationale.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  // App Router + typed routes so our internal navigations are typed.
  experimental: {
    typedRoutes: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'meshes.quick3dquote.com' },
    ],
  },
  async headers() {
    // CSP string shared by the widget surface (/ and /success).
    // frame-ancestors * is load-bearing: shops embed us on any site.
    // We do NOT set X-Frame-Options here — it would conflict with frame-ancestors.
    // (Next.js doesn't set XFO by default; middleware strips any that slips in.)
    const widgetCsp = [
      "default-src 'self'",
      // three.js uses eval under some build configs; we keep it tight otherwise.
      // Stripe.js is loaded only on the checkout redirect path (top-level navigation),
      // but we allowlist it defensively in case we inline Stripe Elements later.
      "script-src 'self' 'unsafe-eval' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.r2.cloudflarestorage.com https://api.stripe.com https://*.supabase.co",
      "worker-src 'self' blob:",
      "frame-src https://js.stripe.com https://checkout.stripe.com",
      "frame-ancestors *",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com",
      "object-src 'none'",
    ].join('; ');

    return [
      {
        // Widget pages + API: CSP with frame-ancestors *, no XFO.
        source: '/((?!embed\\.js).*)',
        headers: [
          { key: 'Content-Security-Policy', value: widgetCsp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // /embed.js is the loader script shops paste on their site.
        // It must be fetchable cross-origin and cacheable at the CDN.
        source: '/embed.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=300' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
