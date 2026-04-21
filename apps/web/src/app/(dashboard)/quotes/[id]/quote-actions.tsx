'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  quoteId: string;
  status: string;
  trackingNumber: string;
}

export function QuoteActions({ quoteId, status, trackingNumber }: Props) {
  const router = useRouter();
  const [tracking, setTracking] = useState(trackingNumber);
  const [isPending, startTransition] = useTransition();

  async function patch(body: Record<string, unknown>) {
    const response = await fetch(`/api/v1/quotes/${quoteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(json?.error?.message ?? 'Update failed.');
    }
  }

  function onAction(nextStatus: string) {
    startTransition(async () => {
      try {
        await patch({ status: nextStatus });
        toast.success(`Quote marked ${nextStatus.replaceAll('_', ' ')}.`);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Something went wrong.');
      }
    });
  }

  function onSaveTracking() {
    startTransition(async () => {
      try {
        await patch({ tracking_number: tracking });
        toast.success('Tracking number saved.');
        router.refresh();
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
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={isPending || status === 'paid'}
            onClick={() => onAction('paid')}
          >
            Accept
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={isPending || status === 'in_production'}
            onClick={() => onAction('in_production')}
          >
            Mark in production
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={isPending || status === 'shipped'}
            onClick={() => onAction('shipped')}
          >
            Mark shipped
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending || status === 'cancelled'}
            onClick={() => onAction('cancelled')}
          >
            Cancel
          </Button>
        </div>
        <div className="space-y-1.5 pt-2">
          <Label htmlFor="tracking">Tracking number</Label>
          <div className="flex gap-2">
            <Input
              id="tracking"
              value={tracking}
              onChange={(event) => setTracking(event.target.value)}
              placeholder="e.g. RX123456789GB"
            />
            <Button size="sm" disabled={isPending} onClick={onSaveTracking}>
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
