'use client';

import * as React from 'react';
import { z } from 'zod';
import { Lock } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { cn } from '@/lib/cn';

/**
 * Contact form + Stripe redirect button.
 *
 * The price shown in the button is only a display — the server re-computes
 * the Stripe line items from the authoritative quote row on checkout.
 */

const ContactSchema = z.object({
  name: z.string().trim().min(1, 'Your name please'),
  email: z.string().trim().email('That email address looks wrong'),
  phone: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || v.replace(/\s/g, '').length >= 7,
      'Too short for a phone number',
    ),
  company: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type ContactForm = z.infer<typeof ContactSchema>;

export interface CheckoutCtaProps {
  totalPence: number;
  currency: 'GBP';
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (form: ContactForm) => void;
  className?: string;
}

export function CheckoutCta({
  totalPence,
  currency,
  disabled,
  loading,
  onSubmit,
  className,
}: CheckoutCtaProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<keyof ContactForm, string>>>(
    {},
  );

  const formatter = React.useMemo(
    () =>
      new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
      }),
    [currency],
  );

  const ctaLabel = loading
    ? 'Redirecting to Stripe…'
    : `Order now — ${formatter.format(totalPence / 100)}`;

  if (!expanded) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <Button
          size="lg"
          full
          disabled={disabled}
          onClick={() => setExpanded(true)}
          loading={loading}
        >
          {ctaLabel}
        </Button>
        <p className="text-xs text-muted-foreground text-center inline-flex items-center justify-center gap-1">
          <Lock className="size-3" aria-hidden="true" /> Secure payment via Stripe
        </p>
      </div>
    );
  }

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const raw = {
      name: String(fd.get('name') ?? ''),
      email: String(fd.get('email') ?? ''),
      phone: String(fd.get('phone') ?? ''),
      company: String(fd.get('company') ?? ''),
      notes: String(fd.get('notes') ?? ''),
    };
    const parsed = ContactSchema.safeParse(raw);
    if (!parsed.success) {
      const next: Partial<Record<keyof ContactForm, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string') {
          next[key as keyof ContactForm] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={handleSubmit} className={cn('flex flex-col gap-3', className)} noValidate>
      <div className="grid grid-cols-1 gap-3 @[480px]:grid-cols-2">
        <Field
          name="name"
          label="Name"
          autoComplete="name"
          required
          error={errors.name}
        />
        <Field
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          error={errors.email}
        />
        <Field
          name="phone"
          label="Phone (optional)"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          error={errors.phone}
          help="We'll only call if there's a question about your print."
        />
        <Field
          name="company"
          label="Company (optional)"
          autoComplete="organization"
          error={errors.company}
        />
      </div>

      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={2000}
          className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-y min-h-[60px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Orientation preferences, tolerance requirements, anything we should know."
        />
      </div>

      <Button type="submit" size="lg" full disabled={disabled} loading={loading}>
        {ctaLabel}
      </Button>
      <p className="text-xs text-muted-foreground text-center inline-flex items-center justify-center gap-1">
        <Lock className="size-3" aria-hidden="true" /> Secure payment via Stripe.
        You won&apos;t be charged until you confirm.
      </p>
    </form>
  );
}

// ---- Field helper ----

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  name: string;
  label: string;
  error?: string;
  help?: string;
}

function Field({ name, label, error, help, required, ...rest }: FieldProps) {
  const errorId = `${name}-error`;
  const helpId = `${name}-help`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>
        {label}
        {required ? <span className="text-error ml-0.5">*</span> : null}
      </Label>
      <Input
        id={name}
        name={name}
        required={required}
        invalid={Boolean(error)}
        aria-describedby={error ? errorId : help ? helpId : undefined}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="text-xs text-error">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}
