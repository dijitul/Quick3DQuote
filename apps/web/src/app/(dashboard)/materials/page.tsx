import { Boxes } from 'lucide-react';

import { MaterialsTable } from './materials-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { requireShopSession } from '@/lib/auth';

export interface Material {
  id: string;
  name: string;
  process_id: string;
  price_per_cm3: number;
  density_g_per_cm3: number;
  colour_hex: string;
  active: boolean;
  sort_order: number;
}

export interface Process {
  id: string;
  type: string;
}

export default async function MaterialsPage() {
  const { supabase } = await requireShopSession();

  const [{ data: materials, error }, { data: processes }] = await Promise.all([
    supabase.from('materials').select('*').order('sort_order', { ascending: true }),
    supabase.from('processes').select('id, type').order('type', { ascending: true }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Materials</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The menu your customers pick from. Prices are per cubic centimetre of material used.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All materials</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <EmptyState icon={Boxes} title="Couldn\u2019t load materials" description={error.message} />
          ) : (
            <MaterialsTable
              materials={(materials ?? []) as Material[]}
              processes={(processes ?? []) as Process[]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
