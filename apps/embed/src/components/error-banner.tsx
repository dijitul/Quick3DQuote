import { AlertTriangle, RefreshCcw, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'error' | 'warning';

export interface ErrorBannerProps {
  title: string;
  message?: string;
  tone?: Tone;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Inline banner for mid-flow errors. Respects UX rule #5: errors are part
 * of the flow. We keep this persistent until the user resolves it or
 * acknowledges it.
 */
export function ErrorBanner({
  title,
  message,
  tone = 'error',
  onRetry,
  onDismiss,
  className,
}: ErrorBannerProps) {
  const palette =
    tone === 'error'
      ? 'bg-error-tint border-l-error text-[#7F1D1D] dark:text-red-200'
      : 'bg-warning-tint border-l-warning text-[#78350F] dark:text-amber-200';

  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border-l-4 px-4 py-3 flex items-start gap-3',
        palette,
        className,
      )}
    >
      <AlertTriangle
        className={cn(
          'size-5 mt-0.5 shrink-0',
          tone === 'error' ? 'text-error' : 'text-warning',
        )}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {message ? <p className="text-sm mt-0.5 opacity-90">{message}</p> : null}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-2 hover:underline"
          >
            <RefreshCcw className="size-3.5" aria-hidden="true" />
            Try again
          </button>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="opacity-70 hover:opacity-100 transition-opacity"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
