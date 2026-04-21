import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/dashboard-shell';
import { requireShopSession } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, shop } = await requireShopSession();
  if (!user.email) redirect('/login');

  const shopName = shop?.brand_name ?? 'Your shop';

  return (
    <DashboardShell shopName={shopName} userEmail={user.email}>
      {children}
    </DashboardShell>
  );
}
