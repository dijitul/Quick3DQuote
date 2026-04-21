'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Toaster, toast } from 'sonner';

import { WidgetShell } from '@/components/widget-shell';
import { UploadDropzone } from '@/components/upload-dropzone';
import { MeshViewer } from '@/components/mesh-viewer';
import { MaterialPanel } from '@/components/material-panel';
import { PriceSummary } from '@/components/price-summary';
import { CheckoutCta, type ContactForm } from '@/components/checkout-cta';
import { ErrorBanner } from '@/components/error-banner';
import { LoadingShimmer } from '@/components/loading-shimmer';

import {
  api,
  ApiError,
  putToPresignedUrl,
  type ShopBranding,
  type QuoteResponse,
} from '@/lib/api';
import {
  initialState,
  widgetReducer,
  type QuoteResult,
} from '@/lib/state-machine';
import { watchAndResize, postToHost } from '@/lib/post-message';
import {
  applyScheme,
  pickSchemeFromPreference,
  pickSchemeFromQuery,
} from '@/lib/colour-scheme';
import { track } from '@/lib/telemetry';

/**
 * Main widget page.
 *
 * Reads `?key=EMBED_KEY` on boot. If absent/invalid we render a friendly
 * error — this is the single most common shop-side integration mistake.
 *
 * The flow follows docs/ux-flows.md §3.1:
 *   1. Boot session → load branding.
 *   2. Drop file → client preview + presign + R2 PUT with progress.
 *   3. Create quote → server analyses + prices → we render.
 *   4. User tweaks material/qty → we re-POST /quotes with the same r2_key.
 *   5. Checkout CTA → server creates Stripe session on shop's account.
 */

function mapQuoteResponse(q: QuoteResponse): QuoteResult {
  return {
    id: q.id,
    volume_cm3: q.mesh.volume_cm3,
    surface_area_cm2: q.mesh.surface_area_cm2,
    bbox_mm: q.mesh.bbox_mm,
    triangle_count: q.mesh.triangle_count,
    watertight: q.mesh.watertight,
    unit_price_pence: q.pricing.unit_price_pence,
    subtotal_pence: q.pricing.subtotal_pence,
    total_pence: q.pricing.total_pence,
    breakdown_lines: q.pricing.breakdown_lines,
    currency: q.pricing.currency,
  };
}

