/**
 * @file src/services/headless-network.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The network of the node's headless browser: what a page rendered on the server may
 *   reach. The browser runs code somebody else wrote (an app being photographed or playtested, a
 *   Design Book part being benched) on the node's own machine, so every request it makes is a
 *   request the NODE makes, from inside its network. Until 2026-10-05 the three renderers handed
 *   every sub-request to the browser's own network stack (`route.continue()`), so any app publisher
 *   could reach the node's private network and the cloud metadata address, and a rendered internal
 *   page landed in a public screenshot (secaudit 2026-10, SSRF-1).
 *
 *   TWO LAYERS, and the second one fails closed.
 *   1. The browser context answers every request itself (guardHeadlessContext, on the CONTEXT so
 *      workers and pop-ups are covered too, not only the page): the node's own origin is fetched
 *      from its loopback with no credentials, any other http(s) address goes through safeFetch
 *      (DNS checked, private, loopback, link-local and metadata ranges refused, every redirect
 *      re-checked, the body capped), and everything else is aborted. Only GET and HEAD leave.
 *   2. The browser itself starts with a proxy that leads nowhere (HEADLESS_NO_NETWORK_ARGS),
 *      loopback included, WebRTC limited to proxied traffic, and service workers blocked. A request
 *      that escapes the handler (a WebSocket, which context routing does not see) dies there.
 *
 *   The rule is on the request, not on what is pictured, so the screenshot capturer, the app
 *   playtest and the Design Book bench all get it from withHeadlessContext (screenshot-capture.ts).
 *
 *   AN OPERATOR'S OWN SERVERS. AIMEAT_SCREENSHOT_EGRESS lists exact origins (scheme, host, port) a
 *   rendered page may reach although they are private, for a self-hosted node that pictures apps
 *   that read its own intranet. Empty by default. On the localhost profile safeFetch already allows
 *   loopback (AIMEAT_ALLOW_PRIVATE_EGRESS); other private ranges need the list.
 * @structure HEADLESS_NO_NETWORK_ARGS · HEADLESS_CONTEXT_OPTIONS · MAX_RESOURCE_BYTES ·
 *   headlessRequestHandler(config) · headlessRequestHandlerFor(rule) · guardHeadlessContext(ctx, config) ·
 *   serveDocumentOnce(page, html, type)
 * @usage
 *   const ctx = await browser.newContext({ viewport, ...HEADLESS_CONTEXT_OPTIONS });
 *   await guardHeadlessContext(ctx, config);
 *   const page = await ctx.newPage();
 *   await serveDocumentOnce(page, html);
 * @version-history
 *   v1.1.0 — 2026-10-06 — headlessRequestHandlerFor(rule): the same handler for a browser outside the
 *     node, which `aimeat screenshot-worker` now installs (secaudit 2026-10 follow-up, Part C).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, SSRF-1, plan S9).
 */
import type { AimeatConfig } from '../config.js';
import { safeFetch } from '../utils/url-validator.js';
import { readBodyCapped } from '../utils/read-capped.js';
import { egressOriginsOf } from './ai-provider-common.js';
import { logger } from '../utils/logger.js';

/**
 * Chromium arguments that leave the browser no network of its own. Port 9 is the discard port, and
 * nothing listens there; `<-loopback>` removes Chromium's implicit loopback bypass, so 127.0.0.1 goes
 * to the dead proxy as well. Every request the page may make is answered by the route handler
 * before it reaches the network stack, so a working page never meets the proxy.
 */
export const HEADLESS_NO_NETWORK_ARGS = [
  '--proxy-server=http://127.0.0.1:9',
  '--proxy-bypass-list=<-loopback>',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
];

/** Options every headless context starts with: a service worker could answer requests the route never sees. */
export const HEADLESS_CONTEXT_OPTIONS = { serviceWorkers: 'block' as const };

/** The largest single resource a rendered page may load: a big image passes, a disk image does not. */
export const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;
/** How long one resource may take before the page gets a network error for it. */
const RESOURCE_TIMEOUT_MS = 15_000;
/** The response headers handed back to the page. Nothing else: no cookies, no CSP of another origin. */
const PASSED_HEADERS = ['content-type', 'content-language', 'cache-control', 'last-modified', 'etag'];

