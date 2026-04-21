import Link from 'next/link';
import { CheckCircle2, Receipt, ScrollText, Wallet } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { StatCard } from '@/components/stat-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireShopSession } from '@/lib/auth';
import { formatGBP } from '@/lib/utils';

interface QuoteRow {
  id: string;
  status: string;
  customer_email: string | null;
  total: number | null;
  created_at: string;
  material_name: string | null;
  quantity: number | null;
}

export default async function DashboardPage() {
  const { supabase, shop } = await requireShopSession();

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [{ data: quotes, error }, { count: totalQuotes }, { count: paidOrders }] =
    await Promise.all([
      supabase
        .from('quotes')
        .select('id, status, customer_email, total, created_at, material_name, quantity')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since.toISOString()),
      supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'paid')
        .gte('created_at', since.toISOString()),
    ]);

  const revenue = Array.isArray(quotes)
    ? quotes
        .filter((quote) => quote.status === 'paid')
        .reduce((total, quote) => total + Number(quote.total ?? 0), 0)
    : 0;

  const conversion =
    totalQuotes && totalQuotes > 0 ? ((paidOrders ?? 0) / totalQuotes) * 100 : 0;

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Last 30 days across {shop?.brand_name ?? 'your shop'}.
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/quotes">View all quotes</Link>
          </Button>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Quotes this month" value={String(totalQuotes ?? 0)} icon={ScrollText} />
          <StatCard label="Paid orders" value={String(paidOrders ?? 0)} icon={CheckCircle2} />
          <StatCard label="Revenue" value={formatGBP(revenue * 100)} icon={Wallet} />
          <StatCard
            label="Conversion rate"
            value={`${conversion.toFixed(1)}%`}
            icon={Receipt}
          />
        </div>
      </section>

      <section>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent quotes</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/quotes">See all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {error ? (
              <EmptyState
                icon={ScrollText}
                title="Couldn\u2019t load quotes"
                description={error.message}
              />
            ) : !quotes || quotes.length === 0 ? (
              <EmptyState
                icon={ScrollText}
                title="No quotes yet"
                description="Once a customer uploads a file on your site, it\u2019ll appear here. Most shops see their first order within a day of embedding the widget."
                action={
                  <Button asChild>
                    <Link href="/embed">View embed snippet</Link>
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(quotes as QuoteRow[]).map((quote) => (
                    <TableRow key={quote.id}>
                      <TableCell>{quote.customer_email ?? 'Pending'}</TableCell>
                      <TableCell>{quote.material_name ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {quote.quantity ?? 1}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatGBP(Number(quote.total ?? 0) * 100)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={quote.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'paid'
      ? 'success'
      : status === 'in_production'
        ? 'warning'
        : status === 'cancelled'
          ? 'error'
          : status === 'shipped'
            ? 'default'
            : 'info';
  return (
    <Badge tone={tone} dot>
      {status.replaceAll('_', ' ')}
    </Badge>
  );
}
