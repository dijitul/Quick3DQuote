import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The marketing page doesn't depend on Supabase, but Next font imports are
// tricky in a non-Next runtime. We stub `next/font/google` just in case.
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-inter', className: 'inter' }),
}));

import LandingPage from './page';

describe('Marketing landing', () => {
  it('renders the hero headline', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', { name: /instant 3d-printing quotes/i, level: 1 }),
    ).toBeInTheDocument();
  });

  it('shows all three plan tiers', () => {
    render(<LandingPage />);
    expect(screen.getByText(/starter/i)).toBeInTheDocument();
    expect(screen.getByText(/^pro$/i)).toBeInTheDocument();
    expect(screen.getByText(/scale/i)).toBeInTheDocument();
  });
});
