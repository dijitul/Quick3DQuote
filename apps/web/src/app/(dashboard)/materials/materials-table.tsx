'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Boxes, Pencil, Plus, Trash2 } from 'lucide-react';

import type { Material, Process } from './page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const materialSchema = z.object({
  name: z.string().min(1, 'Name is required.').max(80),
  process_id: z.string().uuid('Pick a process.'),
  price_per_cm3: z.coerce.number().positive('Price must be greater than zero.'),
  density_g_per_cm3: z.coerce.number().positive('Density must be greater than zero.'),
  colour_hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Hex must be like #112233.')
    .default('#1E1E1E'),
  active: z.boolean().default(true),
});

type MaterialFormValues = z.infer<typeof materialSchema>;

interface Props {
  materials: Material[];
  processes: Process[];
}

export function MaterialsTable({ materials, processes }: Props) {
  const [editing, setEditing] = useState<Material | null>(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onDelete(id: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/v1/materials/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Delete failed.');
        toast.success('Material deleted.');
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" /> New material
            </Button>
          </DialogTrigger>
          <DialogContent>
            <MaterialForm
              processes={processes}
              onDone={() => {
                setCreating(false);
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {materials.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No materials yet"
          description="Add your first material to start quoting customer uploads."
          action={
            <Button onClick={() => setCreating(true)} size="sm">
              <Plus className="h-4 w-4" /> New material
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Swatch</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Process</TableHead>
              <TableHead className="text-right">£/cm³</TableHead>
              <TableHead className="text-right">Density</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {materials.map((material) => {
              const process = processes.find((item) => item.id === material.process_id);
              return (
                <TableRow key={material.id}>
                  <TableCell>
                    <span
                      aria-hidden
                      className="block h-6 w-6 rounded-sm border border-border"
                      style={{ backgroundColor: material.colour_hex }}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{material.name}</TableCell>
                  <TableCell>{process?.type ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    £{Number(material.price_per_cm3).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(material.density_g_per_cm3).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Badge tone={material.active ? 'success' : 'default'} dot>
                      {material.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Dialog
                        open={editing?.id === material.id}
                        onOpenChange={(open) => setEditing(open ? material : null)}
                      >
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="sm" aria-label="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <MaterialForm
                            processes={processes}
                            material={material}
                            onDone={() => {
                              setEditing(null);
                              router.refresh();
                            }}
                          />
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Delete"
                        disabled={isPending}
                        onClick={() => onDelete(material.id)}
                        className="text-error hover:bg-error-tint"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function MaterialForm({
  material,
  processes,
  onDone,
}: {
  material?: Material;
  processes: Process[];
  onDone: () => void;
}) {
  const form = useForm<MaterialFormValues>({
    resolver: zodResolver(materialSchema),
    defaultValues: {
      name: material?.name ?? '',
      process_id: material?.process_id ?? processes[0]?.id ?? '',
      price_per_cm3: Number(material?.price_per_cm3 ?? 0.08),
      density_g_per_cm3: Number(material?.density_g_per_cm3 ?? 1.24),
      colour_hex: material?.colour_hex ?? '#1E1E1E',
      active: material?.active ?? true,
    },
  });

  async function onSubmit(values: MaterialFormValues) {
    try {
      const url = material ? `/api/v1/materials/${material.id}` : '/api/v1/materials';
      const method = material ? 'PATCH' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? 'Save failed.');
      }
      toast.success(material ? 'Material updated.' : 'Material created.');
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong.');
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{material ? 'Edit material' : 'New material'}</DialogTitle>
        <DialogDescription>
          These values feed straight into the customer-facing price.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="PLA Black" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="process_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Process</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a process" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {processes.map((process) => (
                      <SelectItem key={process.id} value={process.id}>
                        {process.type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="price_per_cm3"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>£/cm³</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min={0} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="density_g_per_cm3"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Density (g/cm³)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min={0} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="colour_hex"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Colour</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Colour picker"
                      value={field.value}
                      onChange={field.onChange}
                      className="h-10 w-16 rounded-md border border-border"
                    />
                    <Input value={field.value} onChange={field.onChange} placeholder="#1E1E1E" />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="active"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <FormLabel>Active</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Inactive materials disappear from the customer widget.
                  </p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
          <DialogFooter>
            <Button type="submit">{material ? 'Save changes' : 'Create material'}</Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}
