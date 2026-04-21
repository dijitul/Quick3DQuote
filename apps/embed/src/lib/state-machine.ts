/**
 * Widget state machine.
 *
 * Implements the state diagram in docs/ux-flows.md §5, collapsed to a
 * reducer we can drive from page.tsx. Each transition is a single action;
 * illegal transitions are ignored (not thrown — defensive, since the
 * reducer is called from async handlers where races can and will happen).
 *
 *     [*] -> Idle
 *     Idle -> Uploading
 *     Uploading -> Analysing | UploadError
 *     UploadError -> Uploading | Idle
 *     Analysing -> Priced | AnalyseError | MeshWarning
 *     MeshWarning -> Priced
 *     AnalyseError -> Uploading | Idle
 *     Priced -> Priced (material/qty change)
 *     Priced -> CheckingOut
 *     CheckingOut -> StripeRedirect | Priced
 *     StripeRedirect -> Success | Priced | PaymentFailed
 *     PaymentFailed -> CheckingOut
 *     Success -> Idle
 */

export type WidgetStatus =
  | 'idle'
  | 'uploading'
  | 'upload_error'
  | 'analysing'
  | 'mesh_warning'
  | 'priced'
  | 'checking_out'
  | 'stripe_redirect'
  | 'payment_failed'
  | 'success'
  | 'fatal_error';

export type Bbox = { x: number; y: number; z: number };

export type QuoteResult = {
  id: string;
  volume_cm3: number;
  surface_area_cm2: number;
  bbox_mm: Bbox;
  triangle_count: number;
  watertight: boolean;
  unit_price_pence: number;
  subtotal_pence: number;
  total_pence: number;
  breakdown_lines: { label: string; amount_pence: number }[];
  currency: 'GBP';
};

export type UploadedFile = {
  file: File;
  r2_key: string;
  filename: string;
};

export type WidgetState = {
  status: WidgetStatus;
  /** Local preview URL — revoked when cleared. */
  meshPreviewUrl: string | null;
  upload: {
    progress: number; // 0..100
    file: UploadedFile | null;
    error: string | null;
  };
  /** Last successful quote from the server. Never trust this for payment. */
  quote: QuoteResult | null;
  selectedMaterialId: string | null;
  quantity: number;
  warnings: string[];
  error: string | null;
  checkoutUrl: string | null;
};

export const initialState: WidgetState = {
  status: 'idle',
  meshPreviewUrl: null,
  upload: { progress: 0, file: null, error: null },
  quote: null,
  selectedMaterialId: null,
  quantity: 1,
  warnings: [],
  error: null,
  checkoutUrl: null,
};

export type WidgetAction =
  | { type: 'UPLOAD_STARTED'; file: File; previewUrl: string }
  | { type: 'UPLOAD_PROGRESS'; progress: number }
  | { type: 'UPLOAD_COMPLETE'; r2_key: string; filename: string }
  | { type: 'UPLOAD_FAILED'; error: string }
  | { type: 'ANALYSE_STARTED' }
  | { type: 'QUOTE_RECEIVED'; quote: QuoteResult; warnings?: string[] }
  | { type: 'ANALYSE_FAILED'; error: string }
  | { type: 'MATERIAL_SELECTED'; materialId: string }
  | { type: 'QUANTITY_CHANGED'; quantity: number }
  | { type: 'CHECKOUT_STARTED' }
  | { type: 'CHECKOUT_READY'; checkoutUrl: string }
  | { type: 'CHECKOUT_FAILED'; error: string }
  | { type: 'CHECKOUT_CANCELLED' }
  | { type: 'PAYMENT_FAILED'; error: string }
  | { type: 'SUCCESS' }
  | { type: 'WARNING_ACKNOWLEDGED' }
  | { type: 'RESET' };

/**
 * Guard: is the transition legal from the current status?
 * We accept a union of prior statuses so a single action can apply from
 * multiple states (e.g. RESET from anywhere).
 */
function allow(current: WidgetStatus, allowed: readonly WidgetStatus[]) {
  return allowed.includes(current);
}

export function widgetReducer(
  state: WidgetState,
  action: WidgetAction,
): WidgetState {
  switch (action.type) {
    case 'UPLOAD_STARTED': {
      if (!allow(state.status, ['idle', 'upload_error', 'success'])) return state;
      // Clean up prior preview URL if the user is starting over.
      if (state.meshPreviewUrl) URL.revokeObjectURL(state.meshPreviewUrl);
      return {
        ...initialState,
        status: 'uploading',
        meshPreviewUrl: action.previewUrl,
        upload: { progress: 0, file: null, error: null },
        quantity: state.quantity, // preserve user choice
      };
    }

    case 'UPLOAD_PROGRESS':
      if (state.status !== 'uploading') return state;
      return {
        ...state,
        upload: { ...state.upload, progress: Math.min(100, Math.max(0, action.progress)) },
      };

    case 'UPLOAD_COMPLETE': {
      if (state.status !== 'uploading') return state;
      return {
        ...state,
        status: 'analysing',
        upload: {
          progress: 100,
          file: {
            file: state.upload.file?.file ?? (null as unknown as File),
            r2_key: action.r2_key,
            filename: action.filename,
          },
          error: null,
        },
      };
    }

    case 'UPLOAD_FAILED':
      return {
        ...state,
        status: 'upload_error',
        upload: { ...state.upload, error: action.error },
      };

    case 'ANALYSE_STARTED':
      if (!allow(state.status, ['uploading', 'analysing'])) return state;
      return { ...state, status: 'analysing', error: null };

    case 'QUOTE_RECEIVED': {
      // This action fires on the first priced result AND on re-prices.
      const hasWarnings = (action.warnings?.length ?? 0) > 0;
      return {
        ...state,
        status: hasWarnings && state.status !== 'priced' ? 'mesh_warning' : 'priced',
        quote: action.quote,
        warnings: action.warnings ?? [],
        error: null,
      };
    }

    case 'ANALYSE_FAILED':
      return { ...state, status: 'fatal_error', error: action.error };

    case 'WARNING_ACKNOWLEDGED':
      if (state.status !== 'mesh_warning') return state;
      return { ...state, status: 'priced' };

    case 'MATERIAL_SELECTED':
      return { ...state, selectedMaterialId: action.materialId };

    case 'QUANTITY_CHANGED':
      return {
        ...state,
        quantity: Math.max(1, Math.min(1000, Math.round(action.quantity))),
      };

    case 'CHECKOUT_STARTED':
      if (state.status !== 'priced') return state;
      return { ...state, status: 'checking_out', error: null };

    case 'CHECKOUT_READY':
      if (state.status !== 'checking_out') return state;
      return { ...state, status: 'stripe_redirect', checkoutUrl: action.checkoutUrl };

    case 'CHECKOUT_FAILED':
      return { ...state, status: 'priced', error: action.error };

    case 'CHECKOUT_CANCELLED':
      return { ...state, status: 'priced', checkoutUrl: null };

    case 'PAYMENT_FAILED':
      return { ...state, status: 'payment_failed', error: action.error };

    case 'SUCCESS':
      return { ...state, status: 'success' };

    case 'RESET': {
      if (state.meshPreviewUrl) URL.revokeObjectURL(state.meshPreviewUrl);
      return initialState;
    }

    default: {
      // Exhaustiveness — TS will error if we add an action and forget a case.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
