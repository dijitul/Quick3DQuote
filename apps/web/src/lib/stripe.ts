import Stripe from 'stripe';

import { env } from '@/lib/env';

let cached: Stripe | null = null;

/**
 * Lazily-instantiated singleton Stripe client. We pin the API version so
 * the types stay honest across deploys.
 */
export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured.');
  }

  if (!cached) {
    cached = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-09-30.acacia',
      typescript: true,
      appInfo: {
        name: 'quick3dquote-web',
        version: '0.1.0',
      },
    });
  }

  return cached;
}

/** Plans mapped to their Stripe price IDs. Keep in sync with the pricing page. */
export const PLAN_PRICE_IDS = {
  starter: () => env.STRIPE_PRICE_ID_STARTER,
  pro: () => env.STRIPE_PRICE_ID_PRO,
  scale: () => env.STRIPE_PRICE_ID_SCALE,
} as const;

export type PlanId = keyof typeof PLAN_PRICE_IDS;
