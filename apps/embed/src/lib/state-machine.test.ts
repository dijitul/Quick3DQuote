import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  initialState,
  widgetReducer,
  type QuoteResult,
  type WidgetState,
} from './state-machine';

// jsdom doesn't implement createObjectURL/revokeObjectURL — stub.
beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    // @ts-expect-error — test shim
    URL.createObjectURL = vi.fn(() => 'blob:mock');
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    // @ts-expect-error — test shim
    URL.revokeObjectURL = vi.fn();
  }
});

const fakeFile = new File(['solid'], 'part.stl', { type: 'model/stl' });

const fakeQuote: QuoteResult = {
  id: 'q_test',
  volume_cm3: 12.4,
  surface_area_cm2: 84.1,
  bbox_mm: { x: 48, y: 32, z: 15 },
  triangle_count: 10000,
  watertight: true,
  unit_price_pence: 1420,
  subtotal_pence: 1420,
  total_pence: 1420,
  breakdown_lines: [
    { label: 'Material', amount_pence: 99 },
    { label: 'Machine time', amount_pence: 800 },
    { label: 'Setup', amount_pence: 300 },
    { label: 'Markup', amount_pence: 180 },
  ],
  currency: 'GBP',
};

function upload(state: WidgetState = initialState): WidgetState {
  return widgetReducer(state, {
    type: 'UPLOAD_STARTED',
    file: fakeFile,
    previewUrl: 'blob:mock',
  });
}

describe('widgetReducer — happy path', () => {
  it('idle → uploading → analysing → priced → checking_out → stripe_redirect → success', () => {
    let state = initialState;
    expect(state.status).toBe('idle');

    state = upload(state);
    expect(state.status).toBe('uploading');

    state = widgetReducer(state, { type: 'UPLOAD_PROGRESS', progress: 50 });
    expect(state.upload.progress).toBe(50);

    state = widgetReducer(state, {
      type: 'UPLOAD_COMPLETE',
      r2_key: 'meshes/s/q/part.stl',
      filename: 'part.stl',
    });
    expect(state.status).toBe('analysing');
    expect(state.upload.progress).toBe(100);

    state = widgetReducer(state, { type: 'QUOTE_RECEIVED', quote: fakeQuote });
    expect(state.status).toBe('priced');
    expect(state.quote?.total_pence).toBe(1420);

    state = widgetReducer(state, { type: 'CHECKOUT_STARTED' });
    expect(state.status).toBe('checking_out');

    state = widgetReducer(state, {
      type: 'CHECKOUT_READY',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_test',
    });
    expect(state.status).toBe('stripe_redirect');
    expect(state.checkoutUrl).toContain('checkout.stripe.com');

    state = widgetReducer(state, { type: 'SUCCESS' });
    expect(state.status).toBe('success');
  });
});

describe('widgetReducer — error paths', () => {
  it('UPLOAD_FAILED moves to upload_error with a reason', () => {
    let state = upload();
    state = widgetReducer(state, { type: 'UPLOAD_FAILED', error: 'Network lost' });
    expect(state.status).toBe('upload_error');
    expect(state.upload.error).toBe('Network lost');
  });

  it('ANALYSE_FAILED moves to fatal_error', () => {
    let state = upload();
    state = widgetReducer(state, {
      type: 'UPLOAD_COMPLETE',
      r2_key: 'k',
      filename: 'p.stl',
    });
    state = widgetReducer(state, {
      type: 'ANALYSE_FAILED',
      error: 'Engine timeout',
    });
    expect(state.status).toBe('fatal_error');
    expect(state.error).toContain('timeout');
  });

  it('CHECKOUT_FAILED drops back to priced without losing the quote', () => {
    let state = upload();
    state = widgetReducer(state, {
      type: 'UPLOAD_COMPLETE',
      r2_key: 'k',
      filename: 'p.stl',
    });
    state = widgetReducer(state, { type: 'QUOTE_RECEIVED', quote: fakeQuote });
    state = widgetReducer(state, { type: 'CHECKOUT_STARTED' });
    state = widgetReducer(state, {
      type: 'CHECKOUT_FAILED',
      error: 'Stripe unreachable',
    });
    expect(state.status).toBe('priced');
    expect(state.quote).toEqual(fakeQuote);
    expect(state.error).toBe('Stripe unreachable');
  });
});

describe('widgetReducer — mesh warnings', () => {
  it('first-priced with warnings lands in mesh_warning and can be acknowledged', () => {
    let state = upload();
    state = widgetReducer(state, {
      type: 'UPLOAD_COMPLETE',
      r2_key: 'k',
      filename: 'p.stl',
    });
    state = widgetReducer(state, {
      type: 'QUOTE_RECEIVED',
      quote: fakeQuote,
      warnings: ['non_manifold_edges'],
    });
    expect(state.status).toBe('mesh_warning');
    state = widgetReducer(state, { type: 'WARNING_ACKNOWLEDGED' });
    expect(state.status).toBe('priced');
  });

  it('re-price after acknowledgement does not bounce back to mesh_warning', () => {
    let state = upload();
    state = widgetReducer(state, {
      type: 'UPLOAD_COMPLETE',
      r2_key: 'k',
      filename: 'p.stl',
    });
    state = widgetReducer(state, {
      type: 'QUOTE_RECEIVED',
      quote: fakeQuote,
      warnings: ['non_manifold_edges'],
    });
    state = widgetReducer(state, { type: 'WARNING_ACKNOWLEDGED' });
    state = widgetReducer(state, {
      type: 'QUOTE_RECEIVED',
      quote: { ...fakeQuote, total_pence: 2000 },
      warnings: ['non_manifold_edges'],
    });
    expect(state.status).toBe('priced');
    expect(state.quote?.total_pence).toBe(2000);
  });
});

describe('widgetReducer — guards', () => {
  it('QUANTITY_CHANGED clamps to [1, 1000]', () => {
    let state = widgetReducer(initialState, {
      type: 'QUANTITY_CHANGED',
      quantity: 0,
    });
    expect(state.quantity).toBe(1);
    state = widgetReducer(state, { type: 'QUANTITY_CHANGED', quantity: 99999 });
    expect(state.quantity).toBe(1000);
    state = widgetReducer(state, { type: 'QUANTITY_CHANGED', quantity: 3.7 });
    expect(state.quantity).toBe(4);
  });

  it('UPLOAD_PROGRESS from idle is a no-op', () => {
    const state = widgetReducer(initialState, {
      type: 'UPLOAD_PROGRESS',
      progress: 30,
    });
    expect(state.status).toBe('idle');
    expect(state.upload.progress).toBe(0);
  });

  it('CHECKOUT_STARTED only works from priced', () => {
    const s = widgetReducer(initialState, { type: 'CHECKOUT_STARTED' });
    expect(s.status).toBe('idle');
  });

  it('RESET returns to the exact initial state', () => {
    let state = upload();
    state = widgetReducer(state, {
      type: 'UPLOAD_COMPLETE',
      r2_key: 'k',
      filename: 'p.stl',
    });
    state = widgetReducer(state, { type: 'QUOTE_RECEIVED', quote: fakeQuote });
    const reset = widgetReducer(state, { type: 'RESET' });
    expect(reset).toEqual(initialState);
  });
});
