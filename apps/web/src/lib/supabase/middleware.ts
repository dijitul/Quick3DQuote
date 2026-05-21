import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { env } from '@/lib/env';

/**
 * Refreshes the Supabase session cookie on every request. Must be invoked
 * from `src/middleware.ts`. We also apply simple redirect rules:
 *  - Unauthenticated users hitting /dashboard/* → /login
 *  - Authenticated users hitting /login or /signup → /dashboard
 *
 * Tolerant when env vars aren't configured yet — returns the request
 * untouched so the marketing landing page still renders on a fresh deploy.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // First-deploy tolerance: without Supabase env vars there's no session to
  // refresh and no auth to enforce. Let everything through; routes that
  // genuinely need auth will fail at their own usage point with a clear msg.
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/signup');
  const isDashboardRoute =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/quotes') ||
    pathname.startsWith('/materials') ||
    pathname.startsWith('/processes') ||
    pathname.startsWith('/branding') ||
    pathname.startsWith('/embed') ||
    pathname.startsWith('/billing') ||
    pathname.startsWith('/settings');

  if (!user && isDashboardRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
