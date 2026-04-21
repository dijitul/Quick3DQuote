'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { WidgetShell } from '@/components/widget-shell';
import { LoadingShimmer } from '@/components/loading-shimmer';
import { ErrorBanner } from '@/components/error-banner';
import { api, ApiError, type ShopBranding, type QuoteResponse } from '@/lib/api';
import { track } from '@/lib/telemetry';

/**
 * Post-Stripe success page.
 *
 * We arrive here via `success_url` on the Stripe Checkout Session. The
 * quote id is on the query string; webhook should have already flipped
 * status to `paid` by the time this loads, but we're polite and handle
 * the slight race by just showing a "We'll email you" message either way.
 */

export default function SuccessPage() {
  const search = useSearchParams();
  const quoteId = search.get('qid');
  const embedKey = search.get('key');

  const [branding, setBranding] = React.useState<ShopBranding | null>(null);
  const [quote, setQuote] = React.useState<QuoteResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!embedKey || !quoteId) {
        setError('Missing order reference.');
        return;
      }
      try {
        const session = await api.createSession(embedKey, document.referrer || null);
        if (cancelled) return;
        setBranding(session.shop);
        const q = await api.getQuote(embedKey, quoteId);
        if (cancelled) return;
        setQuote(q);
        track('checkout_completed', { price_pence: q.pricing.total_pence });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiError ? err.message : 'Could not load your order.';
        setError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embedKey, quoteId]);

  return (
    <div className="q3dq-root p-4">
      <WidgetShell branding={branding}>
        <div className="p-6 md:p-10 text-center flex flex-col items-center gap-4">
          {error ? (
            <ErrorBanner title="We couldn't fetch your order." message={error} />
          ) : !quote ? (
            <div className="w-full max-w-sm space-y-3">
              <LoadingShimmer className="h-12 w-12 mx-auto rounded-full" />
              <LoadingShimmer className="h-6 w-3/4 mx-auto" />
              <LoadingShimmer className="h-4 w-1/2 mx-auto" />
            </div>
          ) : (
            <>
              <div className="size-14 rounded-full bg-success/10 grid place-items-center">
                <CheckCircle2
                  className="size-8 text-success"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </div>
              <h1 className="text-2xl font-bold">Order placed. Thank you.</h1>
              <p className="text-sm text-muted-foreground max-w-md">
                {branding?.name ? (
                  <>
                    We&apos;ve passed your order to <strong>{branding.name}</strong>.
                    You&apos;ll receive a confirmation email shortly, and{' '}
                    {branding.name} will be in touch about your print.
                  </>
                ) : (
                  <>
                    We&apos;ve passed your order to the print shop. You&apos;ll
                    receive a confirmation email shortly.
                  </>
                )}
              </p>
              <div className="rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium">
                Order reference:{' '}
                <span className="num-tabular">{quote.id.slice(0, 8).toUpperCase()}</span>
              </div>
              <a
                href="/"
                className="text-sm text-accent-600 hover:underline underline-offset-2"
              >
                Upload another file
              </a>
            </>
          )}
        </div>
      </WidgetShell>
    </div>
  );
}
