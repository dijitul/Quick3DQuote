'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import type { Process } from './page';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const schema = z.object({
  hourly_rate: z.coerce.number().nonnegative(),
  setup_fee: z.coerce.number().nonnegative(),
  min_order: z.coerce.number().nonnegative(),
  markup_pct: z.coerce.number().min(0).max(500),
  turnaround_days: z.coerce.number().int().min(1).max(60),
  throughput_cm3_per_hour: z.coerce.number().positive(),
});

type FormValues = z.infer<typeof schema>;

export function ProcessEditor({ process }: { process: Process }) {
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      hourly_rate: Number(process.hourly_rate),
      setup_fee: Number(process.setup_fee),
      min_order: Number(process.min_order),
      markup_pct: Number(process.markup_pct),
      turnaround_days: Number(process.turnaround_days),
      throughput_cm3_per_hour: Number(process.throughput_cm3_per_hour),
    },
  });

  async function onSubmit(values: FormValues) {
    try {
      const response = await fetch(`/api/v1/processes/${process.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error('Save failed.');
      toast.success(`${process.type} settings saved.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong.');
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">{process.type}</h3>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-3">
          <NumberField form={form} name="hourly_rate" label="Hourly rate (£)" step="0.5" />
          <NumberField form={form} name="setup_fee" label="Setup fee (£)" step="0.5" />
          <NumberField form={form} name="min_order" label="Minimum order (£)" step="0.5" />
          <NumberField form={form} name="markup_pct" label="Markup (%)" step="1" />
          <NumberField form={form} name="turnaround_days" label="Turnaround (days)" step="1" />
          <NumberField
            form={form}
            name="throughput_cm3_per_hour"
            label="Throughput (cm³/hr)"
            step="0.5"
          />
          <div className="md:col-span-3 flex justify-end">
            <Button type="submit" size="sm">
              Save {process.type}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

function NumberField({
  form,
  name,
  label,
  step,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  name: keyof FormValues;
  label: string;
  step: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type="number" step={step} min={0} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
