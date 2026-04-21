import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Hand-rolled shadcn-flavoured Button.
 *
 * Mirrors apps/web's Button surface at the level the widget needs. We keep
 * it small on purpose — no asChild/Slot indirection, which would pull in
 * @radix-ui/react-slot for one feature nobody in the widget uses.
 */

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-md font-medium',
    'transition-colors duration-fast ease-settled',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-60',
    'num-tabular',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-accent-500 text-white hover:bg-accent-600 active:bg-accent-700 shadow-1',
        secondary:
          'bg-background border border-border text-foreground hover:bg-neutral-50 dark:hover:bg-neutral-800',
        ghost: 'text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800',
        destructive: 'bg-error text-error-foreground hover:brightness-110',
        link: 'text-accent-600 underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-5 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
      full: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      full: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, full, loading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, full }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span className="sr-only">Loading</span>
          </>
        ) : null}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
