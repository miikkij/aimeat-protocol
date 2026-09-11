/**
 * @file indexnow.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Telling the search engines that something here changed, instead of waiting to be
 *   crawled.
 *
 *   IndexNow is one POST that reaches Bing, Yandex, Naver, Seznam and Yep at once, and through Bing
 *   it reaches ChatGPT's search and Copilot. Google does not participate, so this never replaces
 *   the sitemap; it shortens the wait for the engines that do. It is a knock, not an order: each
 *   engine still decides whether to come and what to keep.
 *
 *   ONE POST PER HOST. IndexNow proves ownership with a key file, and the file has to sit on the
 *   host the addresses belong to: a key at aimeat.io/<key>.txt vouches for aimeat.io/... and for
 *   nothing on turbo.apps.aimeat.io. The v1.0.0 batch declared the apex as its host and put an app
 *   host's address in the same list, so the app's own address never counted. The node serves the
 *   key file on every host it answers for (routes-loader registers it on the app itself, not on
 *   the apex alone), so the addresses are grouped by host here and each group carries its own key
 *   location.
 *
 *   Four conditions silence an automatic notice, and each one is a case where sending would be
 *   wrong rather than merely unnecessary: no key (the endpoint would reject an unverifiable host),
 *   the auto switch off, node-wide discovery off (announcing pages we are telling crawlers not to
 *   fetch), and an empty list. An EXPLICIT notice, one the operator asked for, ignores the auto
 *   switch and nothing else.
 *
 *   The whole-site notice (the pages and every findable application) lives in indexnow-site.ts,
 *   which reads the search-visibility decision from app-seo.ts; app-seo.ts calls announceApp from
 *   here, so this file must not read app-seo.ts back.
 *
 * @structure
 *   - submitToIndexNow(config, storage, urls, opts) — group by host, POST each, record the run
 *   - appSubmitUrls(config, app, subdomain)         — the addresses one app occupies
 *   - announceApp(config, storage, app, subdomain)  — one app's notice, stamped on the app
 *   - groupByHost(urls), stampAnnounced(...)        — shared with indexnow-site.ts
 * @usage
 *   await announceApp(config, storage, { ownerGaii, ownerName, filename }, site?.subdomain);
 * @version-history
 *   v1.1.0 — 2026-09-11 — Grouped by host with a key location per host (the cross-host batch was
 *     wrong). announceApp stamps seo.announcedAt on the app. A run records hosts, refusals, scope
 *     and sender. The whole-site notice is indexnow-site.ts.
 *   v1.0.0 — 2026-08-25 — Initial. scripts/indexnow.ts calls this rather than posting its own.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import { recordIndexNowRun, type IndexNowRun, type IndexNowScope } from './indexnow-log.js';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
/** IndexNow's own documented ceiling per call. */
const MAX_URLS = 10_000;
/** How many host batches are in flight at once. Thirty app hosts at one per second is a wait. */
const CONCURRENCY = 4;

export interface SubmitOptions {
  /** What the notice covers, for the log. */
  scope?: IndexNowScope;
  /** Who asked, for the log; absent when a publish fired it. */
  by?: string;
  /** The operator asked for this one: the auto switch does not apply. */
  explicit?: boolean;
}

/**
 * Submit addresses and record what happened. Returns the run, or null when the node is configured
 * not to submit.
 *
 * NEVER THROWS. Every automatic caller is a side effect at the end of a successful write — an app
 * was published, a switch was flipped — and a search engine being unreachable must not turn that
 * finished work into a failed request. The outcome is recorded either way, so the admin status
 * shows a refused submission as refused instead of showing nothing.
 */
