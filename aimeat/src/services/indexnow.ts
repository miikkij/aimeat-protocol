/**
 * @file indexnow.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Telling the search engines that something here changed, instead of waiting to be
 *   crawled.
 *
 *   IndexNow is one POST that reaches Bing, Yandex, Naver, Seznam and Yep at once, and through Bing
 *   it reaches ChatGPT's search. Google does not participate, so this never replaces the sitemap;
 *   it shortens the wait for the engines that do.
 *
 *   Until now the only way to send anything was `pnpm indexnow`, run by hand, over the static page
 *   registry. No published app had ever been submitted — which is most of what changes on this
 *   node. The submission itself moved here so the script and the publish path cannot drift into two
 *   different ideas of what a submission is.
 *
 *   Four conditions silence it, and each one is a case where sending would be wrong rather than
 *   merely unnecessary: no key (the endpoint would reject an unverifiable host), the auto switch
 *   off, node-wide discovery off (announcing pages we are telling crawlers not to fetch), and an
 *   empty URL list.
 *
 * @structure
 *   - submitToIndexNow(config, storage, urls) — POST, record the outcome, never throw
 *   - appSubmitUrls(config, app)              — the addresses one app occupies
 * @usage
 *   await submitToIndexNow(config, storage, [`${config.baseUrl}/`]);
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial. scripts/indexnow.ts calls this rather than posting its own.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import { writeIndexNowLastRun, type IndexNowRun } from './indexnow-log.js';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
/** IndexNow's own documented ceiling per call. */
const MAX_URLS = 10_000;

/**
 * Submit a batch and record what happened. Returns the run, or null when the node is configured not
 * to submit.
 *
 * NEVER THROWS. Every caller is a side effect at the end of a successful write — an app was
 * published, a switch was flipped — and a search engine being unreachable must not turn that
 * finished work into a failed request. The outcome is recorded either way, so the admin status
 * shows a rejected submission as rejected instead of showing nothing.
 */
export async function submitToIndexNow(
  config: AimeatConfig,
  storage: Storage,
  urls: string[],
): Promise<IndexNowRun | null> {
  if (!config.indexNowKey) return null;
  if (!config.seoIndexnowAuto) return null;
  if (config.seoIndexing === 'off') return null;

  const unique = [...new Set(urls.filter(Boolean))].slice(0, MAX_URLS);
  if (unique.length === 0) return null;

  const b = config.baseUrl.replace(/\/$/, '');
  const payload = {
    host: new URL(b).host,
    key: config.indexNowKey,
    keyLocation: `${b}/${config.indexNowKey}.txt`,
    urlList: unique,
  };

  let run: IndexNowRun;
  try {
    // Through safeFetch like every other non-constant outbound call, even though the endpoint is a
    // constant: the rule is about the door, not about this particular URL, and an exception here
    // is one more place a future edit could put a caller-supplied host.
    const resp = await safeFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    run = {
      at: new Date().toISOString(),
      urlCount: unique.length,
      // 200 and 202 both mean accepted; IndexNow answers 202 for a queued batch.
      ok: resp.ok || resp.status === 202,
      status: resp.status,
    };
    if (!run.ok) {
      logger.warn('IndexNow rejected the submission', { status: resp.status, urls: unique.length });
    }
  } catch (err) {
    logger.warn('IndexNow submission did not complete', { error: (err as Error).message });
    run = { at: new Date().toISOString(), urlCount: unique.length, ok: false, status: null };
  }

  await writeIndexNowLastRun(storage, run).catch((err: unknown) => {
    logger.warn('IndexNow ran but its outcome was not recorded', { error: String(err) });
  });
  return run;
}

/**
 * The addresses one app occupies, so a change to it can be announced.
 *
 * Two, not one: an app answers on its own origin AND at the apex path form, and the apex form
 * redirects to the origin. Submitting both means the engine that holds the old apex URL learns the
 * redirect exists rather than re-crawling it on its own schedule.
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
