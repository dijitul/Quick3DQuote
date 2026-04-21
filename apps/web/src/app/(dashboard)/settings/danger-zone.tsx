'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export function DangerZone() {
  const [isPending, startTransition] = useTransition();

  function onCancel() {
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

  function onDelete() {
    toast.info('Shop deletion is handled manually in v1. Email support to request removal.');
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-medium">Cancel subscription or delete shop</p>
        <p className="text-sm text-muted-foreground">
          Cancellation is handled through the Stripe customer portal. Deletion is a manual
          operation for v1.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={isPending} onClick={onCancel}>
          Cancel subscription
        </Button>
        <Button variant="destructive" disabled={isPending} onClick={onDelete}>
          Delete shop
        </Button>
      </div>
    </div>
  );
}
