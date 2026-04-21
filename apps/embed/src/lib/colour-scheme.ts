/**
 * Host-aware colour-scheme detection for the embedded widget.
 *
 * The widget has no visibility into the host page's CSS, and the iframe's
 * `prefers-color-scheme` inherits the *browser's* preference rather than
 * the host site's actual theme. Neither signal is what we want.
 *
 * Strategy (per docs/design-system.md §2.4):
 *   1. The host's embed.js can pass `?scheme=light|dark` on the iframe URL
 *      after sampling the host <body> computed background luminance.
 *   2. If absent, we fall back to `prefers-color-scheme` via matchMedia.
 *   3. Shops can force a mode via `?forceScheme=` (shop setting).
 *
 * This module is pure — it just tells the caller which class to put on
 * <html>. Applying it is the page's job (so we avoid an extra client-side
 * flash of wrong theme).
 */

export type Scheme = 'light' | 'dark';

export function pickSchemeFromQuery(search: URLSearchParams): Scheme | null {
  const forced = search.get('forceScheme');
  if (forced === 'light' || forced === 'dark') return forced;
  const hint = search.get('scheme');
  if (hint === 'light' || hint === 'dark') return hint;
  return null;
}

export function pickSchemeFromPreference(): Scheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Convert a CSS color() / rgb()/hex string to relative luminance per WCAG.
 * Used by embed.js on the host side; re-exported here for tests and for
 * a server-side rendered fallback if we ever hydrate with a known scheme.
 */
export function luminance(rgb: { r: number; g: number; b: number }): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Darker than mid-grey → dark mode. The 0.35 threshold matches design-system.md §2.4. */
export function schemeFromLuminance(l: number): Scheme {
  return l < 0.35 ? 'dark' : 'light';
}

/**
 * Apply a scheme to <html>. Safe to call repeatedly; idempotent.
 * Call this from a layout effect, not render, or Next.js will warn about
 * hydration mismatch.
 */
export function applyScheme(scheme: Scheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', scheme === 'dark');
  root.setAttribute('data-scheme', scheme);
}
