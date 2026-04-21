'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { QuoteResult } from '@/lib/state-machine';

export interface PriceSummaryProps {
  quote: QuoteResult | null;
  loading?: boolean;
  className?: string;
}

/**
 * The big total + expandable breakdown. Price is shown to display only —
 * the server re-computes authoritatively at checkout.
 *
 * Motion: respects prefers-reduced-motion (see globals.css). The digit
 * roll is a CSS animation key'd on the value, cheap and doesn't hold
 * layout thanks to tabular-nums.
 */
export function PriceSummary({ quote, loading, className }: PriceSummaryProps) {
  const [expanded, setExpanded] = React.useState(false);

  const totalPence = quote?.total_pence ?? 0;
  const currency = quote?.currency ?? 'GBP';
  const formatter = React.useMemo(
    () =>
      new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
      }),
    [currency],
  );

  return (
    <div
      className={cn('rounded-md border border-border bg-card p-4', className)}
      aria-live="polite"
      aria-atomic="true"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Total
      </p>
      <p
        key={totalPence}
        className={cn(
          'text-3xl font-bold text-foreground num-tabular mt-1',
          loading && 'opacity-60',
        )}
      >
        {quote ? formatter.format(totalPence / 100) : '—'}
      </p>
      {quote ? (
        <p className="text-xs text-muted-foreground mt-1 num-tabular">
          {formatter.format(quote.unit_price_pence / 100)} each
        </p>
      ) : null}

      {quote && quote.breakdown_lines.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline"
          >
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform duration-fast',
                expanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
            {expanded ? 'Hide breakdown' : 'Show breakdown'}
          </button>
          {expanded ? (
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              {quote.breakdown_lines.map((line) => (
                <React.Fragment key={line.label}>
                  <dt className="text-muted-foreground">{line.label}</dt>
                  <dd className="text-right font-medium num-tabular">
                    {formatter.format(line.amount_pence / 100)}
                  </dd>
                </React.Fragment>
              ))}
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="text-right font-medium num-tabular">
                {formatter.format(quote.subtotal_pence / 100)}
              </dd>
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
