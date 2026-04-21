'use client';

import * as React from 'react';
import { ErrorBanner } from './error-banner';
import { cn } from '@/lib/cn';
import type { ShopBranding } from '@/lib/api';

/**
 * Outer container for the widget.
 *
 * Responsible for:
 *   - Rendering the shop's branded header (logo + name) + our footer wordmark.
 *   - Applying the shop's accent colour as a CSS variable override.
 *   - Catching unrecoverable render errors below it.
 *   - Providing the CSS-container-query context the inner layout relies on.
 */

interface WidgetShellProps {
  branding: ShopBranding | null;
  children: React.ReactNode;
}

export function WidgetShell({ branding, children }: WidgetShellProps) {
  const accent = branding?.accent_colour ?? '#6366F1';
  // Pass accent to the tree as a CSS variable. We patch --primary and the
  // `accent-500/600/700` CTAs in one place — the rest of the design system
  // stays on our fixed neutrals and semantics (design-system.md §8.2).
  const styleVars = React.useMemo<React.CSSProperties>(
    () =>
      ({
        // Only the high-leverage indigo steps get patched.
        '--accent-500': accent,
      }) as React.CSSProperties,
    [accent],
  );

  return (
    <ErrorBoundary>
      <div
        className={cn(
          'q3dq-root',
          'mx-auto w-full max-w-[960px] min-w-[320px]',
          'bg-background text-foreground',
          'border border-border rounded-lg shadow-1',
          'flex flex-col',
        )}
        style={styleVars}
      >
        <Header branding={branding} />
        <div className="flex-1">{children}</div>
        <Footer />
      </div>
    </ErrorBoundary>
  );
}

function Header({ branding }: { branding: ShopBranding | null }) {
  return (
    <header className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2.5 min-w-0">
        {branding?.logo_url ? (
          <img
            src={branding.logo_url}
            alt={`${branding.name} logo`}
            className="h-6 w-auto max-w-[140px] object-contain"
            loading="eager"
          />
        ) : (
          <div
            className="size-6 rounded-sm bg-accent-500 text-white text-xs font-semibold grid place-items-center shrink-0"
            aria-hidden="true"
          >
            {(branding?.name ?? 'Q').charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-medium truncate">
          {branding?.name ?? 'Quick3DQuote'}
        </span>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        Powered by{' '}
        <a
          href="https://quick3dquote.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline underline-offset-2"
        >
          Quick3DQuote
        </a>
      </span>
    </header>
  );
}

function Footer() {
  return (
    <footer className="px-4 py-2 border-t border-border text-xs text-muted-foreground text-center">
      <span className="inline-flex items-center gap-1">
        Secure payment via{' '}
        <a
          href="https://stripe.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline underline-offset-2"
        >
          Stripe
        </a>
      </span>
    </footer>
  );
}

// ----- Error boundary -----

interface ErrorBoundaryState {
  hasError: boolean;
  message: string | null;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { hasError: true, message };
  }

  override componentDidCatch(err: unknown): void {
    // eslint-disable-next-line no-console
    console.error('[q3dq] widget render crashed:', err);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="q3dq-root p-4">
          <ErrorBanner
            title="Something went wrong with the quoter."
            message={
              this.state.message
                ? `(${this.state.message})`
                : 'Refresh the page to try again.'
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}
