/**
 * @file social-finish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The step after the code exchange for Facebook, Instagram and Reddit: turn the token
 *   the authorization round produced into the credential that publishes, and learn which account it
 *   is. Called by oauth.ts in place of its identity lookup, and by refresh.ts for Instagram's renewal.
 *
 *   WHY A SEPARATE STEP. For every earlier provider the exchanged token IS the publishing credential,
 *   so the identity lookup was the only thing left to do. Here it is not:
 *     - Facebook: short-lived user token → long-lived user token → the PAGE's own token from
 *       /me/accounts. Only the page token is stored; it does not expire while the long-lived user
 *       token it came from was valid at derivation, and the user token is dropped so the node holds
 *       no more than publishing to that one page needs.
 *     - Instagram: one-hour token → 60-day token by `ig_exchange_token`, renewed later by
 *       `ig_refresh_token` (renewInstagram below).
 *     - Reddit: nothing to convert; only the identity lookup, which needs the User-Agent rule.
 *
 *   EVERY IDENTITY FIELD COMES FROM THE PROVIDER. The `account` hint a person gives at the start
 *   only CHOOSES among the pages Facebook says they manage; it never names one by itself.
 * @structure finishSocialToken · renewInstagram · SocialFinished
 * @usage const out = await finishSocialToken(provider, client, token, hint);
 * @version-history
 *   v1.0.0 — 2026-10-15 — Facebook Page, Instagram, Reddit.
 */

import { safeFetch } from '../../utils/url-validator.js';
import { readJson } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import type { OutboundProvider } from './providers.js';
import { FACEBOOK_GRAPH, INSTAGRAM_GRAPH, REDDIT_USER_AGENT } from './providers-social.js';

/** A profile or token answer is a few kilobytes; a list of pages a person manages is not much more. */
const ANSWER_MAX_BYTES = 512 * 1024;

export interface SocialFinished {
  accessToken: string;
  refreshToken?: string;
  /** ISO time, or null for a token that does not expire (a Facebook page token). */
  expiresAt: string | null;
  externalId: string;
  accountLabel: string;
  extra?: Record<string, string>;
}

/** The providers whose round ends here rather than in oauth.ts's identity lookup. */
export const SOCIAL_FINISH_PROVIDERS: ReadonlySet<string> = new Set(['facebook', 'instagram', 'reddit']);

async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await safeFetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  let body: Record<string, unknown> = {};
  try {
    body = await readJson(r, ANSWER_MAX_BYTES) as Record<string, unknown>;
  } catch (err) {
    // Every caller checks the status and the field it needs, so an unreadable body ends in the
    // refusal that names the step; the log says it was the body and not the provider's words.
    logger.warn('connections: a provider answer was not readable JSON', { status: r.status, error: String(err) });
  }
  return { status: r.status, body };
}

/** Meta's own words from an error answer, short enough to show. */
function metaSaid(body: Record<string, unknown>): string {
  const e = body.error as { message?: unknown } | undefined;
  return typeof e?.message === 'string' ? e.message.slice(0, 300) : '';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

async function finishFacebook(
  client: { clientId: string; clientSecret: string }, userToken: string, hint: string,
): Promise<SocialFinished | { error: string }> {
  // 1. A long-lived user token. A page token derived from a SHORT-lived one expires with it in an
  //    hour; derived from a long-lived one it does not expire. This step is the whole difference.
  const q = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: client.clientId,
    client_secret: client.clientSecret,
    fb_exchange_token: userToken,
  });
  const ex = await getJson(`${FACEBOOK_GRAPH}/oauth/access_token?${q.toString()}`);
  const longUser = str(ex.body.access_token);
  if (ex.status !== 200 || !longUser) {
    return { error: `Facebook would not extend the sign-in (HTTP ${ex.status}) ${metaSaid(ex.body)}`.trim() };
  }

  // 2. The pages this person manages, each with its own token.
  const pages = await getJson(
    `${FACEBOOK_GRAPH}/me/accounts?fields=id,name,access_token,tasks&limit=100`,
    { Authorization: `Bearer ${longUser}` },
  );
  if (pages.status !== 200) {
    return { error: `Facebook would not list the pages you manage (HTTP ${pages.status}) ${metaSaid(pages.body)}`.trim() };
  }
  const list = (Array.isArray(pages.body.data) ? pages.body.data : []) as Array<Record<string, unknown>>;
  const usable = list.filter((p) => str(p.id) && str(p.access_token));
  if (usable.length === 0) {
    // The most common first-time failure, and it has a plain fix: the page was not ticked in the
    // consent dialog, or the account manages no page at all.
    return { error: 'Facebook says this account manages no page this app may use. Connect again and tick the page in the Facebook dialog, or create a Page first.' };
  }
  const wanted = hint.trim().toLowerCase();
  const page = wanted
    ? usable.find((p) => str(p.id) === wanted || str(p.name).toLowerCase() === wanted)
    : usable[0];
  if (!page) {
    const names = usable.map((p) => str(p.name)).filter(Boolean).join(', ');
    return { error: `You manage no page named "${hint}". The pages Facebook offered: ${names}.` };
  }
  const others = usable.length > 1 && !wanted ? ` (1 of ${usable.length}; name another with account)` : '';
  return {
    accessToken: str(page.access_token),
    expiresAt: null,
    externalId: str(page.id),
    accountLabel: `${str(page.name) || str(page.id)}${others}`,
    extra: { pageId: str(page.id) },
  };
}

