'use client';

import * as React from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileWarning, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './ui/button';

/**
 * Drag-drop uploader for STL/OBJ/3MF meshes.
 *
 * UX rules obeyed:
 *   - Customers don't know what an STL is — copy says "3D file" first,
 *     extensions are secondary.
 *   - Errors stay inline and offer retry rather than kicking back to idle.
 *   - Progress is determinate (real XHR upload progress) during upload.
 *   - Max 100MB per docs/security.md §3.3 — enforced client-side for UX
 *     (server enforces it for real via the presigned URL).
 */

export type UploadStatus = 'idle' | 'uploading' | 'error';

export interface UploadDropzoneProps {
  status: UploadStatus;
  progress: number; // 0..100
  error?: string | null;
  supportedFormats: readonly ('stl' | 'obj' | '3mf')[];
  maxBytes: number;
  /** Called once a file is selected and preliminary client-side checks pass. */
  onFile: (file: File) => void;
  onRetry?: () => void;
  className?: string;
}

const ACCEPT_BY_EXT: Record<string, string[]> = {
  'model/stl': ['.stl'],
  'model/obj': ['.obj'],
  'model/3mf': ['.3mf'],
  // Android browsers sometimes reject .stl/.obj at the accept= stage;
  // fall back to generic binary so the OS picker shows the file.
  'application/octet-stream': ['.stl', '.obj', '.3mf'],
};

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
}

export function UploadDropzone({
  status,
  progress,
  error,
  supportedFormats,
  maxBytes,
  onFile,
  onRetry,
  className,
}: UploadDropzoneProps) {
  const [localError, setLocalError] = React.useState<string | null>(null);

  const accept = React.useMemo(() => {
    const exts = new Set(supportedFormats.map((f) => `.${f}`));
    const map: Record<string, string[]> = {};
    for (const [mime, list] of Object.entries(ACCEPT_BY_EXT)) {
      const filtered = list.filter((ext) => exts.has(ext));
      if (filtered.length) map[mime] = filtered;
    }
    return map;
  }, [supportedFormats]);

  const validate = React.useCallback(
    (file: File): string | null => {
      if (file.size > maxBytes) {
        return `That file's ${formatMb(file.size)} — our limit is ${formatMb(maxBytes)}. Try decimating the mesh in Blender or your slicer.`;
      }
      const ext = file.name.toLowerCase().split('.').pop() ?? '';
      if (!supportedFormats.includes(ext as 'stl' | 'obj' | '3mf')) {
        return `We support ${supportedFormats.map((s) => s.toUpperCase()).join(', ')} files. That looks like a .${ext} — can you re-export?`;
      }
      return null;
    },
    [maxBytes, supportedFormats],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } =
    useDropzone({
      accept,
      maxFiles: 1,
      multiple: false,
      noClick: status !== 'idle',
      disabled: status === 'uploading',
      onDropAccepted: (files) => {
        const file = files[0];
        if (!file) return;
        const err = validate(file);
        if (err) {
          setLocalError(err);
          return;
        }
        setLocalError(null);
        onFile(file);
      },
      onDropRejected: () => {
        setLocalError(
          `We support ${supportedFormats.map((s) => s.toUpperCase()).join(', ')} files, up to ${formatMb(maxBytes)}.`,
        );
      },
    });

  // ---------- Uploading state ----------
  if (status === 'uploading') {
    return (
      <div
        className={cn(
          'rounded-lg border border-border bg-card p-6',
          'flex flex-col items-center gap-3',
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">Uploading your file…</p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="h-2 w-full max-w-sm rounded-full bg-secondary overflow-hidden"
        >
          <div
            className="h-full bg-accent-500 transition-all duration-fast ease-settled"
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground num-tabular">{progress}%</p>
      </div>
    );
  }

  // ---------- Error state ----------
  const shownError = error ?? localError;
  if (status === 'error' || shownError) {
    return (
      <div
        className={cn(
          'rounded-lg border border-error/40 bg-error-tint p-6',
          'flex flex-col items-center gap-3 text-center',
          className,
        )}
      >
        <FileWarning className="size-8 text-error" aria-hidden="true" />
        <p className="text-sm font-medium text-[#7F1D1D] dark:text-red-200">
          Upload didn&apos;t complete.
        </p>
        {shownError ? (
          <p className="text-sm text-[#7F1D1D]/80 dark:text-red-200/80">{shownError}</p>
        ) : null}
        <div className="flex gap-2">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RefreshCcw className="size-4" />
              Try again
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={open}>
            Choose a different file
          </Button>
        </div>
      </div>
    );
  }

  // ---------- Idle state ----------
  return (
    <div
      {...getRootProps({
        role: 'button',
        'aria-label': 'Upload a 3D file',
        tabIndex: 0,
      })}
      className={cn(
        'rounded-lg border-2 border-dashed transition-colors duration-fast ease-settled',
        'p-8 md:p-10 text-center cursor-pointer',
        'flex flex-col items-center gap-3',
        isDragActive && !isDragReject
          ? 'border-accent-500 bg-accent-50 dark:bg-accent-500/10'
          : 'border-border bg-card hover:border-neutral-300 dark:hover:border-neutral-700',
        isDragReject && 'border-error bg-error-tint',
        className,
      )}
    >
      <input {...getInputProps()} />
      <Upload
        className="size-10 text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <div>
        <p className="text-lg font-semibold">Upload your 3D file</p>
        <p className="text-sm text-muted-foreground mt-1">
          {supportedFormats.map((s) => s.toUpperCase()).join(', ')} — up to{' '}
          {formatMb(maxBytes)}. Drop it here or{' '}
          <span className="text-accent-600 font-medium">choose a file</span>.
        </p>
      </div>
    </div>
  );
}
