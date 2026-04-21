import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="flex h-14 items-center border-b border-border bg-card px-6">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-5 w-5 text-accent-500" />
          Quick3DQuote
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
