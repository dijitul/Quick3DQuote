'use client';

import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from 'next-themes';

/** Wrapper around sonner so we inherit the user's theme automatically. */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <SonnerToaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group rounded-md border border-border bg-card text-card-foreground shadow-2 text-sm',
          description: 'text-muted-foreground',
          actionButton: 'bg-accent-500 text-white',
          cancelButton: 'bg-neutral-100 text-neutral-700',
        },
      }}
    />
  );
}
