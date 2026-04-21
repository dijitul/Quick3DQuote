import { cn } from '@/lib/cn';

export interface LoadingShimmerProps {
  className?: string;
  /** Accessible description for screen readers. Defaults to "Loading". */
  label?: string;
}

/**
 * Animated placeholder block. Reduced-motion users get a static neutral
 * block (disabled via the @media rule in globals.css).
 */
export function LoadingShimmer({ className, label = 'Loading' }: LoadingShimmerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn('shimmer rounded-md', className)}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}
