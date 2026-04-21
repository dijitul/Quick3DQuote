import type { LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' } | null;
  icon?: LucideIcon;
  className?: string;
}

export function StatCard({ label, value, delta, icon: Icon, className }: StatCardProps) {
  return (
    <Card className={cn('p-6', className)}>
      <CardContent className="flex flex-col gap-3 p-0">
        <div className="flex items-center justify-between text-xs uppercase tracking-wider text-neutral-500">
          <span>{label}</span>
          {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
        </div>
        <div className="text-3xl font-bold tabular-nums text-foreground">{value}</div>
        {delta ? (
          <div
            className={cn(
              'text-xs font-medium',
              delta.direction === 'up' && 'text-success',
              delta.direction === 'down' && 'text-error',
              delta.direction === 'flat' && 'text-muted-foreground',
            )}
          >
            {delta.direction === 'up' ? '↑ ' : delta.direction === 'down' ? '↓ ' : '— '}
            {delta.value}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