export default function WidgetPage() {
  const search = useSearchParams();
  const embedKey = search.get('key');

  const [branding, setBranding] = React.useState<ShopBranding | null>(null);
  const [bootError, setBootError] = React.useState<string | null>(null);
  const [state, dispatch] = React.useReducer(widgetReducer, initialState);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // ---- Scheme (light/dark) ----
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const explicit = pickSchemeFromQuery(params);
    applyScheme(explicit ?? pickSchemeFromPreference());
  }, []);

  // ---- Session bootstrap ----
  React.useEffect(() => {
    if (!embedKey) {
      setBootError('No shop key supplied — the site embedding this widget has a broken snippet.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.createSession(embedKey, document.referrer || null);
        if (cancelled) return;
        setBranding(res.shop);
        track('widget_loaded', { shop_id: res.shop.id });
        postToHost({ type: 'q3dq:ready' });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? mapSessionError(err)
            : 'We couldn\'t reach the quoter. Please refresh.';
        setBootError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embedKey]);

  // ---- Parent-frame resize wiring ----
  React.useEffect(() => {
    if (!rootRef.current) return;
    const teardown = watchAndResize(rootRef.current);
    return teardown;
  }, []);

  // ---- Default material selection once branding arrives ----
  React.useEffect(() => {
    if (branding && !state.selectedMaterialId && branding.materials.length > 0) {
      dispatch({
        type: 'MATERIAL_SELECTED',
        materialId: branding.materials[0]!.id,
      });
    }
  }, [branding, state.selectedMaterialId]);

  // ---- Upload + quote pipeline ----
  const startUpload = React.useCallback(
    async (file: File) => {
      if (!branding || !embedKey) return;
      const material = branding.materials.find(
        (m) => m.id === state.selectedMaterialId,
      ) ?? branding.materials[0];
      if (!material) {
        toast.error('This shop has no materials configured yet.');
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      dispatch({ type: 'UPLOAD_STARTED', file, previewUrl });
      track('file_selected', {
        file_ext: file.name.split('.').pop() ?? '',
        file_size_mb: Number((file.size / 1024 / 1024).toFixed(2)),
      });

      try {
        const presign = await api.getUploadUrl(embedKey, {
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
        });

        await putToPresignedUrl(
          presign.upload_url,
          file,
          presign.required_headers,
          (p) => dispatch({ type: 'UPLOAD_PROGRESS', progress: p }),
        );

        dispatch({
          type: 'UPLOAD_COMPLETE',
          r2_key: presign.r2_key,
          filename: file.name,
        });
        track('file_uploaded');

        dispatch({ type: 'ANALYSE_STARTED' });
        const quote = await api.createQuote(embedKey, {
          r2_key: presign.r2_key,
          filename: file.name,
          material_id: material.id,
          process_id: material.process_id,
          quantity: state.quantity,
        });
        dispatch({
          type: 'QUOTE_RECEIVED',
          quote: mapQuoteResponse(quote),
          warnings: quote.warnings ?? [],
        });
        track('mesh_analysed', {
          volume_cm3: quote.mesh.volume_cm3,
          has_warnings: (quote.warnings?.length ?? 0) > 0,
        });
        track('price_shown', {
          price_pence: quote.pricing.total_pence,
          material_id: material.id,
        });
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Something went wrong.';
        if (err instanceof ApiError && err.code.startsWith('upload_')) {
          dispatch({ type: 'UPLOAD_FAILED', error: message });
          track('file_upload_failed', { error_type: err.code });
        } else {
          dispatch({ type: 'ANALYSE_FAILED', error: message });
          track('mesh_analyse_failed', {
            error_type: err instanceof ApiError ? err.code : 'unknown',
          });
        }
      }
    },
    [branding, embedKey, state.quantity, state.selectedMaterialId],
  );

  // ---- Re-price on material / qty change ----
  const reprice = React.useCallback(
    async (opts: { materialId?: string; quantity?: number }) => {
      if (!branding || !embedKey || !state.upload.file) return;
      const materialId = opts.materialId ?? state.selectedMaterialId;
      if (!materialId) return;
      const material = branding.materials.find((m) => m.id === materialId);
      if (!material) return;
      try {
        const quote = await api.createQuote(embedKey, {
          r2_key: state.upload.file.r2_key,
          filename: state.upload.file.filename,
          material_id: material.id,
          process_id: material.process_id,
          quantity: opts.quantity ?? state.quantity,
        });
        dispatch({
          type: 'QUOTE_RECEIVED',
          quote: mapQuoteResponse(quote),
          warnings: quote.warnings ?? [],
        });
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Could not re-price.';
        toast.error(message);
      }
    },
    [branding, embedKey, state.quantity, state.selectedMaterialId, state.upload.file],
  );

  const onSelectMaterial = React.useCallback(
    (materialId: string) => {
      const prev = state.selectedMaterialId;
      dispatch({ type: 'MATERIAL_SELECTED', materialId });
      track('material_changed', {
        from_material: prev ?? '',
        to_material: materialId,
      });
      if (state.upload.file) void reprice({ materialId });
    },
    [reprice, state.selectedMaterialId, state.upload.file],
  );

  const onQuantityChange = React.useCallback(
    (n: number) => {
      const prev = state.quantity;
      dispatch({ type: 'QUANTITY_CHANGED', quantity: n });
      track('quantity_changed', { from_qty: prev, to_qty: n });
      if (state.upload.file) void reprice({ quantity: n });
    },
    [reprice, state.quantity, state.upload.file],
  );

  // ---- Checkout ----
  const onCheckout = React.useCallback(
    async (form: ContactForm) => {
      if (!embedKey || !state.quote) return;
      dispatch({ type: 'CHECKOUT_STARTED' });
      track('order_form_opened');
      try {
        const successUrl = `${window.location.origin}/success?qid=${encodeURIComponent(state.quote.id)}`;
        const cancelUrl = window.location.href;
        const res = await api.createCheckout(embedKey, state.quote.id, {
          success_url: successUrl,
          cancel_url: cancelUrl,
          customer_email: form.email,
          customer_phone: form.phone || null,
          customer_name: form.name,
          notes: form.notes || null,
        });
        dispatch({ type: 'CHECKOUT_READY', checkoutUrl: res.checkout_url });
        track('checkout_started', { price_pence: state.quote.total_pence });
        // Break out of the iframe so the customer reaches Stripe top-level.
        postToHost({ type: 'q3dq:navigate-top', url: res.checkout_url });
        window.top!.location.href = res.checkout_url;
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Could not open checkout.';
        dispatch({ type: 'CHECKOUT_FAILED', error: message });
        toast.error(message);
      }
    },
    [embedKey, state.quote],
  );

  // ---- Render branches ----

  if (bootError) {
    return (
      <div ref={rootRef} className="q3dq-root p-4">
        <WidgetShell branding={null}>
          <div className="p-6">
            <ErrorBanner
              title="This quoter couldn't load."
              message={bootError}
            />
          </div>
        </WidgetShell>
      </div>
    );
  }

  if (!branding) {
    return (
      <div ref={rootRef} className="q3dq-root p-4">
        <WidgetShell branding={null}>
          <div className="p-6 space-y-3">
            <LoadingShimmer className="h-8 w-40" />
            <LoadingShimmer className="h-48" />
          </div>
        </WidgetShell>
      </div>
    );
  }

  const uploadFile = state.upload.file?.file ?? null;
  const activeFile =
    state.status === 'uploading' && !uploadFile
      ? // During upload we don't have the File back from the reducer, so use
        // the original blob URL as a placeholder — actual preview renders
        // once UPLOAD_COMPLETE stores the file object. See reducer note.
        null
      : uploadFile;

  const formatHint = activeFile
    ? (activeFile.name.toLowerCase().split('.').pop() as 'stl' | 'obj' | '3mf' | null)
    : null;

  const showBackPanel = state.status !== 'idle' && state.status !== 'uploading';

  return (
    <div ref={rootRef} className="q3dq-root p-3 @[480px]:p-4">
      <Toaster position="top-center" richColors closeButton duration={4000} />
      <WidgetShell branding={branding}>
        <div className="p-4 @[768px]:p-5 space-y-4">
          {state.status === 'idle' || state.status === 'upload_error' ? (
            <UploadDropzone
              status={state.status === 'upload_error' ? 'error' : 'idle'}
              progress={state.upload.progress}
              error={state.upload.error}
              supportedFormats={branding.supported_formats}
              maxBytes={branding.max_file_bytes}
              onFile={startUpload}
              onRetry={() => dispatch({ type: 'RESET' })}
            />
          ) : null}

          {state.status === 'uploading' ? (
            <UploadDropzone
              status="uploading"
              progress={state.upload.progress}
              supportedFormats={branding.supported_formats}
              maxBytes={branding.max_file_bytes}
              onFile={() => {}}
            />
          ) : null}

          {showBackPanel ? (
            <div
              className="grid gap-4 @[768px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
            >
              <MeshViewer
                file={activeFile}
                format={formatHint}
                authoritativeBbox={state.quote?.bbox_mm ?? null}
              />

              <div className="flex flex-col gap-4">
                {state.warnings.length > 0 && state.status === 'mesh_warning' ? (
                  <ErrorBanner
                    tone="warning"
                    title="Heads up: some small geometry issues."
                    message="We can still quote and print this, but the final part might differ slightly from the preview."
                    onDismiss={() => dispatch({ type: 'WARNING_ACKNOWLEDGED' })}
                  />
                ) : null}

                {state.status === 'fatal_error' ? (
                  <ErrorBanner
                    title="Couldn't analyse this file."
                    message={state.error ?? 'The 3D engine reported an error.'}
                    onRetry={() => dispatch({ type: 'RESET' })}
                  />
                ) : null}

                <MaterialPanel
                  materials={branding.materials}
                  selectedId={state.selectedMaterialId}
                  onSelect={onSelectMaterial}
                  quantity={state.quantity}
                  onQuantityChange={onQuantityChange}
                  disabled={state.status === 'analysing'}
                />

                <PriceSummary
                  quote={state.quote}
                  loading={state.status === 'analysing'}
                />

                {state.quote ? (
                  <CheckoutCta
                    totalPence={state.quote.total_pence}
                    currency={state.quote.currency}
                    disabled={state.status !== 'priced' && state.status !== 'payment_failed'}
                    loading={
                      state.status === 'checking_out' ||
                      state.status === 'stripe_redirect'
                    }
                    onSubmit={onCheckout}
                  />
                ) : state.status === 'analysing' ? (
                  <LoadingShimmer className="h-12" label="Calculating price" />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </WidgetShell>
    </div>
  );
}

function mapSessionError(err: ApiError): string {
  switch (err.code) {
    case 'shop_not_found':
      return 'This shop key isn\'t recognised. Ask the site owner to check their embed snippet.';
    case 'subscription_inactive':
      return 'This quoter is paused. The shop\'s setting things up — please check back shortly.';
    case 'rate_limited':
      return 'Lots of activity right now — please try again in a minute.';
    default:
      return err.message || 'We couldn\'t start a session with this shop.';
  }
}
