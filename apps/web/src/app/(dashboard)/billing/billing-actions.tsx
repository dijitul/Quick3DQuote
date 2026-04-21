'use client';

import { ExternalLink, Wallet } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function BillingActions({ connected }: { connected: boolean }) {
  const [isPending, startTransition] = useTransition();

  function openCheckout() {
    startTransition(async () => {
      try {
        const response = await fetch('/api/v1/billing/checkout', { method: 'POST' });
        const json = (await response.json()) as { checkout_url?: string };
        if (!json.checkout_url) throw new Error('Missing checkout URL.');
        window.location.href = json.checkout_url;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Something went wrong.');
      }
    });
  }

  function openPortal() {
    startTransition(async () => {
      try {
        const response = await fetch('/api/v1/billing/portal', { method: 'POST' });
        const json = (await response.json()) as { portal_url?: string };
        if (!json.portal_url) throw new Error('Missing portal URL.');
        window.location.href = json.portal_url;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Something went wrong.');
      }
    });
  }

  function openConnect() {
    startTransition(async () => {
      try {
        const response = await fetch('/api/v1/billing/connect', { method: 'POST' });
        const json = (await response.json()) as { url?: string };
        if (!json.url) throw new Error('Missing Stripe authorise URL.');
        window.location.href = json.url;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Something went wrong.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 md:flex-row md:flex-wrap">
        <Button disabled={isPending} onClick={openCheckout}>
          Start / change subscription
        </Button>
        <Button variant="secondary" disabled={isPending} onClick={openPortal}>
          <ExternalLink className="h-4 w-4" /> Manage billing
        </Button>
        <Button variant="secondary" disabled={isPending} onClick={openConnect}>
          <Wallet className="h-4 w-4" />
          {connected ? 'Re-connect Stripe' : 'Connect my Stripe for customer payments'}
        </Button>
      </CardContent>
    </Card>
  );
}
