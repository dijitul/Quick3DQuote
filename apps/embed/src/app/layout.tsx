import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * Root layout for the embeddable widget.
 *
 * Deliberately minimal: no header, no footer, no nav — the iframe is
 * the entire surface. The page renders inside a `.q3dq-root` wrapper
 * (see globals.css) that supplies the CSS isolation + container query
 * context the widget relies on.
 */

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  // Self-host via next/font so we don't depend on Google's CDN at runtime.
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Quick3DQuote',
  description: 'Instant 3D printing quote widget.',
  // This page is only ever displayed inside an iframe; no need to index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The widget's colour is controlled per-session; let the browser pick.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#0F172A' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB" className={inter.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