/** The slice of a Playwright route this module uses, so playwright-core stays lazily imported. */
export interface HeadlessRoute {
  request(): { url(): string; method(): string; resourceType(): string; headers(): Record<string, string> };
  fulfill(o: { status: number; headers?: Record<string, string>; body?: string | Buffer; contentType?: string }): Promise<void>;
  abort(errorCode?: string): Promise<void>;
  fallback(): Promise<void>;
}
/** A page or a browser context: anything that takes a route handler. */
export interface HeadlessRoutable {
  route(match: string, handler: (route: HeadlessRoute) => unknown): Promise<void>;
}

/** The node's own origins: the public base URL and the loopback the node listens on. */
function ownOrigins(config: AimeatConfig): string[] {
  const out = [`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, `http://[::1]:${config.port}`];
  if (URL.canParse(config.baseUrl)) out.push(new URL(config.baseUrl).origin);
  return out;
}

/**
 * The handler a headless context answers every request with. Exported for the unit test, which
 * drives it with recorded routes; the renderers install it with guardHeadlessContext.
 */
export function headlessRequestHandler(config: AimeatConfig): (route: HeadlessRoute) => Promise<void> {
  return headlessRequestHandlerFor({
    own: ownOrigins(config),
    ownFetchBase: `http://127.0.0.1:${config.port}`,
    egress: egressOriginsOf(config.screenshotEgress, 'headless', 'AIMEAT_SCREENSHOT_EGRESS'),
  });
}

/**
 * The same handler for a browser that runs outside the node: `aimeat screenshot-worker` renders the
 * node's apps on the operator's machine, so the node is a remote origin there and is fetched at its
 * own address rather than on a loopback. Everything else is the node's rule: only GET and HEAD,
 * private and metadata addresses refused, the body capped.
 */
export function headlessRequestHandlerFor(rule: {
  /** The node's origins: fetched from `ownFetchBase` with no credential. */
  own: string[];
  /** Where the node's own pages are fetched from. */
  ownFetchBase: string;
  /** Exact origins of private servers a page may reach besides the node. */
  egress: string[];
}): (route: HeadlessRoute) => Promise<void> {
  const { own, egress } = rule;
  const loopback = rule.ownFetchBase.replace(/\/+$/, '');
  return async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const raw = req.url();
    const url = URL.canParse(raw) ? new URL(raw) : null;
    try {
      if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || (method !== 'GET' && method !== 'HEAD')) {
        await route.abort('blockedbyclient');
        return;
      }
      // The node's own pages and libraries come from its loopback, so a node that cannot reach its
      // own public name from inside still renders, and no credential of anybody's goes with them.
      const isOwn = own.includes(url.origin);
      const target = isOwn ? `${loopback}${url.pathname}${url.search}` : url.toString();
      const accept = req.headers()['accept'];
      const resp = await safeFetch(target, {
        method,
        headers: accept ? { accept } : {},
        allowOrigins: isOwn ? [loopback, ...egress] : egress,
        signal: AbortSignal.timeout(RESOURCE_TIMEOUT_MS),
      });
      const body = method === 'HEAD' ? Buffer.alloc(0) : await readBodyCapped(resp, MAX_RESOURCE_BYTES);
      if (body === null) {
        await route.abort('failed');
        return;
      }
      const headers: Record<string, string> = {};
      for (const name of PASSED_HEADERS) {
        const v = resp.headers.get(name);
        if (v) headers[name] = v;
      }
      await route.fulfill({ status: resp.status, headers, body });
    } catch (err) {
      // Blocked, unreachable, too slow: the page sees a network error, the same one a browser shows
      // for an address it cannot reach. Debug level, because an app loading from a dead CDN is common.
      logger.debug('headless-network: a rendered page\'s request was refused', { url: raw.slice(0, 200), error: String(err) });
      await route.abort('failed').catch(e => logger.debug('headless-network: abort failed', { error: String(e) }));
    }
  };
}

/** Answer every request of a headless browser context with headlessRequestHandler. */
export async function guardHeadlessContext(ctx: HeadlessRoutable, config: AimeatConfig): Promise<void> {
  await ctx.route('**/*', headlessRequestHandler(config));
}

/**
 * Serve `html` as the page's first document, and hand every other request on to the context's
 * guard. One copy for the three renderers, which each had their own; theirs called `continue()`,
 * which sends a request to the network and past any context route.
 */
export async function serveDocumentOnce(page: HeadlessRoutable, html: string, contentType = 'text/html; charset=utf-8'): Promise<void> {
  let served = false;
  await page.route('**/*', async (route) => {
    if (!served && route.request().resourceType() === 'document') {
      served = true;
      await route.fulfill({ status: 200, contentType, body: html });
    } else {
      await route.fallback();
    }
  });
}
