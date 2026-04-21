import Link from 'next/link';
import { ScrollText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'paid', label: 'Paid' },
  { id: 'in_production', label: 'In production' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;

const DEFAULT_LIMIT = 25;

interface PageProps {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}

export default async function QuotesPage({ searchParams }: PageProps) {
  const { supabase } = await requireShopSession();
  const params = await searchParams;

  const status = params.status ?? 'all';
  const cursor = params.cursor ?? null;

  let query = supabase
    .from('quotes')
    .select('id, status, customer_email, total, created_at, material_name, quantity')
    .order('created_at', { ascending: false })
    .limit(DEFAULT_LIMIT);

  if (status !== 'all') {
    query = query.eq('status', status);
  }
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      query = query.lt('created_at', decoded.createdAt);
    }
  }

  const { data, error } = await query;

  const rows = (data ?? []) as QuoteRow[];
  const nextCursor =
    rows.length === DEFAULT_LIMIT
      ? encodeCursor({ createdAt: rows[rows.length - 1]!.created_at })
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Quotes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything a customer has submitted through your widget.
        </p>
      </div>

      <Tabs value={status}>
        <TabsList>
          {STATUSES.map((option) => (
            <TabsTrigger key={option.id} value={option.id} asChild>
              <Link
                href={option.id === 'all' ? '/quotes' : `/quotes?status=${option.id}`}
                prefetch={false}
              >
                {option.label}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <EmptyState
              icon={ScrollText}
              title="Couldn\u2019t load quotes"
              description={error.message}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No quotes here yet"
              description="Try a different filter, or share your widget link with a test customer."
              action={
                <Button asChild>
                  <Link href="/embed">View embed snippet</Link>
                </Button>
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((quote) => (
                    <TableRow
                      key={quote.id}
                      className="cursor-pointer"
                      onClick={undefined /* navigation via Link wrapper below */}
                    >
                      <TableCell>
                        <Link href={`/quotes/${quote.id}`} className="font-medium">
                          {new Date(quote.created_at).toLocaleDateString('en-GB')}
                        </Link>
                      </TableCell>
                      <TableCell>{quote.customer_email ?? 'Pending'}</TableCell>
                      <TableCell>{quote.material_name ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {quote.quantity ?? 1}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatGBP(Number(quote.total ?? 0) * 100)}
                      </TableCell>
                      <TableCell>
                        <Badge tone={toneForStatus(quote.status)} dot>
                          {quote.status.replaceAll('_', ' ')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {nextCursor ? (
                <div className="mt-4 flex justify-end">
                  <Button asChild variant="secondary" size="sm">
                    <Link
                      href={`/quotes?${new URLSearchParams({
                        status,
                        cursor: nextCursor,
                      }).toString()}`}
                    >
                      Load more
                    </Link>
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function toneForStatus(status: string) {
  switch (status) {
    case 'paid':
      return 'success' as const;
    case 'in_production':
      return 'warning' as const;
    case 'shipped':
      return 'default' as const;
    case 'cancelled':
      return 'error' as const;
    default:
      return 'info' as const;
  }
}

function encodeCursor(input: { createdAt: string }) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function decodeCursor(input: string): { createdAt: string } | null {
  try {
    const json = Buffer.from(input, 'base64url').toString('utf8');
    return JSON.parse(json) as { createdAt: string };
  } catch {
    return null;
  }
}
