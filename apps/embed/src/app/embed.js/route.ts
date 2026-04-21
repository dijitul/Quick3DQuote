import { NextResponse } from 'next/server';

/**
 * /embed.js — the single loader script shops paste onto their site:
 *
 *     <script src="https://embed.quick3dquote.com/embed.js?key=SHOP_KEY" async></script>
 *     <div id="q3dq-widget"></div>
 *
 * This route produces the script at runtime so we can substitute the
 * iframe origin from the server env (NEXT_PUBLIC_EMBED_ORIGIN) without a
 * build step. The script is tiny and intentionally hand-rolled — no bundler
 * output — so it stays readable in a host-site devtools session.
 *
 * The script's responsibilities:
 *   - Derive the shop key from its own <script src="?key=">.
 *   - Find or create the #q3dq-widget container in the host DOM.
 *   - Inject an iframe pointing at the widget URL.
 *   - Sample the host's body background luminance and pass `?scheme=`.
 *   - Listen for our postMessage resize events and grow/shrink the iframe.
 *   - Ignore any message that doesn't originate from our embed origin.
 */

// Static export would conflict with dynamic env-var substitution; this route
// must run on every request so the embed origin is always correct.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function buildScript(embedOrigin: string): string {
  // Embed-origin is interpolated once at the top of the IIFE. We validate it
  // server-side (zod in env.ts) so we trust its shape. Still, we JSON.stringify
  // to be extra safe against accidental injection.
  const ORIGIN = JSON.stringify(embedOrigin.replace(/\/$/, ''));

  // NOTE: this file is plain ES5 — no arrow functions, no const inside blocks
  // we wouldn't trust a 2014 browser on — because it loads on arbitrary shop
  // sites including ones with very old polyfill sets.
  return `/*! Quick3DQuote embed loader v0.1 */
(function () {
  'use strict';
  var EMBED_ORIGIN = ${ORIGIN};
  var CONTAINER_ID = 'q3dq-widget';
  var INITIAL_HEIGHT = 640;

  // 1. Find our own <script> tag so we can read the shop key off the src.
  //    document.currentScript isn't available inside deferred/async scripts
  //    in all engines, so we fall back to scanning.
  function findSelfScript() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i];
      if (s.src && s.src.indexOf('/embed.js') !== -1 && s.src.indexOf(EMBED_ORIGIN) === 0) {
        return s;
      }
    }
    return null;
  }

  var self = findSelfScript();
  if (!self) {
    if (window.console) console.warn('[q3dq] loader could not locate its own <script> tag');
    return;
  }

  // 2. Extract shop key.
  var src = self.src || '';
  var keyMatch = src.match(/[?&]key=([^&#]+)/);
  var shopKey = keyMatch ? decodeURIComponent(keyMatch[1]) : '';
  if (!shopKey) {
    if (window.console) console.warn('[q3dq] missing ?key= on embed.js — widget will not load');
    return;
  }

  // 3. Find or create container.
  function getContainer() {
    var el = document.getElementById(CONTAINER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = CONTAINER_ID;
      // Insert immediately after our script tag so shops can place us
      // wherever they want by moving the <script> within their page.
      if (self.parentNode) {
        self.parentNode.insertBefore(el, self.nextSibling);
      } else {
        document.body.appendChild(el);
      }
    }
    return el;
  }

  // 4. Detect host background luminance → prefer light/dark. This is
  //    advisory; the widget also honours prefers-color-scheme on its own.
  function detectScheme() {
    try {
      var bg = window.getComputedStyle(document.body).backgroundColor;
      // getComputedStyle returns 'rgb(r, g, b)' or 'rgba(...)' or 'transparent'.
      var m = bg && bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if (!m) return null;
      function lin(c) {
        var s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      }
      var lum = 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]);
      return lum < 0.35 ? 'dark' : 'light';
    } catch (e) {
      return null;
    }
  }

  // 5. Build the iframe URL.
  function buildIframeUrl() {
    var url = EMBED_ORIGIN + '/?key=' + encodeURIComponent(shopKey);
    var scheme = detectScheme();
    if (scheme) url += '&scheme=' + scheme;
    return url;
  }

  function mount() {
    var container = getContainer();
    // Avoid double-mount if the loader runs twice (common with SPA hosts).
    if (container.getAttribute('data-q3dq-mounted') === '1') return;
    container.setAttribute('data-q3dq-mounted', '1');

    var iframe = document.createElement('iframe');
    iframe.src = buildIframeUrl();
    iframe.title = 'Quick3DQuote quoter';
    iframe.loading = 'lazy';
    iframe.setAttribute('allow', 'clipboard-write');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    // Sandbox: we need scripts + forms + same-origin (to our own origin,
    // which is cross-site to the host anyway) + top-navigation for the
    // Stripe redirect. We do NOT add allow-modals.
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation',
    );
    iframe.style.cssText =
      'width:100%;border:0;display:block;min-height:' + INITIAL_HEIGHT + 'px;background:transparent;';
    iframe.setAttribute('data-q3dq-iframe', '1');

    container.appendChild(iframe);

    // 6. Resize bridge — messages must come from our exact origin.
    function onMessage(ev) {
      if (!ev || ev.origin !== EMBED_ORIGIN) return;
      var data = ev.data;
      if (!data || typeof data !== 'object' || !data.type) return;
      if (data.type === 'q3dq:resize' && typeof data.height === 'number') {
        var h = Math.max(INITIAL_HEIGHT, Math.ceil(data.height) + 4);
        iframe.style.height = h + 'px';
      } else if (data.type === 'q3dq:navigate-top' && typeof data.url === 'string') {
        // Stripe redirect — break out of the iframe top-level on user gesture.
        // The widget also calls window.top.location itself; this is a safety
        // net for browsers that block cross-origin top-nav without allow-top-
        // navigation-by-user-activation honouring the gesture correctly.
        try {
          window.location.href = data.url;
        } catch (e) {
          /* no-op */
        }
      }
    }

    if (window.addEventListener) {
      window.addEventListener('message', onMessage, false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
`;
}

export async function GET() {
  const embedOrigin =
    process.env.NEXT_PUBLIC_EMBED_ORIGIN ?? 'http://localhost:3001';
  const body = buildScript(embedOrigin);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
