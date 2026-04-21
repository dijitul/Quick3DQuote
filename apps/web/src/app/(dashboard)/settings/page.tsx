import { SettingsForm } from './settings-form';
import { DangerZone } from './danger-zone';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireShopSession } from '@/lib/auth';

export default async function SettingsPage() {
  const { user, shop } = await requireShopSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Account details and shop defaults. Most of these can be changed later.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm
            initial={{
              email: user.email ?? '',
              timezone: shop?.timezone ?? 'Europe/London',
              country: shop?.country ?? 'GB',
            }}
          />
        </CardContent>
      </Card>

      <Card className="border-error/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <DangerZone />
        </CardContent>
      </Card>
    </div>
  );
}
