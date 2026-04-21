/**
 * Telemetry stub.
 *
 * The event names and properties mirror docs/ux-flows.md §8. We don't wire
 * up PostHog here — that's a v1.1 decision (self-hosted vs cloud) — but
 * having the call sites in place now means we flip one file to go live.
 *
 * In development we log to console. In production we no-op until the
 * PostHog client is mounted. Either way, track() never throws.
 */

export type TrackEvent =
  | 'widget_loaded'
  | 'widget_opened'
  | 'file_selected'
  | 'file_uploaded'
  | 'file_upload_failed'
  | 'mesh_analysed'
  | 'mesh_analyse_failed'
  | 'price_shown'
  | 'material_changed'
  | 'quantity_changed'
  | 'viewer_interacted'
  | 'warning_shown'
  | 'order_form_opened'
  | 'checkout_started'
  | 'checkout_completed'
  | 'checkout_abandoned'
  | 'another_file_uploaded';

export type TrackProps = Record<string, string | number | boolean | null>;

export function track(event: TrackEvent, props: TrackProps = {}): void {
  try {
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[q3dq:telemetry]', event, props);
    }
    // TODO(v1.1): forward to PostHog client here.
  } catch {
    // Telemetry must never break the product.
  }
}