export async function submitToIndexNow(
  config: AimeatConfig,
  storage: Storage,
  urls: string[],
  opts: SubmitOptions = {},
): Promise<IndexNowRun | null> {
  if (!config.indexNowKey) return null;
  if (!opts.explicit && !config.seoIndexnowAuto) return null;
  if (config.seoIndexing === 'off') return null;

  const groups = groupByHost([...new Set(urls.filter(Boolean))].slice(0, MAX_URLS));
  if (groups.size === 0) return null;

  const key = config.indexNowKey;
  const failed: string[] = [];
  let status: number | null = null;
  let urlCount = 0;

  const batches = [...groups.entries()];
  const post = async ([origin, list]: [string, string[]]): Promise<void> => {
    const host = new URL(origin).host;
    urlCount += list.length;
    const payload = { host, key, keyLocation: `${origin}/${key}.txt`, urlList: list };
    try {
      // Through safeFetch like every other non-constant outbound call, even though the endpoint is
      // a constant: the rule is about the door, not about this particular URL, and an exception
      // here is one more place a future edit could put a caller-supplied host.
      const resp = await safeFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });
      // 200 and 202 both mean accepted; IndexNow answers 202 for a queued batch.
      const ok = resp.ok || resp.status === 202;
      if (!ok) {
        failed.push(host);
        logger.warn('IndexNow refused a batch', { host, status: resp.status, urls: list.length });
      }
      // The first refusal's status is the one worth reading; an accepted status fills in otherwise.
      if (!ok && (status === null || status === 200 || status === 202)) status = resp.status;
      else if (ok && status === null) status = resp.status;
    } catch (err) {
      failed.push(host);
      logger.warn('IndexNow batch did not complete', { host, error: (err as Error).message });
    }
  };
  await inPool(batches, CONCURRENCY, post);

  const run: IndexNowRun = {
    at: new Date().toISOString(),
    urlCount,
    hosts: groups.size,
    ok: failed.length === 0,
    status,
    failed,
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(opts.by ? { by: opts.by } : {}),
  };
  await recordIndexNowRun(storage, run).catch((err: unknown) => {
    logger.warn('IndexNow ran but its outcome was not recorded', { error: String(err) });
  });
  return run;
}

/** Origin (scheme + host) → the addresses on it. An unparseable address is dropped, not sent. */
export function groupByHost(urls: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const url of urls) {
    let origin: string;
    try { origin = new URL(url).origin; } catch (err) {
      logger.warn('IndexNow: not an address, left out', { url, error: String(err) });
      continue;
    }
    const list = groups.get(origin) ?? [];
    list.push(url);
    groups.set(origin, list);
  }
  return groups;
}

/** Run `fn` over `items`, at most `width` at a time, in order of start. */
async function inPool<T>(items: T[], width: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
}

/**
 * The addresses one app occupies, so a change to it can be announced.
 *
 * Two, not one: an app answers on its own origin AND at the apex path form, and the apex form
 * redirects to the origin. Submitting both means the engine that holds the old apex URL learns the
 * redirect exists rather than re-crawling it on its own schedule. They are on different hosts, and
 * submitToIndexNow sends each under its own host's key.
 */
export function appSubmitUrls(
  config: AimeatConfig,
  app: { ownerName: string; filename: string },
  subdomain?: string,
): string[] {
  const b = config.baseUrl.replace(/\/$/, '');
  const urls = [`${b}/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}`];
  if (subdomain && config.appHost) urls.unshift(`https://${subdomain}.${config.appHost}/`);
  return urls;
}

/**
 * Announce one app, and stamp the app with when. The stamp is what lets the operator's list say
 * "last told" per application, which is the only way to see that one has never been.
 */
export async function announceApp(
  config: AimeatConfig,
  storage: Storage,
  app: { ownerGaii: string; ownerName: string; filename: string },
  subdomain?: string,
  opts: SubmitOptions = {},
): Promise<IndexNowRun | null> {
  const run = await submitToIndexNow(config, storage, appSubmitUrls(config, app, subdomain), { scope: 'app', ...opts });
  if (run?.ok) await stampAnnounced(storage, [app], run.at);
  return run;
}

/** `seo.announcedAt` on each app. Best-effort: a stamp that fails is a log line, never a failed notice. */
export async function stampAnnounced(
  storage: Storage,
  apps: Array<{ ownerGaii: string; filename: string }>,
  at: string,
): Promise<void> {
  for (const app of apps) {
    try {
      await storage.updateAppMeta(app.ownerGaii, app.filename, { seo: { announcedAt: at } });
    } catch (err) {
      logger.warn('IndexNow: the app was announced but the stamp did not land', { filename: app.filename, error: String(err) });
    }
  }
}
