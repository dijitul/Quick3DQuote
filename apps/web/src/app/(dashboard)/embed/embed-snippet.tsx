'use client';

import { Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export function EmbedSnippet({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      toast.success('Snippet copied to clipboard.');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Couldn\u2019t copy — try selecting manually.');
    }
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border border-border bg-neutral-900 p-4 text-xs text-neutral-50">
        <code>{snippet}</code>
      </pre>
      <Button
        size="sm"
        variant="secondary"
        className="absolute right-3 top-3"
        onClick={onCopy}
        aria-label="Copy snippet"
      >
        <Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
