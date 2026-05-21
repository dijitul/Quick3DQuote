import { NextResponse, type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (error) {
    // Middleware must never 500. Log and let the request through; downstream
    // routes will handle their own auth checks and surface a sensible UI error.
    // eslint-disable-next-line no-console
    console.error('[middleware] updateSession failed:', error);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    /*
     * Skip static assets, image optimisation, favicons, and the public
     * marketing landing page. We still refresh the Supabase session on every
     * matched route — this keeps the cookie alive while the user browses.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
