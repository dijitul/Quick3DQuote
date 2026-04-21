import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';

import { QuoteActions } from './quote-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { requireShopSession } from '@/lib/auth';
import { env } from '@/lib/env';
import { presignDownload } from '@/lib/r2';
import { formatGBP } from '@/lib/utils';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface QuoteDetail {
  id: string;
  status: string;
  customer_email: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  material_name: string | null;
  process_name: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
  total: number;
  currency: string;
  mesh_r2_key: string | null;
  mesh_filename: string | null;
  mesh_volume_cm3: number | null;
  mesh_bbox_x: number | null;
  mesh_bbox_y: number | null;
  mesh_bbox_z: number | null;
  stripe_payment_intent_id: string | null;
  tracking_number: string | null;
  created_at: string;
}

export default async function QuoteDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { supabase } = await requireShopSession();

  const { data, error } = await supabase.from('quotes').select('*').eq('id', id).maybeSingle();
  if (error || !data) notFound();
  const quote = data as QuoteDetail;

  let downloadUrl: string | null = null;
  if (quote.mesh_r2_key) {
    try {
      downloadUrl = await presignDownload(quote.mesh_r2_key);
    } catch {
      downloadUrl = null;
    }
  }

  const embedUrl = `${env.NEXT_PUBLIC_EMBED_URL}/preview/${quote.id}`;

  return (
    <div className="space-y-6">
      <Link
        href="/quotes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All quotes
      </Link>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Quote {quote.id.slice(0, 8)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Received {new Date(quote.created_at).toLocaleString('en-GB')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={toneForStatus(quote.status)} dot>
            {quote.status.replaceAll('_', ' ')}
          </Badge>
          {downloadUrl ? (
            <Button asChild variant="secondary" size="sm">
              <a href={downloadUrl} download>
                <Download className="h-4 w-4" /> Download mesh
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>3D preview</CardTitle>
          </CardHeader>
          <CardContent>
            <iframe
              title={`Quote ${quote.id} preview`}
              src={embedUrl}
              className="aspect-[4/3] w-full rounded-md border border-border bg-neutral-100 dark:bg-neutral-800"
            />
            {quote.mesh_volume_cm3 !== null && quote.mesh_bbox_x !== null ? (
              <p className="mt-4 text-xs text-muted-foreground tabular-nums">
                {quote.mesh_bbox_x?.toFixed(1)} × {quote.mesh_bbox_y?.toFixed(1)} ×{' '}
                {quote.mesh_bbox_z?.toFixed(1)} mm · {quote.mesh_volume_cm3?.toFixed(2)} cm³
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{quote.customer_name ?? 'Anonymous'}</p>
              <p className="text-muted-foreground">{quote.customer_email ?? '—'}</p>
              <p className="text-muted-foreground">{quote.customer_phone ?? '—'}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Material" value={quote.material_name ?? '—'} />
              <Row label="Process" value={quote.process_name ?? '—'} />
              <Row label="Quantity" value={String(quote.quantity)} />
              <Row label="File" value={quote.mesh_filename ?? '—'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pricing breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row
                label="Unit price"
                value={formatGBP(Number(quote.unit_price ?? 0) * 100)}
              />
              <Row label="Subtotal" value={formatGBP(Number(quote.subtotal ?? 0) * 100)} />
              <Separator className="my-2" />
              <Row
                label={<span className="font-semibold">Grand total</span>}
                value={
                  <span className="text-lg font-bold">
                    {formatGBP(Number(quote.total ?? 0) * 100)}
                  </span>
                }
              />
              {quote.stripe_payment_intent_id ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  Stripe payment intent: {quote.stripe_payment_intent_id}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <QuoteActions
            quoteId={quote.id}
            status={quote.status}
            trackingNumber={quote.tracking_number ?? ''}
          />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
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
