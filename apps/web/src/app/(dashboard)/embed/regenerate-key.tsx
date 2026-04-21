'use client';

import { AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function RegenerateKey() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function onConfirm() {
    if (confirm.trim().toUpperCase() !== 'REGENERATE') {
      toast.error('Type REGENERATE to confirm.');
      return;
    }
    startTransition(async () => {
      try {
        const response = await fetch('/api/v1/shop/regenerate-embed-key', { method: 'POST' });
        if (!response.ok) throw new Error('Regenerate failed.');
        toast.success('Embed key rotated. Update your widget snippet.');
        setOpen(false);
        setConfirm('');
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" aria-hidden />
        <div>
          <p className="text-sm font-medium">Regenerate your embed key</p>
          <p className="text-sm text-muted-foreground">
            Instantly invalidates the existing snippet on every site it\u2019s pasted on. Only do
            this if you suspect abuse.
          </p>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm">
            Regenerate key
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate embed key?</DialogTitle>
            <DialogDescription>
              The current snippet will stop working on every site it\u2019s pasted on. Type{' '}
              <span className="font-mono text-foreground">REGENERATE</span> to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirmation</Label>
            <Input
              id="confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="REGENERATE"
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={isPending} onClick={onConfirm}>
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
