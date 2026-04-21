/**
 * postMessage bridge between the widget iframe and the host page.
 *
 * The only message we emit from this direction is a resize hint: the host's
 * embed.js loader listens and sets `iframe.style.height`. We never send
 * state, never send PII, never send session tokens. Keep it dumb.
 */

export type HostBoundMessage =
  | { type: 'q3dq:resize'; height: number }
  | { type: 'q3dq:ready' }
  | { type: 'q3dq:navigate-top'; url: string };

export type HostToWidgetMessage = { type: 'q3dq:scheme'; scheme: 'light' | 'dark' };

const MESSAGE_PREFIX = 'q3dq:';

/**
 * Send a message to the parent frame. A no-op if we're not actually embedded.
 * Origin is '*' intentionally — we don't know the host origin and cannot
 * require it. The loader script on the host side origin-checks OUR messages
 * (src === embed.quick3dquote.com), which is where the trust lives.
 */
export function postToHost(msg: HostBoundMessage): void {
  if (typeof window === 'undefined') return;
  if (window.parent === window) return;
  try {
    window.parent.postMessage(msg, '*');
  } catch {
    // Silent — a failing postMessage is not worth surfacing to the user.
  }
}

/**
 * Listen for messages from the host. We verify the message shape but NOT
 * the origin — again, the host could be any domain. We only accept
 * messages with our expected prefix and known keys, so a hostile host can
 * at worst flip our scheme, which is not a security boundary.
 */
export function listenFromHost(
  handler: (msg: HostToWidgetMessage) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const onMessage = (ev: MessageEvent) => {
    const data = ev.data as unknown;
    if (!data || typeof data !== 'object') return;
    const maybe = data as { type?: unknown };
    if (typeof maybe.type !== 'string' || !maybe.type.startsWith(MESSAGE_PREFIX)) {
      return;
    }
    handler(data as HostToWidgetMessage);
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

/**
 * Observe our root node's height and post a resize message to the host
 * whenever it changes. Returns a teardown function.
 */
export function watchAndResize(root: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') {
    // Fallback: single-shot on mount.
    postToHost({ type: 'q3dq:resize', height: root.offsetHeight });
    return () => {};
  }

  let last = 0;
  const obs = new ResizeObserver(() => {
    const h = Math.ceil(root.getBoundingClientRect().height);
    if (h !== last) {
      last = h;
      postToHost({ type: 'q3dq:resize', height: h });
    }
  });
  obs.observe(root);
  return () => obs.disconnect();
}
