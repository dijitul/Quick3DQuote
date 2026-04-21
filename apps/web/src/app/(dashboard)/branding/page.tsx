import { BrandingForm } from './branding-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireShopSession } from '@/lib/auth';

export default async function BrandingPage() {
  const { shop } = await requireShopSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Branding</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Controls the logo and accent colour your customers see on the widget.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent>
          <BrandingForm
            initial={{
              brandName: shop?.brand_name ?? '',
              brandLogoUrl: shop?.brand_logo_url ?? '',
              brandAccent: shop?.brand_accent ?? '#6366F1',
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
