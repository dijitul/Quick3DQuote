import { BillingActions } from './billing-actions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireShopSession } from '@/lib/auth';

export default async function BillingPage() {
  const { shop } = await requireShopSession();

  const status = shop?.subscription_status ?? 'incomplete';
  const connected = Boolean(shop?.stripe_connected_account_id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your Quick3DQuote subscription and the Stripe account customers pay into.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <Badge tone={toneFor(status)} dot>
              {status.replaceAll('_', ' ')}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Plan</span>
            <span className="text-sm font-medium capitalize">{shop?.plan ?? 'starter'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Customer Stripe payouts</span>
            <Badge tone={connected ? 'success' : 'warning'} dot>
              {connected ? 'Connected' : 'Not connected'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <BillingActions connected={connected} />
    </div>
  );
}

function toneFor(status: string) {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'success' as const;
    case 'past_due':
    case 'unpaid':
      return 'warning' as const;
    case 'canceled':
      return 'error' as const;
    default:
      return 'default' as const;
  }
}
