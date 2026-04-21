'use client';

import * as React from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/cn';
import type { MaterialPublic } from '@/lib/api';

export interface MaterialPanelProps {
  materials: readonly MaterialPublic[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  quantity: number;
  onQuantityChange: (n: number) => void;
  disabled?: boolean;
}

export function MaterialPanel({
  materials,
  selectedId,
  onSelect,
  quantity,
  onQuantityChange,
  disabled,
}: MaterialPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Material
        </p>
        <div
          role="radiogroup"
          aria-label="Material"
          className="grid grid-cols-2 gap-2"
          data-cq-3cols
        >
          {materials.length === 0 ? (
            <p className="col-span-2 text-sm text-muted-foreground">
              This shop hasn&apos;t set up any materials yet.
            </p>
          ) : (
            materials.map((m) => (
              <MaterialCard
                key={m.id}
                material={m}
                selected={m.id === selectedId}
                disabled={disabled}
                onSelect={() => onSelect(m.id)}
              />
            ))
          )}
        </div>
      </div>

      <QuantityStepper
        value={quantity}
        onChange={onQuantityChange}
        disabled={disabled}
      />
    </div>
  );
}

function MaterialCard({
  material,
  selected,
  disabled,
  onSelect,
}: {
  material: MaterialPublic;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  // Pretty price for the card. price_pence_per_cm3 is typically a low-ish
  // integer (e.g. 8 = £0.08/cm³), so we render with 2dp.
  const prettyPrice = `£${(material.price_pence_per_cm3 / 100).toFixed(2)}/cm³`;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'relative text-left rounded-md border bg-card p-3',
        'transition-colors duration-fast ease-settled',
        'flex items-start gap-3',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        selected
          ? 'border-accent-500 border-2 bg-accent-50 dark:bg-accent-500/10'
          : 'border-border hover:border-neutral-300 dark:hover:border-neutral-700',
      )}
    >
      <span
        aria-hidden="true"
        className="size-8 rounded-sm border border-border shrink-0"
        style={{ backgroundColor: material.colour_hex }}
      />
      <span className="flex flex-col min-w-0">
        <span className="text-sm font-medium truncate">{material.name}</span>
        <span className="text-xs text-muted-foreground">
          {material.process_kind}
        </span>
        <span className="text-xs text-muted-foreground mt-0.5 num-tabular">
          {prettyPrice}
        </span>
      </span>
      {selected ? (
        <Check
          className="absolute top-1.5 right-1.5 size-4 text-accent-600"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

function QuantityStepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
        Quantity
      </p>
      <div
        className={cn(
          'inline-flex items-center rounded-md border border-border bg-card',
          'h-10 overflow-hidden',
          disabled && 'opacity-60',
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Decrease quantity"
          disabled={disabled || value <= 1}
          onClick={() => onChange(value - 1)}
          className="rounded-none h-full w-11"
        >
          <Minus className="size-4" aria-hidden="true" />
        </Button>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number.parseInt(draft, 10);
            if (Number.isFinite(n) && n >= 1) onChange(Math.min(1000, n));
            else setDraft(String(value));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="w-16 text-center text-sm font-medium num-tabular bg-transparent focus:outline-none"
          aria-label="Quantity"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Increase quantity"
          disabled={disabled || value >= 1000}
          onClick={() => onChange(value + 1)}
          className="rounded-none h-full w-11"
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
