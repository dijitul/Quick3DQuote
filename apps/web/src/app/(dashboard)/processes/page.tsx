import { Cog } from 'lucide-react';

import { ProcessEditor } from './process-editor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { requireShopSession } from '@/lib/auth';

export interface Process {
  id: string;
  type: string;
  hourly_rate: number;
  setup_fee: number;
  min_order: number;
  markup_pct: number;
  turnaround_days: number;
  throughput_cm3_per_hour: number;
  active: boolean;
}

export default async function ProcessesPage() {
  const { supabase } = await requireShopSession();
  const { data, error } = await supabase.from('processes').select('*').order('type');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Processes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          FDM and SLA defaults. Tune them to match the economics of your shop.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <EmptyState icon={Cog} title="Couldn\u2019t load processes" description={error.message} />
          ) : !data || data.length === 0 ? (
            <EmptyState
              icon={Cog}
              title="No processes yet"
              description="Onboarding will seed FDM + SLA defaults. Add them in the database or via API to get started."
            />
          ) : (
            <div className="space-y-8">
              {(data as Process[]).map((process) => (
                <ProcessEditor key={process.id} process={process} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
