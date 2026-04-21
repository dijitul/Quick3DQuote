'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const schema = z.object({
  brandName: z.string().min(1).max(120),
  brandLogoUrl: z
    .string()
    .optional()
    .refine((value) => !value || /^https?:\/\//.test(value), {
      message: 'Must be an https:// URL.',
    }),
  brandAccent: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #6366F1.'),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  initial: FormValues;
}

export function BrandingForm({ initial }: Props) {
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  });

  async function onSubmit(values: FormValues) {
    try {
      const response = await fetch('/api/v1/shop', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_name: values.brandName,
          brand_logo_url: values.brandLogoUrl || null,
          brand_accent: values.brandAccent,
        }),
      });
      if (!response.ok) throw new Error('Save failed.');
      toast.success('Branding saved.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong.');
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
        <FormField
          control={form.control}
          name="brandName"
          render={({ field }) => (
            <FormItem className="md:col-span-2">
              <FormLabel>Shop name</FormLabel>
              <FormControl>
                <Input placeholder="Acme 3D" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="brandLogoUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Logo URL</FormLabel>
              <FormControl>
                <Input placeholder="https://cdn.example.com/logo.svg" {...field} />
              </FormControl>
              <FormDescription>
                Full object upload is coming soon — paste a URL for now.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="brandAccent"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Accent colour</FormLabel>
              <FormControl>
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Accent colour picker"
                    type="color"
                    value={field.value}
                    onChange={field.onChange}
                    className="h-10 w-16 rounded-md border border-border"
                  />
                  <Input {...field} />
                </div>
              </FormControl>
              <FormDescription>
                Used for buttons and selected-state highlights in the widget.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit">Save branding</Button>
        </div>
      </form>
    </Form>
  );
}