async function finishInstagram(
  client: { clientId: string; clientSecret: string }, shortToken: string, userIdFromExchange: string,
): Promise<SocialFinished | { error: string }> {
  const q = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: client.clientSecret,
    access_token: shortToken,
  });
  const ex = await getJson(`https://graph.instagram.com/access_token?${q.toString()}`);
  const longToken = str(ex.body.access_token);
  if (ex.status !== 200 || !longToken) {
    return { error: `Instagram would not extend the sign-in (HTTP ${ex.status}) ${metaSaid(ex.body)}`.trim() };
  }
  const expiresIn = typeof ex.body.expires_in === 'number' ? ex.body.expires_in : 60 * 24 * 60 * 60;

  const me = await getJson(`${INSTAGRAM_GRAPH}/me?fields=user_id,username,account_type`, {
    Authorization: `Bearer ${longToken}`,
  });
  if (me.status !== 200) {
    return { error: `Instagram would not say which account this is (HTTP ${me.status}) ${metaSaid(me.body)}`.trim() };
  }
  // user_id is the professional account id the publishing endpoints take; `id` is app-scoped.
  const igUserId = str(me.body.user_id) || userIdFromExchange || str(me.body.id);
  if (!igUserId) return { error: 'Instagram returned no account id' };
  const accountType = str(me.body.account_type).toUpperCase();
  if (accountType && accountType !== 'BUSINESS' && accountType !== 'MEDIA_CREATOR' && accountType !== 'CREATOR') {
    // A personal account authorizes and then cannot publish. Saying so now beats a refused post.
    return { error: 'This Instagram account is a personal one. Switch it to a professional (business or creator) account in the Instagram app, then connect again.' };
  }
  const username = str(me.body.username);
  return {
    accessToken: longToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    externalId: igUserId,
    accountLabel: username ? `@${username}` : igUserId,
    extra: { igUserId },
  };
}

async function finishReddit(accessToken: string): Promise<SocialFinished | { error: string }> {
  const me = await getJson('https://oauth.reddit.com/api/v1/me', {
    Authorization: `Bearer ${accessToken}`, 'User-Agent': REDDIT_USER_AGENT,
  });
  if (me.status !== 200) {
    return { error: me.status === 403
      ? 'Reddit accepted the sign-in but would not say which account it is. Check that the app asks for the identity scope.'
      : `Reddit rejected the token (HTTP ${me.status})` };
  }
  const id = str(me.body.id);
  const name = str(me.body.name);
  if (!id) return { error: 'Reddit returned no account id' };
  return { accessToken, expiresAt: null, externalId: id, accountLabel: name ? `u/${name}` : id };
}

/**
 * Finish the round for one of SOCIAL_FINISH_PROVIDERS.
 *
 * `token` is the provider's raw token answer, because Instagram's carries the account id beside the
 * token (and has been documented both bare and wrapped in a `data` array), and Reddit's carries the
 * refresh token and lifetime that oauth.ts would otherwise read.
 */
export async function finishSocialToken(
  provider: OutboundProvider,
  client: { clientId: string; clientSecret: string },
  token: { accessToken: string; refreshToken?: string; expiresAt: string | null; userId: string },
  hint: string,
): Promise<SocialFinished | { error: string }> {
  try {
    if (provider.id === 'facebook') return await finishFacebook(client, token.accessToken, hint);
    if (provider.id === 'instagram') return await finishInstagram(client, token.accessToken, token.userId);
    if (provider.id === 'reddit') {
      const out = await finishReddit(token.accessToken);
      if ('error' in out) return out;
      return { ...out, expiresAt: token.expiresAt, ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}) };
    }
    return { error: `no finishing step for ${provider.id}` };
  } catch (err) {
    return { error: `could not reach the provider: ${(err as Error).message}` };
  }
}

/**
 * Renew an Instagram token. Meta takes the CURRENT token and answers a new one with a fresh 60 days,
 * provided the current one is at least a day old and not expired.
 */
export async function renewInstagram(accessToken: string): Promise<
  { ok: true; accessToken: string; expiresAt: string } | { ok: false; status: number; reason: string }
> {
  const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: accessToken });
  const r = await getJson(`https://graph.instagram.com/refresh_access_token?${q.toString()}`);
  const next = str(r.body.access_token);
  if (r.status !== 200 || !next) {
    return { ok: false, status: r.status, reason: `Instagram would not renew the sign-in (HTTP ${r.status}) ${metaSaid(r.body)}`.trim() };
  }
  const expiresIn = typeof r.body.expires_in === 'number' ? r.body.expires_in : 60 * 24 * 60 * 60;
  return { ok: true, accessToken: next, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}
